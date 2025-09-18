/**
 * Audio Routes - Handles audio file upload, processing, and retrieval
 */

import { FastifyInstance } from 'fastify';
import { RedisClientType } from 'redis';
import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { FastifyRequest, FastifyReply } from 'fastify'; // Corrected import
import { v4 as uuidv4 } from 'uuid';
import { pipeline } from 'stream/promises';
export function registerAudioRoutes(
  server,
  redisClient: RedisClientType,
  workerPool: Map<string, Worker>
) {
  // Upload audio file
  server.post('/audio/upload', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const data = await request.file();
      
      if (!data) {
        return reply.code(400).send({ error: 'No file uploaded' });
      }
      
      // Validate file type
      const fileType = data.mimetype;
      if (!fileType.includes('audio/')) {
        return reply.code(400).send({ error: 'Invalid file type. Only audio files are allowed.' });
      }
      
      // Generate a unique file name
      const fileExtension = path.extname(data.filename) || '.wav';
      const fileName = `${uuidv4()}${fileExtension}`;
      const filePath = path.join(__dirname, '../../../../uploads/audio', fileName);
      
      // Save the file
      await pipeline(data.file, fs.createWriteStream(filePath));
      
      // Store metadata in Redis
      const metadata = {
        originalName: data.filename,
        fileSize: 0, // Will be updated below
        fileType,
        uploadedAt: new Date().toISOString(),
        path: filePath
      };
      
      // Get file size
      const stats = await fs.promises.stat(filePath);
      metadata.fileSize = stats.size;
      
      await redisClient.hSet(`audio:${fileName}`, metadata);
      
      // Set TTL for the metadata (14 days)
      await redisClient.expire(`audio:${fileName}`, 60 * 60 * 24 * 14);
      
      // Return success response
      return {
        success: true,
        fileId: fileName,
        url: `/audio/${fileName}`,
        metadata
      };
    } catch (error: unknown) {
      server.log.error(`Error uploading audio: ${error instanceof Error ? error.message : String(error)}`);
      return reply.code(500).send({ error: 'Failed to upload audio file' });
    }
  });
  
  // Get audio file
  server.get('/audio/:fileId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { fileId } = request.params as { fileId: string };
      
      // Get file metadata from Redis
      const metadata = await redisClient.hGetAll(`audio:${fileId}`);
      
      if (!metadata || !metadata.path) {
        return reply.code(404).send({ error: 'Audio file not found' });
      }
      
      // Check if file exists
      if (!fs.existsSync(metadata.path)) {
        return reply.code(404).send({ error: 'Audio file not found on disk' });
      }
      
      // Create read stream
      const stream = fs.createReadStream(metadata.path);
      
      // Set content type and headers
      reply.header('Content-Type', metadata.fileType || 'audio/wav');
      reply.header('Content-Disposition', `attachment; filename="${metadata.originalName || fileId}"`);
      
      return reply.send(stream);
    } catch (error: unknown) {
      server.log.error(`Error serving audio file: ${error instanceof Error ? error.message : String(error)}`);
      return reply.code(500).send({ error: 'Failed to serve audio file' });
    }
  });
  
  // Process audio file (transcription, analysis, etc.)
  server.post('/audio/:fileId/process', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { fileId } = request.params as { fileId: string };
      const { operations = ['transcribe'] } = request.body as { operations?: string[] };
      
      // Get file metadata from Redis
      const metadata = await redisClient.hGetAll(`audio:${fileId}`);
      
      if (!metadata || !metadata.path) {
        return reply.code(404).send({ error: 'Audio file not found' });
      }
      
      // Check if file exists
      if (!fs.existsSync(metadata.path)) {
        return reply.code(404).send({ error: 'Audio file not found on disk' });
      }
      
      // Generate a job ID
      const jobId = uuidv4();
      
      // Store job details in Redis
      await redisClient.hSet(`job:${jobId}`, {
        fileId,
        status: 'pending',
        operations: JSON.stringify(operations),
        createdAt: new Date().toISOString()
      });
      
      // Set TTL for the job (1 hour)
      await redisClient.expire(`job:${jobId}`, 60 * 60);
      
      // Assign to an available worker from the pool
      const workerIds = Array.from(workerPool.keys());
      if (workerIds.length === 0) {
        return reply.code(503).send({ error: 'No workers available' });
      }
      
      // Simple round-robin worker selection
      const workerId = workerIds[Math.floor(Math.random() * workerIds.length)];
      const worker = workerPool.get(workerId);
      
      if (!worker) {
        return reply.code(503).send({ error: 'Worker not available' });
      }
      
      // Post message to worker
      worker.postMessage({
        jobId,
        filePath: metadata.path,
        operations,
        fileType: metadata.fileType
      });
      
      // Update job status
      await redisClient.hSet(`job:${jobId}`, 'status', 'processing');
      
      return {
        success: true,
        jobId,
        operations,
        status: 'processing'
      };
    } catch (error: unknown) {
      server.log.error(`Error processing audio file: ${error instanceof Error ? error.message : String(error)}`);
      return reply.code(500).send({ error: 'Failed to process audio file' });
    }
  });
  
  // Get job status
  server.get('/audio/job/:jobId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { jobId } = request.params as { jobId: string };
      
      // Get job details from Redis
      const jobDetails = await redisClient.hGetAll(`job:${jobId}`);
      
      if (!jobDetails || Object.keys(jobDetails).length === 0) {
        return reply.code(404).send({ error: 'Job not found' });
      }
      
      // Parse operations
      let operations = [];
      if (jobDetails.operations) {
        try {
          operations = JSON.parse(jobDetails.operations);
        } catch (e) {
          operations = [];
        }
      }
      
      // Parse results if available
      let results = {};
      if (jobDetails.results) {
        try {
          results = JSON.parse(jobDetails.results);
        } catch (e) {
          results = {};
        }
      }
      
      return {
        jobId,
        fileId: jobDetails.fileId,
        status: jobDetails.status,
        operations,
        results,
        createdAt: jobDetails.createdAt,
        completedAt: jobDetails.completedAt
      };
    } catch (error: unknown) {
      server.log.error(`Error getting job status: ${error instanceof Error ? error.message : String(error)}`);
      return reply.code(500).send({ error: 'Failed to get job status' });
    }
  });
  
  // Delete audio file
  server.delete('/audio/:fileId', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { fileId } = request.params as { fileId: string };
      
      // Get file metadata from Redis
      const metadata = await redisClient.hGetAll(`audio:${fileId}`);
      
      if (!metadata || !metadata.path) {
        return reply.code(404).send({ error: 'Audio file not found' });
      }
      
      // Delete file if it exists
      if (fs.existsSync(metadata.path)) {
        await fs.promises.unlink(metadata.path);
      }
      
      // Delete metadata from Redis
      await redisClient.del(`audio:${fileId}`);
      
      return {
        success: true,
        message: 'Audio file deleted successfully'
      };
    } catch (error: unknown) {
      server.log.error(`Error deleting audio file: ${error instanceof Error ? error.message : String(error)}`);
      return reply.code(500).send({ error: 'Failed to delete audio file' });
    }
  });
}

/**
 * Transcription Routes - Handles speech-to-text transcription requests
 */

import { FastifyInstance } from 'fastify';
import { RedisClientType } from 'redis';
import { Worker } from 'worker_threads';
import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { pipeline } from 'stream/promises';
import CircuitBreaker from 'opossum';
import { FastifyRequest, FastifyReply } from 'fastify';
import { Server, IncomingMessage, ServerResponse } from 'http';

// Helper function to get error message from unknown error
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Circuit breaker options
const circuitOptions = {
  timeout: 30000, // 30 seconds timeout
  errorThresholdPercentage: 50, // Open after 50% failures
  resetTimeout: 30000, // 30 seconds to reset
  rollingCountTimeout: 60000, // 60 second rolling window
  rollingCountBuckets: 10, // 10 buckets
};

// Create a circuit breaker for transcription
const transcriptionCircuit = new CircuitBreaker(async (params: any) => {
  const { worker, jobId, filePath, options } = params;
  
  let jobPromiseResolve: (value: unknown) => void;
  let jobPromiseReject: (reason?: any) => void;
  const jobPromise = new Promise((resolve, reject) => {
    jobPromiseResolve = resolve;
    jobPromiseReject = reject;
  });

  // Set up timeout
  const timeout = setTimeout(() => {
    jobPromiseReject(new Error('Transcription job timed out'));
    
    // Clean up event listener
    worker.removeAllListeners(`job:${jobId}:complete`);
    worker.removeAllListeners(`job:${jobId}:error`);
  }, 60000); // 60 second timeout
  
  // Set up completion handler
  worker.on(`job:${jobId}:complete`, (result: any) => {
    clearTimeout(timeout);
    jobPromiseResolve(result);
    
    // Clean up event listeners
    worker.removeAllListeners(`job:${jobId}:complete`);
    worker.removeAllListeners(`job:${jobId}:error`);
  });
  
  worker.on(`job:${jobId}:error`, (error: any) => {
    clearTimeout(timeout);
    jobPromiseReject(new Error(getErrorMessage(error) || 'Transcription failed'));
    
    // Clean up event listeners
    worker.removeAllListeners(`job:${jobId}:complete`);
    worker.removeAllListeners(`job:${jobId}:error`);
  });
  
  // Post message to worker
  worker.postMessage({
    action: 'transcribe',
    jobId,
    filePath,
    options
  });
  
  // Wait for job completion
  return jobPromise;
}, circuitOptions);

// Event listeners for circuit breaker
transcriptionCircuit.on('open', () => {
  console.log('Transcription circuit breaker opened');
});

transcriptionCircuit.on('close', () => {
  console.log('Transcription circuit breaker closed');
});

transcriptionCircuit.on('halfOpen', () => {
  console.log('Transcription circuit breaker half-open');
});

// Fallback function for when circuit is open
transcriptionCircuit.fallback(() => {
  return {
    status: 'degraded',
    transcript: '[Transcription temporarily unavailable due to service issues]',
    confidence: 0,
    words: [],
    metadata: {
      serviceStatus: 'degraded',
      message: 'The transcription service is temporarily unavailable'
    }
  };
});

export function registerTranscriptionRoutes(
  server: FastifyInstance<Server, IncomingMessage, ServerResponse, any, any>,
  redisClient: RedisClientType,
  workerPool: Map<string, Worker>
) {
  // Circuit breaker status endpoint
  server.get('/transcribe/circuit', async (request: FastifyRequest, reply: FastifyReply) => {
    return {
      state: transcriptionCircuit.status.state,
      stats: {
        successes: transcriptionCircuit.status.stats.successes,
        failures: transcriptionCircuit.status.stats.failures,
        rejects: transcriptionCircuit.status.stats.rejects,
        timeouts: transcriptionCircuit.status.stats.timeouts,
        latencyMean: transcriptionCircuit.status.stats.latencyMean,
      }
    };
  });
  
  // Reset circuit breaker
  server.post('/transcribe/circuit/reset', async (request: FastifyRequest, reply: FastifyReply) => {
    transcriptionCircuit.close();
    return { success: true, message: 'Circuit breaker reset' };
  });

  // Direct transcription endpoint
  server.post('/transcribe', async (request: FastifyRequest, reply: FastifyReply) => {
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
      
      // Get parameters
      const { language, model, enhanced } = request.query as {
        language?: string;
        model?: string;
        enhanced?: string;
      };
      
      // Generate a unique file name for temporary storage
      const fileExtension = path.extname(data.filename) || '.wav';
      const fileName = `temp_${uuidv4()}${fileExtension}`;
      const filePath = path.join(__dirname, '../../../../uploads/audio', fileName);
      
      // Save the file temporarily
      await pipeline(data.file, fs.createWriteStream(filePath));
      
      // Prepare job ID
      const jobId = uuidv4();
      
      // Choose a worker
      const workerIds = Array.from(workerPool.keys());
      if (workerIds.length === 0) {
        // Clean up the temporary file
        try {
          await fs.promises.unlink(filePath);
        } catch (unlinkError) {
          server.log.error(`Error deleting temporary file: ${getErrorMessage(unlinkError)}`);
        }
        
        return reply.code(503).send({ error: 'No workers available' });
      }
      
      // Simple round-robin worker selection
      const workerId = workerIds[Math.floor(Math.random() * workerIds.length)];
      const worker = workerPool.get(workerId);
      
      if (!worker) {
        // Clean up temporary file on worker assignment failure
        try {
          await fs.promises.unlink(filePath);
        } catch (unlinkError) {
          server.log.error(`Error deleting temporary file: ${getErrorMessage(unlinkError)}`);
        }
        
        return reply.code(503).send({ error: 'Worker not available' });
      }
      
      // Post message to worker
      worker.postMessage({
        action: 'transcribe',
        jobId,
        filePath,
        options: {
          language: language || 'en',
          model: model || 'general',
          enhanced: enhanced === 'true'
        }
      });
      
      // Wait for job completion
      let jobPromiseResolve: (value: unknown) => void;
      let jobPromiseReject: (reason?: any) => void;
      const jobPromise = new Promise((resolve, reject) => {
        jobPromiseResolve = resolve;
        jobPromiseReject = reject;
      });

      // Set up timeout
      const timeout = setTimeout(() => {
        jobPromiseReject(new Error('Transcription job timed out'));
        
        // Clean up event listener
        worker.removeAllListeners(`job:${jobId}:complete`);
        worker.removeAllListeners(`job:${jobId}:error`);
      }, 60000); // 60 second timeout
      
      // Set up completion handler
      worker.on(`job:${jobId}:complete`, (result: any) => {
        clearTimeout(timeout);
        jobPromiseResolve(result);
        
        // Clean up event listeners
        worker.removeAllListeners(`job:${jobId}:complete`);
        worker.removeAllListeners(`job:${jobId}:error`);
      });
      
      worker.on(`job:${jobId}:error`, (error: any) => {
        clearTimeout(timeout);
        jobPromiseReject(new Error(getErrorMessage(error) || 'Transcription failed'));
        
        // Clean up event listeners
        worker.removeAllListeners(`job:${jobId}:complete`);
        worker.removeAllListeners(`job:${jobId}:error`);
      });

      const result = await jobPromise;

      // Clean up the temporary file
      try {
        await fs.promises.unlink(filePath);
      } catch (unlinkError) {
        server.log.error(`Error deleting temporary file: ${getErrorMessage(unlinkError)}`);
      }
      
      return result;
    } catch (error) {
      server.log.error(`Error transcribing audio: ${getErrorMessage(error)}`);
      return reply.code(500).send({ error: 'Failed to transcribe audio file' });
    }
  });
  
  // Real-time transcription status
  server.post('/transcribe/detect-language', async (request: FastifyRequest, reply: FastifyReply) => {
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
      
      // Generate a unique file name for temporary storage
      const fileExtension = path.extname(data.filename) || '.wav';
      const fileName = `temp_${uuidv4()}${fileExtension}`;
      const filePath = path.join(__dirname, '../../../../uploads/audio', fileName);
      
      // Save the file temporarily
      await pipeline(data.file, fs.createWriteStream(filePath));
      
      // Prepare job ID
      const jobId = uuidv4();
      
      // Create promise to handle job completion
      let jobPromiseResolve: (value: unknown) => void;
      let jobPromiseReject: (reason?: any) => void;
      const jobPromise = new Promise((resolve, reject) => {
        jobPromiseResolve = resolve;
        jobPromiseReject = reject;
      });

      // Set up timeout
      const timeout = setTimeout(() => {
        jobPromiseReject(new Error('Language detection job timed out'));
        
        // Clean up event listener
        workerPool.forEach(worker => {
          worker.removeAllListeners(`job:${jobId}:complete`);
          worker.removeAllListeners(`job:${jobId}:error`);
        });
      }, 30000); // 30 second timeout
      
      // Set up completion handler
      workerPool.forEach(worker => {
        worker.on(`job:${jobId}:complete`, (result) => {
          clearTimeout(timeout);
          jobPromiseResolve(result);
          
          // Clean up event listeners
          workerPool.forEach(w => {
            w.removeAllListeners(`job:${jobId}:complete`);
            w.removeAllListeners(`job:${jobId}:error`);
          });
        });
        
        worker.on(`job:${jobId}:error`, (error) => {
          clearTimeout(timeout);
          jobPromiseReject(new Error(getErrorMessage(error) || 'Language detection failed'));
          
          // Clean up event listeners
          workerPool.forEach(w => {
            w.removeAllListeners(`job:${jobId}:complete`);
            w.removeAllListeners(`job:${jobId}:error`);
          });
        });
      });
      
      // Choose a worker
      const workerIds = Array.from(workerPool.keys());
      if (workerIds.length === 0) {
        // Clean up the temporary file
        try {
          await fs.promises.unlink(filePath);
        } catch (unlinkError) {
          server.log.error(`Error deleting temporary file: ${getErrorMessage(unlinkError)}`);
        }
        
        return reply.code(503).send({ error: 'No workers available' });
      }
      
      // Simple round-robin worker selection
      const workerId = workerIds[Math.floor(Math.random() * workerIds.length)];
      const worker = workerPool.get(workerId);
      
      if (!worker) {
        // Clean up temporary file on worker assignment failure
        try {
          await fs.promises.unlink(filePath);
        } catch (unlinkError) {
          server.log.error(`Error deleting temporary file: ${getErrorMessage(unlinkError)}`);
        }
        
        return reply.code(503).send({ error: 'Worker not available' });
      }
      
      // Post message to worker
      worker.postMessage({
        action: 'detectLanguage',
        jobId,
        filePath
      });
      
      // Wait for job completion
      const result = await jobPromise;
      
      // Clean up the temporary file
      try {
        await fs.promises.unlink(filePath);
      } catch (unlinkError) {
        server.log.error(`Error deleting temporary file: ${getErrorMessage(unlinkError)}`);
      }
      
      return result;
    } catch (error) {
      server.log.error(`Error detecting language: ${getErrorMessage(error)}`);
      return reply.code(500).send({ error: 'Failed to detect language' });
    }
  });
}

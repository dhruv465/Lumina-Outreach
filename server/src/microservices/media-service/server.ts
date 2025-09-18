/**
 * Media Microservice Server using Fastify
 * 
 * A high-performance dedicated service for audio processing, streaming,
 * and speech-to-text transcription with optimized latency.
 */

import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyMultipart from '@fastify/multipart';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCompress from '@fastify/compress';
import { Worker } from 'worker_threads';
import { createClient, RedisClientType } from 'redis';
import path from 'path';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import pino from 'pino';
import { Server, IncomingMessage, ServerResponse } from 'http';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

// Configure logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
    },
  },
});

// Initialize the Fastify server
const server: FastifyInstance<Server, IncomingMessage, ServerResponse, any, any> = fastify({
  logger,
  trustProxy: true,
  bodyLimit: 50 * 1024 * 1024, // 50MB limit for audio uploads
});

// Create Redis client for communication with other services
const redisClient: RedisClientType = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

// Connect to Redis
redisClient.connect().catch(err => {
  logger.error(`Redis connection error: ${err.message}`);
  process.exit(1);
});

// Register plugins
server.register(fastifyCors, {
  origin: process.env.CORS_ORIGIN || true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
});

server.register(fastifyCompress, {
  encodings: ['gzip', 'deflate'],
});

server.register(fastifyRateLimit, {
  max: 1000,
  timeWindow: '1 minute',
});

server.register(fastifyMultipart, {
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

// Register WebSocket plugin
server.register(fastifyWebsocket, {
  options: {
    maxPayload: 1048576, // 1MB max payload
  }
});

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(__dirname, '../../../uploads/audio');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Worker pool for parallel audio processing
const workerPool = new Map<string, Worker>();

// Initialize worker pool
const cpuCount = require('os').cpus().length;
const maxWorkers = Math.max(2, cpuCount - 1); // Leave one CPU for the main thread

// Create worker for speech-to-text processing
function createSTTWorker() {
  const workerId = uuidv4();
  const worker = new Worker(path.join(__dirname, './workers/stt-worker.js'));
  
  worker.on('error', (err) => {
    logger.error(`Worker ${workerId} error: ${err.message}`);
    workerPool.delete(workerId);
    // Recreate worker on error
    createSTTWorker();
  });
  
  worker.on('exit', (code) => {
    if (code !== 0) {
      logger.warn(`Worker ${workerId} exited with code ${code}`);
      workerPool.delete(workerId);
      // Recreate worker on abnormal exit
      createSTTWorker();
    }
  });
  
  workerPool.set(workerId, worker);
  return { workerId, worker };
}

// Initialize worker pool
for (let i = 0; i < maxWorkers; i++) {
  createSTTWorker();
}

// Health check endpoint
server.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Import route handlers
import { registerAudioRoutes } from './routes/audioRoutes';
import { registerStreamRoutes } from './routes/streamRoutes';
import { registerTranscriptionRoutes } from './routes/transcriptionRoutes';

// Register routes
registerAudioRoutes(server, redisClient, workerPool);
registerStreamRoutes(server, redisClient, workerPool);
registerTranscriptionRoutes(server, redisClient, workerPool);

// Start the server
const PORT = process.env.MEDIA_SERVICE_PORT || 3002;
const HOST = process.env.HOST || '0.0.0.0';

const start = async () => {
  try {
    await server.listen({ port: PORT as number, host: HOST });
    logger.info(`Media service running at http://${HOST}:${PORT}`);
    
    // Register with service registry if available
    const serviceId = uuidv4();
    await redisClient.hSet('service_registry:media', serviceId, JSON.stringify({
      host: HOST,
      port: PORT,
      status: 'active',
      startTime: new Date().toISOString(),
      workersCount: workerPool.size,
      healthCheckEndpoint: '/health'
    }));
    
    // Perform health check publishing
    setInterval(async () => {
      await redisClient.hSet('service_registry:media', serviceId, JSON.stringify({
        host: HOST,
        port: PORT,
        status: 'active',
        startTime: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        workersCount: workerPool.size,
        healthCheckEndpoint: '/health',
        metrics: {
          activeConnections: server.websocketServer?.clients.size || 0,
          cpuUsage: process.cpuUsage(),
          memoryUsage: process.memoryUsage()
        }
      }));
    }, 30000); // Every 30 seconds
    
  } catch (err) {
    logger.error(String(err));
    process.exit(1);
  }
};

// Handle process termination
process.on('SIGINT', async () => {
  logger.info('Shutting down media service...');
  
  // Close all worker threads
  for (const [workerId, worker] of workerPool.entries()) {
    worker.terminate();
    workerPool.delete(workerId);
  }
  
  // Close Redis connection
  await redisClient.quit();
  
  // Close server
  // await server.close(); // Fastify doesn't have close method, use different shutdown approach
  
  logger.info('Media service shut down successfully');
  process.exit(0);
});

// Start the server
start();
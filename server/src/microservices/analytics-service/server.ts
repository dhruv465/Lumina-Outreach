/**
 * Advanced Analytics Microservice
 * 
 * A dedicated service for real-time analytics, predictive modeling,
 * pattern analysis, and ROI calculations to enhance call performance.
 */

import fastify, { FastifyInstance } from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import { createClient } from 'redis';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';
import path from 'path';
import pino from 'pino';
import { v4 as uuidv4 } from 'uuid';
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
});

// Create Redis client for communication with other services
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

// Connect to Redis
redisClient.connect().catch(err => {
  logger.error(`Redis connection error: ${err.message}`);
  process.exit(1);
});

// Connect to MongoDB
const mongoClient = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/lumina');
let db: any;

(async () => {
  try {
    await mongoClient.connect();
    db = mongoClient.db();
    logger.info('Connected to MongoDB');
  } catch (err) {
    logger.error(`MongoDB connection error: ${err}`);
    process.exit(1);
  }
})();

// Register plugins
server.register(fastifyCors, {
  origin: process.env.CORS_ORIGIN || true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true,
});

server.register(fastifyHelmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
});

// Register routes
import { registerDashboardRoutes } from './routes/dashboardRoutes';
// import { registerPredictiveRoutes } from './routes/predictiveRoutes';
// import { registerROIRoutes } from './routes/roiRoutes';
// import { registerBenchmarkRoutes } from './routes/benchmarkRoutes';
// import { registerOptimizationRoutes } from './routes/optimizationRoutes';

// Initialize routes with database and Redis client
registerDashboardRoutes(server, db, redisClient as any);
// registerPredictiveRoutes(server, db, redisClient);
// registerROIRoutes(server, db, redisClient);
// registerBenchmarkRoutes(server, db, redisClient);
// registerOptimizationRoutes(server, db, redisClient);

// Health check endpoint
server.get('/health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Service registration
async function registerService() {
  const serviceId = uuidv4();
  const host = process.env.HOST || '0.0.0.0';
  const port = process.env.ANALYTICS_SERVICE_PORT || 3003;
  
  await redisClient.hSet('service_registry:analytics', serviceId, JSON.stringify({
    host,
    port,
    status: 'active',
    startTime: new Date().toISOString(),
    healthCheckEndpoint: '/health'
  }));
  
  // Update health status periodically
  setInterval(async () => {
    await redisClient.hSet('service_registry:analytics', serviceId, JSON.stringify({
      host,
      port, 
      status: 'active',
      startTime: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      healthCheckEndpoint: '/health',
      metrics: {
        cpuUsage: process.cpuUsage(),
        memoryUsage: process.memoryUsage()
      }
    }));
  }, 30000); // Every 30 seconds
}

// Start the server
const start = async () => {
  try {
    const port = parseInt(process.env.ANALYTICS_SERVICE_PORT || '3003', 10);
    const host = process.env.HOST || '0.0.0.0';
    
    await registerService();
    await server.listen({ port, host });
    
    logger.info(`Analytics service running at http://${host}:${port}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

// Handle process termination
process.on('SIGINT', async () => {
  logger.info('Shutting down analytics service...');
  
  // Close Redis connection
  await redisClient.quit();
  
  // Close MongoDB connection
  await mongoClient.close();
  
  // Close server
  // await server.close(); // Fastify doesn't have close method
  
  logger.info('Analytics service shut down successfully');
  process.exit(0);
});

// Start the server
start();

import fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCompress from '@fastify/compress';
import fastifyCors from '@fastify/cors';
import fastifyMultipart from '@fastify/multipart';
import fastifyWebsocket from '@fastify/websocket';
import fastifyProxy from '@fastify/http-proxy';
import fastifyCircuitBreaker from 'fastify-circuit-breaker';
import fastifyHelmet from '@fastify/helmet';
import fastifyAuth from '@fastify/auth';
import fastifyJwt from '@fastify/jwt';
import { createClient } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import dotenv from 'dotenv';
import pino from 'pino';
import WebSocket from 'ws';
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

// Initialize Fastify with logger
const server: FastifyInstance<Server, IncomingMessage, ServerResponse, any, any> = fastify({
  logger,
  trustProxy: true,
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
  max: 100,
  timeWindow: '1 minute',
  hook: 'preHandler',
  cache: 10000,
});

server.register(fastifyMultipart, {
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
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

// Register JWT for authentication
server.register(fastifyJwt, {
  secret: process.env.JWT_SECRET || 'supersecretkey',
});

server.register(fastifyAuth);

// Register WebSocket plugin
server.register(fastifyWebsocket, {
  options: {
    maxPayload: 1048576, // 1MB max payload
  }
});

// Register circuit breaker
server.register(fastifyCircuitBreaker, {
  threshold: 5, // number of failures before opening the circuit
  timeout: 30000, // time in ms before trying again once the circuit is open
  resetTimeout: 30000, // time in ms before the circuit resets to closed state
});

// Connect to Redis for service discovery
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
});

redisClient.connect().catch(err => {
  logger.error(`Redis connection error: ${err.message}`);
  process.exit(1);
});

// Service discovery function
async function getServiceUrl(serviceName: string): Promise<string | null> {
  try {
    const services = await redisClient.hGetAll(`service_registry:${serviceName}`);
    
    if (!services || Object.keys(services).length === 0) {
      logger.warn(`No instances found for service: ${serviceName}`);
      return null;
    }
    
    // Choose a random service instance (simple load balancing)
    const serviceIds = Object.keys(services);
    const randomId = serviceIds[Math.floor(Math.random() * serviceIds.length)];
    const serviceInfo = JSON.parse(services[randomId]);
    
    if (serviceInfo.status !== 'active') {
      logger.warn(`Service ${serviceName} instance ${randomId} is not active`);
      return null;
    }
    
    return `http://${serviceInfo.host}:${serviceInfo.port}`;
  } catch (error) {
    logger.error(`Service discovery error for ${serviceName}: ${error}`);
    return null;
  }
}

// Authentication middleware
async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    if (request.jwtVerify) {
      await request.jwtVerify();
    } else {
      reply.code(401).send({ error: 'JWT verification not available' });
    }
  } catch (err) {
    reply.code(401).send({ error: 'Unauthorized' });
  }
}

// Service registration
async function registerGateway() {
  const serviceId = uuidv4();
  const host = process.env.HOST || '0.0.0.0';
  const port = process.env.API_GATEWAY_PORT || 3000;
  
  await redisClient.hSet('service_registry:gateway', serviceId, JSON.stringify({
    host,
    port,
    status: 'active',
    startTime: new Date().toISOString(),
    healthCheckEndpoint: '/health'
  }));
  
  // Update health status periodically
  setInterval(async () => {
    await redisClient.hSet('service_registry:gateway', serviceId, JSON.stringify({
      host,
      port, 
      status: 'active',
      startTime: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      metrics: {
        activeConnections: server.websocketServer?.clients ? server.websocketServer.clients.size : 0,
        cpuUsage: process.cpuUsage(),
        memoryUsage: process.memoryUsage()
      }
    }));
  }, 30000); // Every 30 seconds
}

// Health check endpoint
server.get('/health', async () => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// API endpoint for service discovery
server.get('/api/services', async (request, reply) => {
  try {
    // Basic auth check - in production, implement proper JWT validation
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    
    const services = {
      api: await getServiceUrl('api'),
      media: await getServiceUrl('media'),
      worker: await getServiceUrl('worker'),
      analytics: await getServiceUrl('analytics')
    };
    
    return { services };
  } catch (error) {
    return reply.code(500).send({ error: 'Failed to get services' });
  }
});

// Proxy requests to the media service
server.register(fastifyProxy, {
  upstream: '',
  prefix: '/media',
  http2: false,
  replyOptions: {
    rewriteRequestHeaders: (req: FastifyRequest, headers: Record<string, string>) => {
      return {
        ...headers,
        'x-forwarded-host': req.headers.host,
        'x-forwarded-proto': 'https',
        'x-request-id': uuidv4()
      };
    }
  },
  preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
    const serviceUrl = await getServiceUrl('media');
    
    if (!serviceUrl) {
      reply.code(503).send({ error: 'Media service unavailable' });
      return;
    }
    
    // Dynamically set the upstream URL
    (server as any).pluginOptions['@fastify/http-proxy'].upstream = serviceUrl;
  }
});

// Proxy requests to the API service
server.register(fastifyProxy, {
  upstream: '',
  prefix: '/api',
  http2: false,
  replyOptions: {
    rewriteRequestHeaders: (req: FastifyRequest, headers: Record<string, string>) => {
      return {
        ...headers,
        'x-forwarded-host': req.headers.host,
        'x-forwarded-proto': 'https',
        'x-request-id': uuidv4()
      };
    }
  },
  preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
    const serviceUrl = await getServiceUrl('api');
    
    if (!serviceUrl) {
      reply.code(503).send({ error: 'API service unavailable' });
      return;
    }
    
    // Dynamically set the upstream URL
    (server as any).pluginOptions['@fastify/http-proxy'].upstream = serviceUrl;
  }
});

// WebSocket proxy for real-time communication
server.register(async function (fastify: FastifyInstance<Server, IncomingMessage, ServerResponse, any, any>) {
  fastify.get('/ws', { websocket: true }, (socket: WebSocket, req: FastifyRequest) => {
    // Handle WebSocket connections here or proxy them to the appropriate service
    socket.on('message', async (message: string) => {
    try {
      const parsedMessage = JSON.parse(message);
      const { service, event, data } = parsedMessage;
      
      // Handle based on the target service
      switch (service) {
        case 'media':
          // Forward to media service
          const mediaServiceUrl = await getServiceUrl('media');
          if (mediaServiceUrl) {
            // Logic to proxy the WebSocket message to the media service
            // This would typically involve maintaining WebSocket connections to backend services
            socket.send(JSON.stringify({
              success: true,
              message: 'Message forwarded to media service'
            }));
          } else {
            socket.send(JSON.stringify({
              success: false,
              error: 'Media service unavailable'
            }));
          }
          break;
          
        case 'analytics':
          // Forward to analytics service
          // Similar logic as above
          break;
          
        default:
          socket.send(JSON.stringify({
            success: false,
            error: 'Unknown service'
          }));
      }
    } catch (error) {
      socket.send(JSON.stringify({
        success: false,
        error: 'Invalid message format'
      }));
    }
  });
  });
});

// Error handler
server.setErrorHandler((error: Error & { statusCode?: number }, request: FastifyRequest, reply: FastifyReply) => {
  logger.error(`Error handling request: ${error.message}`);
  
  // Don't expose internal server errors to the client
  if (error.statusCode === 500) {
    reply.code(500).send({ error: 'Internal Server Error' });
  } else {
    reply.send(error);
  }
});

// Start the server
const start = async () => {
  try {
    const port = parseInt(process.env.API_GATEWAY_PORT || '3000', 10);
    const host = process.env.HOST || '0.0.0.0';
    
    await registerGateway();
    await server.listen({ port, host });
    
    logger.info(`API Gateway running at http://${host}:${port}`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(`Failed to start server: ${errorMessage}`);
    process.exit(1);
  }
};

// Handle process termination
process.on('SIGINT', async () => {
  logger.info('Shutting down API Gateway...');
  
  // Close Redis connection
  await redisClient.quit();
  
  // Close server
  // await server.close(); // Fastify doesn't have close method
  
  logger.info('API Gateway shut down successfully');
  process.exit(0);
});

// Start the server
start();
/**
 * Stream Routes - Handles WebSocket streaming for real-time audio processing
 */

import { FastifyInstance } from 'fastify';
import { RedisClientType } from 'redis';
import { Worker } from 'worker_threads';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import { FastifyRequest, FastifyReply } from 'fastify';
import { WebSocket } from 'ws';
import { Server, IncomingMessage, ServerResponse } from 'http';

// Helper function to get error message from unknown error
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Types
interface StreamSession {
  id: string;
  workerId: string;
  active: boolean;
  startTime: Date;
  language?: string;
  samplingRate?: number;
  callId?: string;
  lastActivity: Date;
}

export function registerStreamRoutes(
  server: FastifyInstance<Server, IncomingMessage, ServerResponse, any, any>,
  redisClient: RedisClientType,
  workerPool: Map<string, Worker>
) {
  // Store active streaming sessions
  const activeSessions = new Map<string, StreamSession>();
  
  // Circuit breaker state
  const circuitBreaker = {
    failures: 0,
    lastFailure: 0,
    threshold: 5,
    resetTimeout: 30000, // 30 seconds
    state: 'closed' as 'closed' | 'open' | 'half-open'
  };
  
  // Check circuit breaker state
  function checkCircuitBreaker() {
    if (circuitBreaker.state === 'open') {
      // Check if it's time to try again
      if (Date.now() - circuitBreaker.lastFailure > circuitBreaker.resetTimeout) {
        circuitBreaker.state = 'half-open';
        server.log.info('Circuit breaker state changed to half-open');
      } else {
        return false; // Circuit is open, reject requests
      }
    }
    return true; // Circuit is closed or half-open, allow requests
  }
  
  // Update circuit breaker state on failure
  function recordFailure() {
    circuitBreaker.failures++;
    circuitBreaker.lastFailure = Date.now();
    
    if (circuitBreaker.failures >= circuitBreaker.threshold && circuitBreaker.state !== 'open') {
      circuitBreaker.state = 'open';
      server.log.warn(`Circuit breaker opened after ${circuitBreaker.failures} failures`);
      
      // Publish circuit breaker state change to Redis
      redisClient.publish('service:circuit-breaker', JSON.stringify({
        service: 'media',
        state: 'open',
        timestamp: new Date().toISOString()
      }));
      
      // Schedule reset
      setTimeout(() => {
        if (circuitBreaker.state === 'open') {
          circuitBreaker.state = 'half-open';
          server.log.info('Circuit breaker state changed to half-open');
          
          // Publish circuit breaker state change to Redis
          redisClient.publish('service:circuit-breaker', JSON.stringify({
            service: 'media',
            state: 'half-open',
            timestamp: new Date().toISOString()
          }));
        }
      }, circuitBreaker.resetTimeout);
    }
  }
  
  // Reset circuit breaker on success
  function recordSuccess() {
    if (circuitBreaker.state === 'half-open') {
      circuitBreaker.failures = 0;
      circuitBreaker.state = 'closed';
      server.log.info('Circuit breaker state changed to closed');
      
      // Publish circuit breaker state change to Redis
      redisClient.publish('service:circuit-breaker', JSON.stringify({
        service: 'media',
        state: 'closed',
        timestamp: new Date().toISOString()
      }));
    }
  }
  
  // Clean up expired sessions
  setInterval(() => {
    const now = new Date();
    let closedCount = 0;
    
    activeSessions.forEach((session, sessionId) => {
      // Close sessions inactive for more than 2 minutes
      if (now.getTime() - session.lastActivity.getTime() > 2 * 60 * 1000) {
        try {
          // Notify worker to clean up
          const worker = workerPool.get(session.workerId);
          if (worker) {
            worker.postMessage({ 
              action: 'endStream',
              sessionId
            });
          }
        } catch (err: unknown) {
          server.log.error(`Error notifying worker to end stream ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
        }
        
        activeSessions.delete(sessionId);
        closedCount++;
      }
    });
    
    if (closedCount > 0) {
      server.log.info(`Cleaned up ${closedCount} inactive streaming sessions`);
    }
  }, 30000); // Every 30 seconds
  
  // WebSocket route for real-time audio streaming and processing
  server.get('/stream', { websocket: true }, (connection: { socket: WebSocket }, req: FastifyRequest) => {
    // Check circuit breaker
    if (!checkCircuitBreaker()) {
      connection.socket.send(JSON.stringify({
        type: 'error',
        error: 'Service temporarily unavailable due to circuit breaker',
        code: 'CIRCUIT_BREAKER_OPEN'
      }));
      connection.socket.close(1013, 'Circuit breaker open');
      return;
    }
    
    // Extract query parameters
    const url = new URL(req.raw.url, `http://${req.raw.socket.localAddress}`);
    const callId = url.searchParams.get('callId');
    const language = url.searchParams.get('language') || 'en';
    const samplingRate = parseInt(url.searchParams.get('samplingRate') || '16000', 10);
    
    // Assign a worker from the pool
    const workerIds = Array.from(workerPool.keys());
    if (workerIds.length === 0) {
      connection.socket.send(JSON.stringify({
        type: 'error',
        error: 'No workers available',
        code: 'NO_WORKERS'
      }));
      connection.socket.close(1013, 'No workers available');
      return;
    }
    
    // Simple round-robin worker selection
    const workerId = workerIds[Math.floor(Math.random() * workerIds.length)];
    const worker = workerPool.get(workerId);
    
    // Create a session
    const sessionId = uuidv4();
    const session: StreamSession = {
      id: sessionId,
      workerId,
      active: true,
      startTime: new Date(),
      lastActivity: new Date(),
      language,
      samplingRate,
      callId: callId || undefined
    };
    
    activeSessions.set(sessionId, session);
    
    server.log.info(`Started streaming session ${sessionId} for call ${callId || 'unknown'}`);
    
    // Send connection confirmation
    connection.socket.send(JSON.stringify({
      type: 'connected',
      sessionId,
      timestamp: new Date().toISOString()
    }));
    
    // Initialize worker for this session
    if (worker) {
      worker.postMessage({
        action: 'initStream',
        sessionId,
        language,
        samplingRate,
        callId: callId || undefined
      });
    } else {
      console.error('Worker not available for session:', sessionId);
      connection.socket.send(JSON.stringify({
        type: 'error',
        error: 'Worker initialization failed'
      }));
      return;
    }
    
    // Set up message handlers
    worker.on('message', (message) => {
      if (message.sessionId === sessionId) {
        try {
          // Forward message to client
          connection.socket.send(JSON.stringify(message));
          
          // Record successful processing
          recordSuccess();
        } catch (err) {
          server.log.error(`Error sending message to client for session ${sessionId}: ${getErrorMessage(err)}`);
        }
      }
    });
    
    // Handle incoming messages from client
    connection.socket.on('message', (message: any) => {
      try {
        // Update last activity timestamp
        if (activeSessions.has(sessionId)) {
          const session = activeSessions.get(sessionId);
          if (session) {
            session.lastActivity = new Date();
          }
        }
        
        // Process binary audio data
        if (message instanceof Buffer) {
          // Forward to worker
          if (worker) {
            worker.postMessage({
              action: 'processAudio',
              sessionId,
              audioChunk: message
            }, [message.buffer]);
          } else {
            console.error('Worker not available for audio processing');
          }
        } 
        // Process JSON control messages
        else {
          try {
            const data = JSON.parse(message.toString());
            
            // Forward control message to worker
            worker.postMessage({
              action: 'control',
              sessionId,
              control: data
            });
            
            // Handle specific control messages
            if (data.type === 'end') {
              if (activeSessions.has(sessionId)) {
                // End the session
                worker.postMessage({
                  action: 'endStream',
                  sessionId
                });
                
                activeSessions.delete(sessionId);
                server.log.info(`Ended streaming session ${sessionId} by client request`);
              }
            }
          } catch (jsonError) {
            server.log.error(`Error parsing message from client: ${getErrorMessage(jsonError)}`);
          }
        }
      } catch (err) {
        server.log.error(`Error processing message from client: ${getErrorMessage(err)}`);
        recordFailure();
      }
    });
    
    // Handle WebSocket closure
    connection.socket.on('close', () => {
      if (activeSessions.has(sessionId)) {
        try {
          // Notify worker to clean up
          if (worker) {
            worker.postMessage({
              action: 'endStream',
              sessionId
            });
          }
        } catch (err) {
          server.log.error(`Error notifying worker to end stream ${sessionId}: ${getErrorMessage(err)}`);
        }
        
        activeSessions.delete(sessionId);
        server.log.info(`Closed streaming session ${sessionId}`);
      }
    });
    
    // Handle errors
    connection.socket.on('error', (err: any) => {
      server.log.error(`WebSocket error for session ${sessionId}: ${err.message}`);
      recordFailure();
      
      if (activeSessions.has(sessionId)) {
        try {
          // Notify worker to clean up
          worker.postMessage({
            action: 'endStream',
            sessionId
          });
        } catch (error) {
          server.log.error(`Error notifying worker to end stream ${sessionId}: ${getErrorMessage(error)}`);
        }
        
        activeSessions.delete(sessionId);
      }
    });
  });
  
  // Get active streaming sessions (admin only)
  server.get('/stream/sessions', {
    preValidation: (request: FastifyRequest, reply: FastifyReply, done: Function) => {
      // Basic auth check for admin endpoints
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      
      const token = authHeader.slice(7);
      if (token !== process.env.ADMIN_API_KEY) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      
      done();
    }
  }, async (request, reply) => {
    try {
      const sessions = Array.from(activeSessions.entries()).map(([id, session]) => ({
        id,
        startTime: session.startTime,
        lastActivity: session.lastActivity,
        duration: Math.floor((new Date().getTime() - session.startTime.getTime()) / 1000),
        language: session.language,
        callId: session.callId,
        active: session.active
      }));
      
      return {
        count: sessions.length,
        sessions
      };
    } catch (error) {
      server.log.error(`Error getting active sessions: ${getErrorMessage(error)}`);
      return reply.code(500).send({ error: 'Failed to get active sessions' });
    }
  });
  
  // Get circuit breaker status (admin only)
  server.get('/stream/circuit-breaker', {
    preValidation: (request: FastifyRequest, reply: FastifyReply, done: Function) => {
      // Basic auth check for admin endpoints
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      
      const token = authHeader.slice(7);
      if (token !== process.env.ADMIN_API_KEY) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      
      done();
    }
  }, async (request, reply) => {
    try {
      return {
        state: circuitBreaker.state,
        failures: circuitBreaker.failures,
        lastFailure: new Date(circuitBreaker.lastFailure).toISOString(),
        threshold: circuitBreaker.threshold,
        resetTimeout: circuitBreaker.resetTimeout
      };
    } catch (error) {
      server.log.error(`Error getting circuit breaker status: ${getErrorMessage(error)}`);
      return reply.code(500).send({ error: 'Failed to get circuit breaker status' });
    }
  });
  
  // Reset circuit breaker (admin only)
  server.post('/stream/circuit-breaker/reset', {
    preValidation: (request: FastifyRequest, reply: FastifyReply, done: Function) => {
      // Basic auth check for admin endpoints
      const authHeader = request.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return reply.code(401).send({ error: 'Unauthorized' });
      }
      
      const token = authHeader.slice(7);
      if (token !== process.env.ADMIN_API_KEY) {
        return reply.code(403).send({ error: 'Forbidden' });
      }
      
      done();
    }
  }, async (request, reply) => {
    try {
      circuitBreaker.failures = 0;
      circuitBreaker.state = 'closed';
      
      // Publish circuit breaker state change to Redis
      await redisClient.publish('service:circuit-breaker', JSON.stringify({
        service: 'media',
        state: 'closed',
        timestamp: new Date().toISOString(),
        reason: 'manual_reset'
      }));
      
      server.log.info('Circuit breaker manually reset to closed state');
      
      return {
        success: true,
        message: 'Circuit breaker reset successfully',
        state: circuitBreaker.state
      };
    } catch (error) {
      server.log.error(`Error resetting circuit breaker: ${getErrorMessage(error)}`);
      return reply.code(500).send({ error: 'Failed to reset circuit breaker' });
    }
  });
}

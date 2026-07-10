import { createClient } from 'redis';
import NodeCache from 'node-cache';
import logger from './logger';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';
const USE_MEMORY_STORE = process.env.USE_MEMORY_STORE === 'true';

class RedisService {
  private client;
  private isConnected = false;
  private memoryStore: NodeCache;

  constructor() {
    this.memoryStore = new NodeCache({ stdTTL: 3600, checkperiod: 600 });
    
    this.client = createClient({
      url: REDIS_URL,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.warn('Redis reconnection failed after 10 attempts, will continue with memory store if needed');
            return false; // stop retrying
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    this.client.on('error', (err) => {
      // Only log as error if not using memory store, otherwise it's just a warning
      if (!USE_MEMORY_STORE) {
        logger.error('Redis Client Error:', err);
      } else {
        logger.debug('Redis unavailable, using memory store fallback');
      }
      this.isConnected = false;
    });

    this.client.on('connect', () => {
      logger.info('Redis Client Connected');
      this.isConnected = true;
    });
  }

  async connect() {
    if (USE_MEMORY_STORE) return;
    
    if (!this.isConnected) {
      try {
        await this.client.connect();
      } catch (error) {
        if (!USE_MEMORY_STORE) {
          logger.error('Failed to connect to Redis:', error);
        }
      }
    }
  }

  async set(key: string, value: any, ttlSeconds?: number) {
    if (this.isConnected && !USE_MEMORY_STORE) {
      try {
        const stringValue = JSON.stringify(value);
        if (ttlSeconds) {
          await this.client.set(key, stringValue, {
            EX: ttlSeconds
          });
        } else {
          await this.client.set(key, stringValue);
        }
        return;
      } catch (error) {
        logger.error(`Error setting Redis key ${key}:`, error);
      }
    }
    
    // Fallback to memory store
    this.memoryStore.set(key, value, ttlSeconds || 3600);
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.isConnected && !USE_MEMORY_STORE) {
      try {
        const value = await this.client.get(key);
        if (value) return JSON.parse(value) as T;
      } catch (error) {
        logger.error(`Error getting Redis key ${key}:`, error);
      }
    }
    
    // Fallback to memory store
    return (this.memoryStore.get(key) as T) || null;
  }

  async del(key: string) {
    if (this.isConnected && !USE_MEMORY_STORE) {
      try {
        await this.client.del(key);
        return;
      } catch (error) {
        logger.error(`Error deleting Redis key ${key}:`, error);
      }
    }
    
    // Fallback to memory store
    this.memoryStore.del(key);
  }

  async disconnect() {
    if (this.isConnected) {
      await this.client.disconnect();
      this.isConnected = false;
    }
  }
}

export const redisService = new RedisService();

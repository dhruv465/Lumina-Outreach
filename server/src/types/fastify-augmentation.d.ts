/**
 * Fastify type augmentations
 * Extends Fastify types with custom properties
 */

import 'fastify';
import { IncomingMessage } from 'http';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      role: string;
      [key: string]: any;
    };
  }
}

declare module 'http' {
  interface IncomingMessage {
    originalUrl?: string;
    protocol?: string;
  }
}

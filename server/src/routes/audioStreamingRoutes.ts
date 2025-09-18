import { FastifyInstance } from 'fastify';
import { AudioStreamingService } from '../services/audioStreamingService';

export default async function (fastify, options: { audioStreamingService: AudioStreamingService }) {
  fastify.get('/health', (req, reply) => {
    const health = options.audioStreamingService.getHealthStatus();
    reply.send(health);
  });
}
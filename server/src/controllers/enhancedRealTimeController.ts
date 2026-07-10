import { FastifyReply, FastifyRequest } from 'fastify';

const removed = (reply: FastifyReply) =>
  reply.code(410).send({
    error: 'Legacy realtime voice pipeline removed',
    message: 'Realtime call media is handled by the LiveKit agent.',
  });

export const handleRealTimeMediaStream = async (_req: FastifyRequest, reply: FastifyReply): Promise<any> => {
  return removed(reply);
};

export const getHealthStatus = async (_req: FastifyRequest, reply: FastifyReply): Promise<any> => {
  return removed(reply);
};

export const getCallMetrics = async (_req: FastifyRequest, reply: FastifyReply): Promise<any> => {
  return removed(reply);
};

export const triggerStateTransition = async (_req: FastifyRequest, reply: FastifyReply): Promise<any> => {
  return removed(reply);
};

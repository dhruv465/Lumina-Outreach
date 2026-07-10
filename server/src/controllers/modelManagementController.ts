import { FastifyReply, FastifyRequest } from 'fastify';

const removed = (_req: FastifyRequest, res: FastifyReply) =>
  res.status(410).send({
    success: false,
    message: 'Legacy Deepgram model management removed; speech models now live in the LiveKit agent.',
  });

export const testModelCompatibility = removed;
export const getAvailableModels = removed;
export const batchTestModels = removed;
export const getModelRegistry = removed;
export const updateModelConfiguration = removed;
export const suggestOptimalConfiguration = removed;

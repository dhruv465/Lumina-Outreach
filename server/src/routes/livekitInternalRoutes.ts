import { FastifyInstance } from 'fastify';
import Call from '../models/Call';
import Lead from '../models/Lead';
import callService from '../services/callService';
import { serviceAuth } from '../middleware/serviceAuth';
import logger, { getErrorMessage } from '../utils/logger';

export default async function livekitInternalRoutes(fastify: FastifyInstance) {
  fastify.addHook('preHandler', serviceAuth);

  fastify.get<{ Params: { leadId: string } }>('/leads/:leadId', async (request, reply) => {
    const lead = await Lead.findById(request.params.leadId).select('name company title notes phoneNumber');
    if (!lead) return reply.code(404).send({ error: 'Lead not found' });
    return {
      name: lead.name,
      company: (lead as any).company || '',
      title: (lead as any).title || '',
      notes: (lead as any).notes || '',
    };
  });

  fastify.post<{ Params: { callId: string }; Body: { outcome: string; notes?: string } }>(
    '/calls/:callId/outcome',
    async (request, reply) => {
      const { outcome, notes } = request.body || ({} as any);
      if (!outcome) return reply.code(400).send({ error: 'outcome is required' });
      const call = await Call.findByIdAndUpdate(
        request.params.callId,
        { outcome, ...(notes ? { notes } : {}) },
        { new: true }
      );
      if (!call) return reply.code(404).send({ error: 'Call not found' });
      return { success: true };
    }
  );

  fastify.post<{
    Params: { callId: string };
    Body: { transcript: string; conversation_log: Array<{ role: string; content: string }> };
  }>('/calls/:callId/transcript', async (request, reply) => {
    const { transcript, conversation_log } = request.body || ({} as any);
    const call = await Call.findByIdAndUpdate(
      request.params.callId,
      {
        transcript: transcript || '',
        conversationLog: (conversation_log || []).map((m) => ({
          role: m.role,
          content: m.content,
          timestamp: new Date(),
        })),
      },
      { new: true }
    );
    if (!call) return reply.code(404).send({ error: 'Call not found' });
    return { success: true };
  });

  fastify.post<{ Params: { callId: string }; Body: { date_time: string; notes?: string } }>(
    '/calls/:callId/callback',
    async (request, reply) => {
      const { date_time, notes } = request.body || ({} as any);
      const when = new Date(date_time);
      if (!date_time || isNaN(when.getTime())) {
        return reply.code(400).send({ error: 'date_time must be a valid ISO datetime' });
      }
      try {
        await callService.scheduleCallback(request.params.callId, when, notes || '');
        return { success: true };
      } catch (error) {
        logger.error(`callback scheduling failed: ${getErrorMessage(error)}`);
        return reply.code(404).send({ error: 'Call not found' });
      }
    }
  );
}

import { FastifyReply, FastifyRequest } from 'fastify';
import Call, { ICall } from '../models/Call';

const legacyVoicePipelineRemoved = (reply: FastifyReply) =>
  reply.code(410).send({
    error: 'Legacy voice pipeline removed',
    message: 'Voice webhooks are handled by LiveKit webhooks.',
  });

export async function handleTwilioVoiceWebhook(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
  legacyVoicePipelineRemoved(reply);
}

export async function handleTwilioStatusWebhook(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
  legacyVoicePipelineRemoved(reply);
}

export async function handleTwilioGatherWebhook(_req: FastifyRequest, reply: FastifyReply): Promise<void> {
  legacyVoicePipelineRemoved(reply);
}

export function handleTwilioStreamWebhook(_req: FastifyRequest, reply: FastifyReply): void {
  legacyVoicePipelineRemoved(reply);
}

export async function updateCallWithOutcome(callId: string, outcome: string, notes?: string): Promise<ICall | null> {
  return Call.findByIdAndUpdate(
    callId,
    {
      outcome,
      notes: notes || '',
      updatedAt: new Date(),
    },
    { new: true }
  );
}

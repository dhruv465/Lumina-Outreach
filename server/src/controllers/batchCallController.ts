import { FastifyRequest, FastifyReply } from 'fastify';
import { batchCallService } from '../services/batchCallService';
import Campaign from '../models/Campaign';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';

export class BatchCallController {
  async createBatch(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { campaignId, leadIds, name, config } = req.body as any;
      const user = (req as any).user;

      if (!campaignId || !leadIds || !Array.isArray(leadIds) || leadIds.length === 0) {
        return reply.status(400).send({ success: false, error: 'Missing required fields: campaignId and leadIds array' });
      }

      // Ownership: the caller must own the campaign (or be admin). Prevents an
      // authenticated user from launching a batch against someone else's
      // campaign (IDOR).
      const campaign = await Campaign.findById(campaignId).select('createdBy');
      if (!campaign) {
        return reply.status(404).send({ success: false, error: 'Campaign not found' });
      }
      if (user?.role !== 'admin' && campaign.createdBy.toString() !== user?.id) {
        return reply.status(403).send({ success: false, error: 'Access denied: you do not own this campaign' });
      }

      const batch = await batchCallService.createBatch({
        name: name || `Batch Call ${new Date().toLocaleString()}`,
        campaignId,
        leadIds,
        createdBy: user?.id || 'system',
        config
      });

      return reply.status(201).send({ success: true, data: batch });
    } catch (error) {
      logger.error(`Error creating batch call: ${getErrorMessage(error)}`);
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  }

  async getBatchStatus(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as any;
      const batch = await batchCallService.getBatchStatus(id);
      
      if (!batch) {
        return reply.status(404).send({ success: false, error: 'Batch not found' });
      }

      return reply.send({ success: true, data: batch });
    } catch (error) {
      logger.error(`Error getting batch status: ${getErrorMessage(error)}`);
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  }

  async listBatches(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { limit } = req.query as any;
      const batches = await batchCallService.listBatches(Number(limit) || 20);
      return reply.send({ success: true, data: batches });
    } catch (error) {
      logger.error(`Error listing batches: ${getErrorMessage(error)}`);
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  }
}

export const batchCallController = new BatchCallController();

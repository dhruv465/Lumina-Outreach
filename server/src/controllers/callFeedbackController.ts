import { FastifyRequest, FastifyReply } from 'fastify';
import CallFeedback from '../models/CallFeedback';
import Campaign from '../models/Campaign';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';

export class CallFeedbackController {
  /**
   * Get pending feedback for review
   */
  async getPendingFeedback(req: FastifyRequest, reply: FastifyReply) {
    try {
      const user = (req as any).user;
      const { campaignId, limit = 50, skip = 0 } = req.query as any;

      const query: any = { isUsedForTraining: false };
      if (campaignId) query.campaignId = campaignId;

      // Non-admins only see feedback for campaigns they own (prevents IDOR
      // enumeration of other users' campaign feedback).
      if (user?.role !== 'admin') {
        const ownedIds = (await Campaign.find({ createdBy: user?.id }).select('_id')).map(
          (c) => c._id
        );
        query.campaignId =
          campaignId && !ownedIds.some((id) => id.toString() === String(campaignId))
            ? { $in: [] }
            : campaignId || { $in: ownedIds };
      }

      const feedback = await CallFeedback.find(query)
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .skip(Number(skip))
        .populate('campaignId', 'name');

      const total = await CallFeedback.countDocuments(query);

      return reply.send({
        success: true,
        data: feedback,
        pagination: {
          total,
          limit: Number(limit),
          skip: Number(skip)
        }
      });
    } catch (error) {
      logger.error(`Error fetching pending feedback: ${getErrorMessage(error)}`);
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  }

  /**
   * Review and update a feedback entry (Approve/Correct)
   */
  async reviewFeedback(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as any;
      const { actualIntent, isCorrect, notes } = req.body as any;

      const feedback = await CallFeedback.findById(id);
      if (!feedback) {
        return reply.status(404).send({ success: false, error: 'Feedback not found' });
      }

      // Ownership: non-admins may only review feedback for campaigns they own.
      const user = (req as any).user;
      if (user?.role !== 'admin') {
        const campaign = await Campaign.findById(feedback.campaignId).select('createdBy');
        if (!campaign || campaign.createdBy.toString() !== user?.id) {
          return reply.status(403).send({ success: false, error: 'Access denied' });
        }
      }

      feedback.actualIntent = actualIntent;
      feedback.isCorrect = isCorrect !== undefined ? isCorrect : feedback.isCorrect;
      feedback.notes = notes;
      // Note: we don't set isUsedForTraining to true here, 
      // the daily retraining job will pick it up and set it.

      await feedback.save();

      return reply.send({ success: true, data: feedback });
    } catch (error) {
      logger.error(`Error reviewing feedback: ${getErrorMessage(error)}`);
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  }

  /**
   * Manually trigger the retraining process
   */
  async triggerRetraining(req: FastifyRequest, reply: FastifyReply) {
    return reply.status(410).send({
      success: false,
      error: 'Dialogflow retraining removed; agent training now lives outside the server control plane',
    });
  }
}

export const callFeedbackController = new CallFeedbackController();

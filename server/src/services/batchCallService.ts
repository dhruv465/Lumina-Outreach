import BatchCall from '../models/BatchCall';
import { runWithConcurrency } from '../utils/concurrencyPool';
import { FinancialService } from '../utils/financialService';
import logger from '../utils/logger';
import * as Sentry from '@sentry/node';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class BatchCallService {
  /** Create a batch and start processing it (non-blocking). */
  async createBatch(params: {
    name: string;
    campaignId: string;
    leadIds: string[];
    createdBy: string;
    config?: any;
  }) {
    const batch = await BatchCall.create({
      name: params.name,
      campaignId: params.campaignId,
      leadIds: params.leadIds,
      createdBy: params.createdBy,
      status: 'processing',
      startedAt: new Date(),
      processedLeadIds: [],
      stats: {
        total: params.leadIds.length,
        queued: params.leadIds.length,
        processed: 0,
        successful: 0,
        failed: 0,
      },
      config: params.config || { maxConcurrency: 10, retryCount: 1, delayBetweenCalls: 2000 },
    });

    logger.info(`Starting batch ${batch._id} with ${params.leadIds.length} leads`);
    // Fire-and-forget; MongoDB is the source of truth so a crash is recoverable.
    void this.runBatch(batch._id.toString());
    return batch;
  }

  /** Process every pending lead of a batch with bounded concurrency. */
  async runBatch(batchId: string): Promise<void> {
    try {
      const batch = await BatchCall.findById(batchId);
      if (!batch || batch.status === 'completed') return;

      const processed = new Set(batch.processedLeadIds.map((id: any) => id.toString()));
      const pending = batch.leadIds
        .map((id: any) => id.toString())
        .filter((id: string) => !processed.has(id));

      if (pending.length === 0) {
        await this.finalizeIfDone(batchId);
        return;
      }

      const envCap = parseInt(process.env.LUMINA_BATCH_CONCURRENCY || '2', 10);
      const limit = Math.min(batch.config.maxConcurrency || 2, envCap);
      const delay = batch.config.delayBetweenCalls || 0;
      const retries = batch.config.retryCount || 1;
      const campaignId = batch.campaignId.toString();
      const initiatingUserId = batch.createdBy.toString();

      let budgetDepleted = false;

      await runWithConcurrency(pending, limit, async (leadId) => {
        if (budgetDepleted) return;

        if (!(await FinancialService.isCampaignBudgetAvailable(campaignId))) {
          budgetDepleted = true;
          logger.warn(`Batch ${batchId}: campaign ${campaignId} budget depleted, stopping`);
          return;
        }

        if (delay > 0) await sleep(delay);

        let ok = false;
        for (let attempt = 0; attempt < retries && !ok; attempt++) {
          try {
            await this.processSingleCall({ batchId, leadId, campaignId, initiatingUserId });
            ok = true;
          } catch (err: any) {
            logger.error(`Batch ${batchId} lead ${leadId} attempt ${attempt + 1} failed: ${err.message}`);
            if (process.env.SENTRY_DSN) Sentry.captureException(err);
          }
        }

        await BatchCall.updateOne({ _id: batchId }, { $addToSet: { processedLeadIds: leadId } });
        await this.updateBatchStats(batchId, ok ? 'successful' : 'failed');
      });

      if (budgetDepleted) {
        await BatchCall.updateOne({ _id: batchId }, { $set: { status: 'paused' } });
        return;
      }
      await this.finalizeIfDone(batchId);
    } catch (err: any) {
      logger.error(`runBatch ${batchId} crashed: ${err.message}`);
      if (process.env.SENTRY_DSN) Sentry.captureException(err);
    }
  }

  /** Re-run any batch left in `processing` after a restart (idempotent). */
  async resumeInterruptedBatches(): Promise<void> {
    const stuck = await BatchCall.find({ status: 'processing' }).select('_id');
    if (stuck.length === 0) return;
    logger.info(`Resuming ${stuck.length} interrupted batch(es)`);
    for (const b of stuck) void this.runBatch(b._id.toString());
  }

  private async processSingleCall(data: {
    batchId: string;
    leadId: string;
    campaignId: string;
    initiatingUserId: string;
  }) {
    const { leadId, campaignId, initiatingUserId } = data;
    // LiveKit-only: batch calls dispatch through the LiveKit agent.
    const { initiateLiveKitCall } = await import('../integrations/livekit/dispatchService');
    await initiateLiveKitCall({ leadId, campaignId, initiatingUserId });
  }

  private async updateBatchStats(batchId: string, status: 'successful' | 'failed') {
    try {
      const updateDoc = status === 'successful'
        ? { $inc: { 'stats.processed': 1, 'stats.successful': 1, 'stats.queued': -1 } }
        : { $inc: { 'stats.processed': 1, 'stats.failed': 1, 'stats.queued': -1 } };
      await BatchCall.findByIdAndUpdate(batchId, updateDoc, { new: true });
      await this.finalizeIfDone(batchId);
    } catch (err: any) {
      logger.error(`Failed to update batch stats for ${batchId}: ${err.message}`);
    }
  }

  private async finalizeIfDone(batchId: string) {
    const batch = await BatchCall.findById(batchId);
    // Completion is derived from the durable truth (`processedLeadIds`), not
    // `stats.queued`. A crash between the `$addToSet processedLeadIds` and the
    // `stats.queued` decrement would otherwise leave `queued > 0` forever and
    // strand a fully-processed batch in `processing`.
    if (
      batch &&
      batch.processedLeadIds.length >= batch.leadIds.length &&
      batch.status !== 'completed'
    ) {
      batch.status = 'completed';
      batch.completedAt = new Date();
      await batch.save();
      logger.info(`Batch ${batchId} completed.`);
    }
  }

  async getBatchStatus(batchId: string) {
    return await BatchCall.findById(batchId).populate('campaignId', 'name');
  }

  async listBatches(limit: number = 20) {
    return await BatchCall.find().sort({ createdAt: -1 }).limit(limit).populate('campaignId', 'name');
  }
}

export const batchCallService = new BatchCallService();

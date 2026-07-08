import BatchCall from '../models/BatchCall';
import Lead from '../models/Lead';
import Campaign from '../models/Campaign';
import { getTelephonyService } from './realTelephonyService';
import logger from '../utils/logger';
import mongoose from 'mongoose';
import { Queue, Worker, Job } from 'bullmq';
import * as Sentry from '@sentry/node';
import { FinancialService } from '../utils/financialService';

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379';

class BatchCallService {
  private callQueue: Queue;
  private callWorker: Worker;

  constructor() {
    // Create the BullMQ Queue
    this.callQueue = new Queue('call-queue', {
      connection: { url: REDIS_URL }
    });

    // Create the BullMQ Worker
    this.callWorker = new Worker('call-queue', async (job: Job) => {
      return this.processSingleCall(job.data);
    }, {
      connection: { url: REDIS_URL },
      // Pilot cap (Task 18): LiveKit free tier + a single dev agent worker can
      // only serve a couple of concurrent calls. Keep this low while the
      // LiveKit path is validated; revert to a higher value at Phase 4
      // scale-up when the agent is deployed to LiveKit Cloud with autoscaling.
      concurrency: 2,
    });

    this.callWorker.on('completed', async (job) => {
      logger.info(`Job ${job.id} completed for lead ${job.data.leadId}`);
      await this.updateBatchStats(job.data.batchId, 'successful');
    });

    this.callWorker.on('failed', async (job, err) => {
      logger.error(`Job ${job?.id} failed for lead ${job?.data?.leadId}: ${err.message}`);
      if (process.env.SENTRY_DSN) Sentry.captureException(err);
      if (job) {
        await this.updateBatchStats(job.data.batchId, 'failed');
      }
    });
  }

  private async updateBatchStats(batchId: string, status: 'successful' | 'failed') {
    try {
      const updateDoc = status === 'successful'
        ? { $inc: { 'stats.processed': 1, 'stats.successful': 1, 'stats.queued': -1 } }
        : { $inc: { 'stats.processed': 1, 'stats.failed': 1, 'stats.queued': -1 } };

      const batch = await BatchCall.findByIdAndUpdate(batchId, updateDoc, { new: true });
      
      // Check if batch is completed
      if (batch && batch.stats.queued <= 0 && batch.status !== 'completed') {
        batch.status = 'completed';
        batch.completedAt = new Date();
        await batch.save();
        logger.info(`Batch ${batchId} is completely processed.`);
      }
    } catch (err) {
      logger.error(`Failed to update batch stats for ${batchId}: ${err.message}`);
    }
  }

  private async processSingleCall(data: { batchId: string, leadId: string, campaignId: string }) {
    const { batchId, leadId, campaignId } = data;
    
    // Check if campaign budget is still available
    const isBudgetAvailable = await FinancialService.isCampaignBudgetAvailable(campaignId);
    if (!isBudgetAvailable) {
      logger.warn(`Skipping call for lead ${leadId} in batch ${batchId} due to campaign budget depletion`);
      return;
    }

    const campaign = await Campaign.findById(campaignId);
    if (campaign?.telephonyProvider === 'livekit') {
      const { initiateLiveKitCall } = await import('../integrations/livekit/dispatchService');
      await initiateLiveKitCall({ leadId, campaignId });
      return;
    }

    const lead = await Lead.findById(leadId);
    if (!lead) throw new Error(`Lead ${leadId} not found`);

    const telephonyService = getTelephonyService();
    const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || process.env.API_BASE_URL || 'http://localhost:8000';
    const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER || '';

    const conversationId = new mongoose.Types.ObjectId().toString();
    const callbackUrl = `${WEBHOOK_BASE_URL}/api/calls/twiml/${campaignId}/${conversationId}`;

    await telephonyService.makeCall(
      lead.phoneNumber,
      TWILIO_PHONE_NUMBER,
      callbackUrl
    );
  }

  /**
   * Create a new batch call job
   */
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
      stats: {
        total: params.leadIds.length,
        queued: params.leadIds.length,
        processed: 0,
        successful: 0,
        failed: 0
      },
      config: params.config || {
        maxConcurrency: 10,
        retryCount: 1,
        delayBetweenCalls: 2000
      }
    });

    logger.info(`Queuing ${params.leadIds.length} calls for batch ${batch._id}`);

    // Add all leads to the BullMQ queue
    const jobs = params.leadIds.map((leadId, index) => ({
      name: 'make-call',
      data: {
        batchId: batch._id.toString(),
        leadId,
        campaignId: params.campaignId
      },
      opts: {
        // Space out the calls to respect delayBetweenCalls
        delay: index * (batch.config.delayBetweenCalls || 2000),
        attempts: batch.config.retryCount || 1,
        backoff: {
          type: 'exponential',
          delay: 5000
        }
      }
    }));

    await this.callQueue.addBulk(jobs);

    return batch;
  }

  async getBatchStatus(batchId: string) {
    return await BatchCall.findById(batchId).populate('campaignId', 'name');
  }

  async listBatches(limit: number = 20) {
    return await BatchCall.find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('campaignId', 'name');
  }
}

export const batchCallService = new BatchCallService();

import mongoose from 'mongoose';

export interface IBatchCall extends mongoose.Document {
  name: string;
  campaignId: mongoose.Types.ObjectId;
  leadIds: mongoose.Types.ObjectId[];
  processedLeadIds: mongoose.Types.ObjectId[];
  status: 'pending' | 'processing' | 'completed' | 'paused' | 'failed';
  stats: {
    total: number;
    processed: number;
    successful: number;
    failed: number;
    queued: number;
  };
  config: {
    maxConcurrency: number;
    retryCount: number;
    delayBetweenCalls: number; // in milliseconds
  };
  createdBy: mongoose.Types.ObjectId;
  startedAt?: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const BatchCallSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    leadIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Lead' }],
    processedLeadIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Lead', default: [] }],
    status: { 
      type: String, 
      enum: ['pending', 'processing', 'completed', 'paused', 'failed'], 
      default: 'pending' 
    },
    stats: {
      total: { type: Number, default: 0 },
      processed: { type: Number, default: 0 },
      successful: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      queued: { type: Number, default: 0 },
    },
    config: {
      maxConcurrency: { type: Number, default: 10 },
      retryCount: { type: Number, default: 1 },
      delayBetweenCalls: { type: Number, default: 1000 },
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

const BatchCall = mongoose.model<IBatchCall>('BatchCall', BatchCallSchema);

export default BatchCall;

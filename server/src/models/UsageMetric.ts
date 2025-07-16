/**
 * UsageMetric Model
 * 
 * Stores usage metrics for the knowledge management system.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface IUsageMetric extends Document {
  userId: mongoose.Types.ObjectId;
  action: 'search' | 'retrieval' | 'feedback';
  query?: string;
  resultCount?: number;
  responseTime?: number;
  relevanceScore?: number;
  timestamp: Date;
}

const UsageMetricSchema = new Schema<IUsageMetric>(
  {
    userId: { 
      type: Schema.Types.ObjectId, 
      ref: 'User', 
      required: true, 
      index: true 
    },
    action: { 
      type: String, 
      enum: ['search', 'retrieval', 'feedback'],
      required: true,
      index: true
    },
    query: { 
      type: String 
    },
    resultCount: { 
      type: Number 
    },
    responseTime: { 
      type: Number 
    },
    relevanceScore: { 
      type: Number, 
      min: 0, 
      max: 5 
    },
    timestamp: { 
      type: Date, 
      default: Date.now, 
      required: true,
      index: true
    }
  },
  { 
    timestamps: false 
  }
);

// Compound index for time-based queries
UsageMetricSchema.index({ userId: 1, timestamp: -1 });

export const UsageMetric = mongoose.model<IUsageMetric>('UsageMetric', UsageMetricSchema);

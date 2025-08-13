/**
 * FAQ Model
 * 
 * Represents frequently asked questions for the RAG system.
 */

import mongoose, { Schema, Document as MongooseDocument } from 'mongoose';

export interface IFAQ extends MongooseDocument {
  question: string;
  answer: string;
  category?: string;
  tags: string[];
  type: 'faq';
  source: string;
  metadata: Record<string, any>;
  embedding?: number[];
  isActive: boolean;
  priority: number;
  userId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const FAQSchema = new Schema<IFAQ>(
  {
    question: { 
      type: String, 
      required: true, 
      index: true 
    },
    answer: { 
      type: String, 
      required: true 
    },
    category: { 
      type: String,
      index: true 
    },
    tags: [{ 
      type: String, 
      index: true 
    }],
    type: { 
      type: String, 
      default: 'faq',
      index: true 
    },
    source: { 
      type: String, 
      default: 'manual',
      index: true 
    },
    metadata: { 
      type: Schema.Types.Mixed,
      default: {}
    },
    embedding: [{ 
      type: Number 
    }],
    isActive: { 
      type: Boolean, 
      default: true,
      index: true 
    },
    priority: { 
      type: Number, 
      default: 5,
      min: 1,
      max: 10,
      index: true 
    },
    userId: { 
      type: Schema.Types.ObjectId, 
      ref: 'User',
      index: true 
    }
  },
  { 
    timestamps: true 
  }
);

// Text index for full-text search
FAQSchema.index({ 
  question: 'text', 
  answer: 'text',
  category: 'text',
  tags: 'text'
});

// Compound indexes for efficient querying
FAQSchema.index({ isActive: 1, priority: -1 });
FAQSchema.index({ category: 1, isActive: 1 });

export const FAQ = mongoose.model<IFAQ>('FAQ', FAQSchema);
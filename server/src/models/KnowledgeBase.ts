/**
 * Knowledge Base Model
 * 
 * Represents knowledge base entries for the RAG system.
 * Contains indexed content for semantic search and retrieval.
 */

import mongoose, { Schema, Document as MongooseDocument } from 'mongoose';

export interface IKnowledgeBase extends MongooseDocument {
  title: string;
  content: string;
  type: 'product' | 'faq' | 'policy' | 'procedure' | 'knowledge-base' | 'user-defined';
  source: string;
  category?: string;
  tags: string[];
  metadata: Record<string, any>;
  embedding?: number[];
  relevanceScore?: number;
  isActive: boolean;
  userId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const KnowledgeBaseSchema = new Schema<IKnowledgeBase>(
  {
    title: { 
      type: String, 
      required: true, 
      index: true 
    },
    content: { 
      type: String, 
      required: true 
    },
    type: { 
      type: String, 
      enum: ['product', 'faq', 'policy', 'procedure', 'knowledge-base', 'user-defined'],
      default: 'knowledge-base',
      index: true 
    },
    source: { 
      type: String, 
      required: true,
      index: true 
    },
    category: { 
      type: String,
      index: true 
    },
    tags: [{ 
      type: String, 
      index: true 
    }],
    metadata: { 
      type: Schema.Types.Mixed,
      default: {}
    },
    embedding: [{ 
      type: Number 
    }],
    relevanceScore: { 
      type: Number,
      default: 0 
    },
    isActive: { 
      type: Boolean, 
      default: true,
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
KnowledgeBaseSchema.index({ 
  title: 'text', 
  content: 'text',
  category: 'text',
  tags: 'text'
});

// Compound indexes for efficient querying
KnowledgeBaseSchema.index({ type: 1, isActive: 1 });
KnowledgeBaseSchema.index({ source: 1, type: 1 });
KnowledgeBaseSchema.index({ userId: 1, isActive: 1 });

export const KnowledgeBase = mongoose.model<IKnowledgeBase>('KnowledgeBase', KnowledgeBaseSchema);
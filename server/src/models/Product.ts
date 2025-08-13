/**
 * Product Model
 * 
 * Represents product information for the RAG system.
 */

import mongoose, { Schema, Document as MongooseDocument } from 'mongoose';

export interface IProduct extends MongooseDocument {
  name: string;
  description: string;
  features: string[];
  specifications?: Record<string, any>;
  pricing?: {
    currency: string;
    amount: number;
    period?: string;
  };
  category?: string;
  tags: string[];
  type: 'product';
  source: string;
  metadata: Record<string, any>;
  embedding?: number[];
  isActive: boolean;
  userId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const ProductSchema = new Schema<IProduct>(
  {
    name: { 
      type: String, 
      required: true, 
      index: true 
    },
    description: { 
      type: String, 
      required: true 
    },
    features: [{ 
      type: String 
    }],
    specifications: { 
      type: Schema.Types.Mixed 
    },
    pricing: {
      currency: { type: String },
      amount: { type: Number },
      period: { type: String }
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
      default: 'product',
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
ProductSchema.index({ 
  name: 'text', 
  description: 'text',
  features: 'text',
  category: 'text',
  tags: 'text'
});

// Compound indexes for efficient querying
ProductSchema.index({ isActive: 1, category: 1 });
ProductSchema.index({ name: 1, isActive: 1 });

export const Product = mongoose.model<IProduct>('Product', ProductSchema);
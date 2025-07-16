/**
 * Chunk Model
 * 
 * Represents a text chunk from a document.
 * Used for vector search and RAG operations.
 */

import mongoose, { Schema, Document as MongooseDocument } from 'mongoose';

export interface IChunk extends MongooseDocument {
  documentId: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  content: string;
  index: number;
  metadata?: Record<string, any>;
  tags?: string[];
  importance?: number;
  vectorId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const ChunkSchema = new Schema<IChunk>(
  {
    documentId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Document', 
      required: true, 
      index: true 
    },
    userId: { 
      type: Schema.Types.ObjectId, 
      ref: 'User', 
      required: true, 
      index: true 
    },
    content: { 
      type: String, 
      required: true 
    },
    index: { 
      type: Number, 
      required: true 
    },
    metadata: { 
      type: Schema.Types.Mixed 
    },
    tags: [{ 
      type: String, 
      index: true 
    }],
    importance: { 
      type: Number, 
      default: 1, 
      min: 0, 
      max: 10 
    },
    vectorId: { 
      type: String 
    }
  },
  { 
    timestamps: true 
  }
);

// Text index for basic text search
ChunkSchema.index({ content: 'text' });

// Compound index for document ordering
ChunkSchema.index({ documentId: 1, index: 1 });

export const Chunk = mongoose.model<IChunk>('Chunk', ChunkSchema);

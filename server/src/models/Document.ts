/**
 * Document Model
 * 
 * Represents a document uploaded to the knowledge base.
 * Contains metadata about the document and references to its chunks.
 */

import mongoose, { Schema, Document as MongooseDocument } from 'mongoose';

export interface IDocument extends MongooseDocument {
  fileName: string;
  fileType: string;
  filePath: string;
  fileSize: number;
  userId: mongoose.Types.ObjectId;
  categoryId?: mongoose.Types.ObjectId;
  tags: string[];
  description?: string;
  metadata?: Record<string, any>;
  status: 'pending' | 'processing' | 'processed' | 'error';
  processingError?: string;
  chunkCount: number;
  chunks: mongoose.Types.ObjectId[];
  processingStarted?: Date;
  processingCompleted?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const DocumentSchema = new Schema<IDocument>(
  {
    fileName: { type: String, required: true, index: true },
    fileType: { type: String, required: true },
    filePath: { type: String, required: true },
    fileSize: { type: Number, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'Category', index: true },
    tags: [{ type: String, index: true }],
    description: { type: String },
    metadata: { type: Schema.Types.Mixed },
    status: { 
      type: String, 
      enum: ['pending', 'processing', 'processed', 'error'],
      default: 'pending',
      index: true
    },
    processingError: { type: String },
    chunkCount: { type: Number, default: 0 },
    chunks: [{ type: Schema.Types.ObjectId, ref: 'Chunk' }],
    processingStarted: { type: Date },
    processingCompleted: { type: Date }
  },
  { 
    timestamps: true 
  }
);

// Add text index for search
DocumentSchema.index({ 
  fileName: 'text', 
  description: 'text'
});

export const Document = mongoose.model<IDocument>('Document', DocumentSchema);

/**
 * Tag Model
 * 
 * Represents a tag that can be applied to documents and chunks.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ITag extends Document {
  name: string;
  color: string;
  userId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const TagSchema = new Schema<ITag>(
  {
    name: { 
      type: String, 
      required: true, 
      index: true 
    },
    color: { 
      type: String, 
      required: true, 
      default: '#cccccc' 
    },
    userId: { 
      type: Schema.Types.ObjectId, 
      ref: 'User', 
      required: true, 
      index: true 
    }
  },
  { 
    timestamps: true 
  }
);

// Compound index for user-specific tags
TagSchema.index({ userId: 1, name: 1 });

export const Tag = mongoose.model<ITag>('Tag', TagSchema);

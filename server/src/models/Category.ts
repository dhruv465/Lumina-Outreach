/**
 * Category Model
 * 
 * Represents a hierarchical category for organizing documents.
 */

import mongoose, { Schema, Document } from 'mongoose';

export interface ICategory extends Document {
  name: string;
  description?: string;
  userId: mongoose.Types.ObjectId;
  parentId?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CategorySchema = new Schema<ICategory>(
  {
    name: { 
      type: String, 
      required: true, 
      index: true 
    },
    description: { 
      type: String 
    },
    userId: { 
      type: Schema.Types.ObjectId, 
      ref: 'User', 
      required: true, 
      index: true 
    },
    parentId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Category',
      index: true 
    }
  },
  { 
    timestamps: true 
  }
);

// Compound index for user-specific categories
CategorySchema.index({ userId: 1, name: 1 });

export const Category = mongoose.model<ICategory>('Category', CategorySchema);

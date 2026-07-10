import mongoose from 'mongoose';

export interface ICallFeedback extends mongoose.Document {
  callId: string;
  conversationId: string;
  leadId: string;
  campaignId: string;
  text: string;
  detectedIntent: string;
  detectedConfidence: number;
  actualIntent?: string; // Corrected intent by human or system
  isCorrect: boolean;
  notes?: string;
  isUsedForTraining: boolean;
  createdAt: Date;
}

const CallFeedbackSchema = new mongoose.Schema(
  {
    callId: { type: String, required: true },
    conversationId: { type: String, required: true },
    leadId: { type: String, required: true },
    campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
    text: { type: String, required: true },
    detectedIntent: { type: String, required: true },
    detectedConfidence: { type: Number, required: true },
    actualIntent: { type: String },
    isCorrect: { type: Boolean, default: true },
    notes: { type: String },
    isUsedForTraining: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const CallFeedback = mongoose.model<ICallFeedback>('CallFeedback', CallFeedbackSchema);

export default CallFeedback;

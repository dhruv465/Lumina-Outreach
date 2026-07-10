import api from './api';

export interface CallFeedback {
  _id: string;
  callId: string;
  conversationId: string;
  leadId: string;
  campaignId: {
    _id: string;
    name: string;
  };
  text: string;
  detectedIntent: string;
  detectedConfidence: number;
  actualIntent?: string;
  isCorrect: boolean;
  notes?: string;
  isUsedForTraining: boolean;
  createdAt: string;
}

export interface FeedbackPagination {
  total: number;
  limit: number;
  skip: number;
}

export interface FeedbackResponse {
  success: boolean;
  data: CallFeedback[];
  pagination: FeedbackPagination;
}

export const feedbackApi = {
  /**
   * Get pending feedback for review
   */
  getPendingFeedback: async (campaignId?: string, limit: number = 50, skip: number = 0): Promise<FeedbackResponse> => {
    const params = new URLSearchParams();
    if (campaignId) params.append('campaignId', campaignId);
    params.append('limit', limit.toString());
    params.append('skip', skip.toString());

    const response = await api.get(`/feedback/pending?${params.toString()}`);
    return response.data;
  },

  /**
   * Review and update a feedback entry
   */
  reviewFeedback: async (id: string, data: { actualIntent?: string; isCorrect?: boolean; notes?: string }): Promise<{ success: boolean; data: CallFeedback }> => {
    const response = await api.put(`/feedback/review/${id}`, data);
    return response.data;
  },

  /**
   * Trigger the retraining process manually
   */
  triggerRetraining: async (): Promise<{ success: boolean; message: string }> => {
    const response = await api.post('/feedback/retrain');
    return response.data;
  }
};

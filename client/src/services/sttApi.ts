import api from './api';

export interface STTModel {
  name: string;
  tier: 'free' | 'basic' | 'premium';
}

export interface STTModelsResponse {
  success: boolean;
  tier: 'free' | 'basic' | 'premium';
  models: string[];
  features?: {
    realtime: boolean;
    batch: boolean;
    streaming: boolean;
  };
  limits?: {
    requestsPerMinute: number;
    hoursPerMonth: number;
  };
  message?: string;
  error?: string;
}

/**
 * Fetch available Deepgram STT models based on the configured API key
 */
export const getAvailableSTTModels = async (): Promise<STTModelsResponse> => {
  try {
    const response = await api.get<STTModelsResponse>('/stt/models');
    return response.data;
  } catch (error: any) {
    console.error('Error fetching STT models:', error);
    return {
      success: false,
      tier: 'free',
      models: [],
      message: error.response?.data?.message || 'Failed to fetch STT models',
      error: error.message
    };
  }
};

export const sttApi = {
  getAvailableModels: getAvailableSTTModels
};

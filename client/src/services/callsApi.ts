import api from './api';

// Types
interface CallParams {
  page?: number;
  limit?: number;
  status?: string;
  campaignId?: string;
  leadId?: string;
  startDate?: string;
  endDate?: string;
  outcome?: string;
}

interface CallData {
  leadId: string;
  campaignId: string;
  scheduleTime?: string;
}

interface CallbackData {
  dateTime: string;
  notes?: string;
}

interface ExportCallsParams {
  format?: 'csv' | 'json' | 'xlsx';
  status?: string;
  campaignId?: string;
  startDate?: string;
  endDate?: string;
  outcome?: string;
}

// Call API endpoints
export const callsApi = {
  // Get call history with optional filters
  getCallHistory: async (params: CallParams = {}) => {
    const response = await api.get('/calls', { params });
    return response.data;
  },

  // Get a specific call by ID
  getCallById: async (id: string) => {
    const response = await api.get(`/calls/${id}`);
    return response.data;
  },

  // Initiate a new call
  initiateCall: async (callData: CallData) => {
    try {
      console.log('Calling initiateCall API with data:', callData);
      const response = await api.post('/calls/initiate', callData);
      console.log('API response:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error in initiateCall API:', error);
      // Rethrow the error to be handled by the component
      throw error;
    }
  },

  // Get call recording
  getCallRecording: async (id: string) => {
    const response = await api.get(`/calls/${id}/recording`);
    return response.data;
  },

  // Get call recording details
  getCallRecordingDetails: async (id: string) => {
    const response = await api.get(`/calls/${id}/recording-details`);
    return response.data;
  },

  // Sync all Twilio recordings (admin only)
  syncTwilioRecordings: async (days = 30) => {
    const response = await api.post('/calls/sync-recordings', { days });
    return response.data;
  },

  // Get call transcript
  getCallTranscript: async (id: string) => {
    const response = await api.get(`/calls/${id}/transcript`);
    return response.data;
  },

  // Schedule a callback
  scheduleCallback: async (id: string, callbackData: CallbackData) => {
    const response = await api.post(`/calls/${id}/schedule-callback`, callbackData);
    return response.data;
  },

  // Get call analytics
  getCallAnalytics: async (params: {campaignId?: string, startDate?: string, endDate?: string} = {}) => {
    const response = await api.get('/calls/analytics', { params });
    return response.data;
  },
  
  // Export call data
  exportCalls: async (params: ExportCallsParams = {}) => {
    const response = await api.get('/calls/export', { 
      params,
      responseType: 'blob'
    });
    return response.data;
  }
};

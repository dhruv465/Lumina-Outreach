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

  // Initiate a new call with enhanced error handling
  initiateCall: async (callData: CallData) => {
    try {
      console.log('Calling initiateCall API with data:', callData);
      
      // Validate required fields
      if (!callData.leadId) {
        throw new Error('Lead ID is required to initiate a call');
      }
      if (!callData.campaignId) {
        throw new Error('Campaign ID is required to initiate a call');
      }
      
      const response = await api.post('/calls/initiate', callData);
      console.log('API response:', response.data);
      
      if (!response.data) {
        throw new Error('No response data received from server');
      }
      
      return response.data;
    } catch (error: any) {
      console.error('Error in initiateCall API:', error);
      
      // Provide more specific error messages
      if (error.response?.status === 400) {
        throw new Error(error.response.data?.message || 'Invalid call parameters');
      } else if (error.response?.status === 404) {
        throw new Error('Lead or campaign not found');
      } else if (error.response?.status === 500) {
        throw new Error('Server error occurred while initiating call. Please try again.');
      } else if (error.message) {
        throw new Error(error.message);
      } else {
        throw new Error('Failed to initiate call. Please check your connection and try again.');
      }
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

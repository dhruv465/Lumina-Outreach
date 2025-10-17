import api from './api';

// Types
interface Campaign {
  id: string;
  name: string;
  status: string;
  description?: string;
  targetCount?: number;
  currentCount?: number;
}

interface CampaignsResponse {
  campaigns: Campaign[];
  pagination?: {
    page: number;
    pages: number;
    total: number;
    limit: number;
  };
}

export const campaignsApi = {
  /**
   * Get all campaigns
   */
  getCampaigns: async (): Promise<CampaignsResponse> => {
    const response = await api.get('/campaigns');
    return response.data;
  },

  /**
   * Get a single campaign by ID
   */
  getCampaign: async (id: string): Promise<Campaign> => {
    const response = await api.get(`/campaigns/${id}`);
    return response.data;
  },

  /**
   * Create a new campaign
   */
  createCampaign: async (data: Partial<Campaign>): Promise<Campaign> => {
    const response = await api.post('/campaigns', data);
    return response.data;
  },

  /**
   * Update a campaign
   */
  updateCampaign: async (id: string, data: Partial<Campaign>): Promise<Campaign> => {
    const response = await api.put(`/campaigns/${id}`, data);
    return response.data;
  },

  /**
   * Delete a campaign
   */
  deleteCampaign: async (id: string): Promise<void> => {
    await api.delete(`/campaigns/${id}`);
  },

  /**
   * Start a campaign
   */
  startCampaign: async (id: string): Promise<Campaign> => {
    const response = await api.post(`/campaigns/${id}/start`);
    return response.data;
  },

  /**
   * Pause a campaign
   */
  pauseCampaign: async (id: string): Promise<Campaign> => {
    const response = await api.post(`/campaigns/${id}/pause`);
    return response.data;
  },
};

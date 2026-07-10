import api from './api';

export interface BatchCallConfig {
  maxConcurrency: number;
  retryCount: number;
  delayBetweenCalls: number;
}

export interface CreateBatchCallParams {
  campaignId: string;
  leadIds: string[];
  name?: string;
  config?: Partial<BatchCallConfig>;
}

export const batchCallsApi = {
  /**
   * Create a new batch call job
   */
  createBatch: async (params: CreateBatchCallParams) => {
    const response = await api.post('/batch-calls/create', params);
    return response.data;
  },

  /**
   * List all batch call jobs
   */
  listBatches: async (limit: number = 20) => {
    const response = await api.get(`/batch-calls/list?limit=${limit}`);
    return response.data;
  },

  /**
   * Get status of a specific batch
   */
  getBatchStatus: async (id: string) => {
    const response = await api.get(`/batch-calls/${id}`);
    return response.data;
  }
};

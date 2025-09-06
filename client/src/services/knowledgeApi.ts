import api from './api';

// Define types for the API parameters and responses
export interface DocumentParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  status?: string;
  category?: string;
  searchTerm?: string;
}

export interface ChunkParams {
  documentId?: string;
  page?: number;
  limit?: number;
}

export interface SearchParams {
  query: string;
  filters?: {
    documentIds?: string[];
    categoryIds?: string[];
    tags?: string[];
    dateRange?: {
      start?: Date;
      end?: Date;
    };
  };
  limit?: number;
}

export interface AnalyticsParams {
  startDate?: string;
  endDate?: string;
  groupBy?: 'day' | 'week' | 'month';
}

export interface DocumentData {
  title?: string;
  description?: string;
  categoryId?: string;
  tags?: string[];
}

export interface CategoryData {
  name: string;
  description?: string;
  color?: string;
}

export interface TagData {
  name: string;
  description?: string;
}

export interface ChunkData {
  content: string;
  tags?: string[];
  metadata?: Record<string, any>;
}

const knowledgeApi = {
  // Documents
  getDocuments: async (params: DocumentParams = {}) => {
    return await api.get('/knowledge/documents', { params });
  },
  
  getDocumentById: async (id: string) => {
    return await api.get(`/knowledge/documents/${id}`);
  },
  
  uploadDocuments: async (formData: FormData, onUploadProgress?: (progressEvent: any) => void) => {
    return await api.post('/knowledge/documents', formData, {
      onUploadProgress,
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
  },
  
  updateDocument: async (id: string, data: DocumentData) => {
    return await api.put(`/knowledge/documents/${id}`, data);
  },
  
  deleteDocument: async (id: string) => {
    return await api.delete(`/knowledge/documents/${id}`);
  },
  
  // Categories
  getCategories: async () => {
    return await api.get('/knowledge/categories');
  },
  
  createCategory: async (data: CategoryData) => {
    return await api.post('/knowledge/categories', data);
  },
  
  updateCategory: async (id: string, data: CategoryData) => {
    return await api.put(`/knowledge/categories/${id}`, data);
  },
  
  deleteCategory: async (id: string) => {
    return await api.delete(`/knowledge/categories/${id}`);
  },
  
  // Tags
  getTags: async () => {
    return await api.get('/knowledge/tags');
  },
  
  createTag: async (data: TagData) => {
    return await api.post('/knowledge/tags', data);
  },
  
  // Chunks
  getChunks: async (params: ChunkParams = {}) => {
    return await api.get('/knowledge/chunks', { params });
  },
  
  getChunkById: async (id: string) => {
    return await api.get(`/knowledge/chunks/${id}`);
  },
  
  updateChunk: async (id: string, data: ChunkData) => {
    return await api.put(`/knowledge/chunks/${id}`, data);
  },
  
  // Search
  searchKnowledge: async (query: string, filters = {}, limit = 10) => {
    return await api.post('/knowledge/search', {
      query,
      filters,
      limit
    });
  },
  
  // Analytics
  getUsageAnalytics: async (params: AnalyticsParams = {}) => {
    return await api.get('/knowledge/analytics/usage', { params });
  },
  
  getPerformanceAnalytics: async (params: AnalyticsParams = {}) => {
    return await api.get('/knowledge/analytics/performance', { params });
  },
  
  getKnowledgeGaps: async () => {
    return await api.get('/knowledge/analytics/gaps');
  }
};

export default knowledgeApi;

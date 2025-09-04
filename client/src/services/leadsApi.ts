import api from './api';
import { throttleAPI, apiCache, requestDeduplicator } from '../utils/apiUtils';

// Types
interface LeadParams {
  page?: number;
  limit?: number;
  status?: string;
  source?: string;
  search?: string;
  language?: string;
}

interface LeadData {
  name: string;
  phoneNumber: string;
  email?: string;
  company?: string;
  title?: string;
  source?: string;
  languagePreference?: string;
  status?: string;
  notes?: string;
  tags?: string[];
}

interface ExportLeadsParams {
  format?: 'csv' | 'json' | 'xlsx';
  status?: string;
  source?: string;
  language?: string;
}

// Leads API endpoints
export const leadsApi = {
  // Get leads with optional filters
  getLeads: async (params: LeadParams = {}) => {
    const cacheKey = `leads_${JSON.stringify(params)}`;
    
    // Check cache first
    const cachedData = apiCache.get(cacheKey);
    if (cachedData) {
      console.log('Using cached leads data');
      return cachedData;
    }

    // Use request deduplication to prevent multiple simultaneous requests
    return requestDeduplicator.deduplicate(cacheKey, async () => {
      const response = await api.get('/leads', { params });
      
      // Cache the response
      apiCache.set(cacheKey, response.data);
      
      return response.data;
    });
  },

  // Get a specific lead by ID with enhanced error handling and deduplication
  getLeadById: async (id: string) => {
    if (!id) {
      throw new Error('Lead ID is required');
    }

    const cacheKey = `lead_${id}`;
    const endpoint = `/leads/${id}`;
    
    // Check cache first
    const cachedData = apiCache.get(cacheKey);
    if (cachedData) {
      console.log('Using cached lead data for ID:', id);
      return cachedData;
    }

    // Check throttling before making request
    if (!throttleAPI(endpoint)) {
      console.log('Throttling lead request for ID:', id);
      
      // If we have cached data (even if expired), return it instead of failing
      const expiredCache = apiCache.get(`${cacheKey}_expired`);
      if (expiredCache) {
        console.log('Returning expired cache data due to throttling for ID:', id);
        return expiredCache;
      }
      
      // If no cache available, wait a short time and try once more
      await new Promise(resolve => setTimeout(resolve, 500));
      if (!throttleAPI(endpoint)) {
        throw new Error('Request throttled. Please wait before trying again.');
      }
    }

    // Use request deduplication to prevent multiple simultaneous requests
    return requestDeduplicator.deduplicate(cacheKey, async () => {
      try {
        const response = await api.get(endpoint);
        
        // Cache the response
        apiCache.set(cacheKey, response.data);
        // Also cache as "expired" backup
        apiCache.set(`${cacheKey}_expired`, response.data);
        
        return response.data;
      } catch (error: any) {
        console.error('Error fetching lead:', error);
        
        // Return expired cache if available on error
        const expiredCache = apiCache.get(`${cacheKey}_expired`);
        if (expiredCache) {
          console.log('Returning expired cache data due to error for ID:', id);
          return expiredCache;
        }
        
        throw error;
      }
    });
  },

  // Create a new lead
  createLead: async (leadData: LeadData) => {
    const response = await api.post('/leads', leadData);
    
    // Invalidate cache after creating
    apiCache.invalidate('leads_');
    
    return response.data;
  },

  // Update an existing lead
  updateLead: async (id: string, leadData: Partial<LeadData>) => {
    if (!id) {
      throw new Error('Lead ID is required for update');
    }

    const response = await api.put(`/leads/${id}`, leadData);
    
    // Invalidate specific lead cache and general leads cache
    apiCache.invalidate(`lead_${id}`);
    apiCache.invalidate('leads_');
    
    return response.data;
  },

  // Delete a lead
  deleteLead: async (id: string) => {
    if (!id) {
      throw new Error('Lead ID is required for deletion');
    }

    const response = await api.delete(`/leads/${id}`);
    
    // Invalidate specific lead cache and general leads cache
    apiCache.invalidate(`lead_${id}`);
    apiCache.invalidate('leads_');
    
    return response.data;
  },

  // Bulk upload leads
  bulkUploadLeads: async (leads: LeadData[]) => {
    const response = await api.post('/leads', { leads });
    
    // Invalidate cache after bulk upload
    apiCache.invalidate('leads_');
    
    return response.data;
  },

  // Import leads from CSV
  importLeadsFromCSV: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    
    const response = await api.post('/leads/import/csv', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    });
    
    // Invalidate cache after import
    apiCache.invalidate('leads_');
    
    return response.data;
  },

  // Export leads data
  exportLeads: async (params: ExportLeadsParams = {}) => {
    const response = await api.get('/leads/export', { 
      params,
      responseType: 'blob'
    });
    return response.data;
  }
};

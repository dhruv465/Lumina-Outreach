import api from './api';
import { throttleAPI, apiCache } from '../utils/apiUtils';

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
    const response = await api.get('/leads', { params });
    return response.data;
  },

  // Get a specific lead by ID
  getLeadById: async (id: string) => {
    // Create a cache key
    const cacheKey = `lead_${id}`;
    
    // Check if we have a cached response
    const cachedData = apiCache.get(cacheKey);
    if (cachedData) {
      console.log('Using cached lead data for ID:', id);
      return cachedData;
    }
    
    // Check if we should throttle this request
    if (!throttleAPI(`/leads/${id}`)) {
      console.log('Throttling lead request for ID:', id);
      // If we need to throttle but have no cached data, we'll still make the request
      // but log a warning - in a real app you might want to handle this differently
      console.warn('Rapid request detected for lead:', id);
    }
    
    // Make the API request
    const response = await api.get(`/leads/${id}`);
    
    // Cache the response
    apiCache.set(cacheKey, response.data);
    
    return response.data;
  },

  // Create a new lead
  createLead: async (leadData: LeadData) => {
    const response = await api.post('/leads', leadData);
    return response.data;
  },

  // Update an existing lead
  updateLead: async (id: string, leadData: Partial<LeadData>) => {
    const response = await api.put(`/leads/${id}`, leadData);
    
    // Invalidate the cache
    apiCache.set(`lead_${id}`, null);
    
    return response.data;
  },

  // Delete a lead
  deleteLead: async (id: string) => {
    const response = await api.delete(`/leads/${id}`);
    
    // Invalidate the cache
    apiCache.set(`lead_${id}`, null);
    
    return response.data;
  },

  // Bulk upload leads
  bulkUploadLeads: async (leads: LeadData[]) => {
    const response = await api.post('/leads', { leads });
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

import { FastifyInstance } from 'fastify';
import { 
  uploadLeads, 
  getLeads, 
  getLeadById, 
  updateLead, 
  deleteLead, 
  importLeadsFromCSV,
  getLeadAnalytics,
  exportLeads
} from '../controllers/leadController';

const leadRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  // Lead management routes
  fastify.post('/', uploadLeads);
  fastify.get('/', getLeads);
  fastify.get('/analytics', getLeadAnalytics);
  fastify.get('/export', exportLeads);
  fastify.get('/:id', getLeadById);
  fastify.put('/:id', updateLead);
  fastify.delete('/:id', deleteLead);

  // CSV import route
  fastify.post('/import/csv', importLeadsFromCSV);
};

export default leadRoutes;
import { FastifyInstance } from 'fastify';
import {
  createCampaign,
  getCampaigns,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  testScript,
  getCampaignAnalytics,
  createScriptTemplate,
  getScriptTemplates,
  createABTest,
  getCampaignABTests,
  getABTestResults,
  updateABTestMetrics,
  validateScriptCompliance
} from '../controllers/campaignController';

const campaignRoutes = async (fastify, opts: Record<string, any>) => {
  fastify.addHook('onRequest', fastify.authenticate);

  // Campaign management routes
  fastify.post('/', createCampaign);
  fastify.get('/', getCampaigns);
  fastify.get('/analytics', getCampaignAnalytics);
  fastify.get('/:id', getCampaignById);
  fastify.put('/:id', updateCampaign);
  fastify.delete('/:id', deleteCampaign);

  // Script generation and testing
  fastify.post('/:id/test-script', testScript);

  // Script templates
  fastify.post('/templates', createScriptTemplate);
  fastify.get('/templates', getScriptTemplates);

  // A/B Testing
  fastify.post('/:id/ab-test', createABTest);
  fastify.get('/:id/ab-tests', getCampaignABTests);
  fastify.get('/ab-test/:testId/results', getABTestResults);
  fastify.put('/ab-test/:testId/metrics', updateABTestMetrics);

  // Compliance
  fastify.post('/validate-compliance', validateScriptCompliance);
};

export default campaignRoutes;

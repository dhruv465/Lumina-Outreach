import express from 'express';
import { authenticate } from '../middleware/auth';
import {
  createCampaign,
  getCampaigns,
  getCampaignById,
  updateCampaign,
  deleteCampaign,
  generateScript,
  testScript,
  getCampaignAnalytics,
  generateAdvancedScript,
  createScriptTemplate,
  getScriptTemplates,
  createABTest,
  getCampaignABTests,
  getABTestResults,
  updateABTestMetrics,
  validateScriptCompliance
} from '../controllers/campaignController';

const router = express.Router();

// All routes are protected
router.use(authenticate);

// Campaign management routes
router.post('/', createCampaign);
router.get('/', getCampaigns);
router.get('/analytics', getCampaignAnalytics);
router.get('/:id', getCampaignById);
router.put('/:id', updateCampaign);
router.delete('/:id', deleteCampaign);

// Script generation and testing
router.post('/:id/generate-script', generateScript);
router.post('/:id/generate-advanced-script', generateAdvancedScript);
router.post('/:id/test-script', testScript);

// Script templates
router.post('/templates', createScriptTemplate);
router.get('/templates', getScriptTemplates);

// A/B Testing
router.post('/:id/ab-test', createABTest);
router.get('/:id/ab-tests', getCampaignABTests);
router.get('/ab-test/:testId/results', getABTestResults);
router.put('/ab-test/:testId/metrics', updateABTestMetrics);

// Compliance
router.post('/validate-compliance', validateScriptCompliance);

export default router;

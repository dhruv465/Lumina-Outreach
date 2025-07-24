import express from 'express';
import { authenticate } from '../middleware/auth';
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
import { upload } from '../middleware/fileUpload';

const router = express.Router();

// All routes are protected
router.use(authenticate);

// Lead management routes
router.post('/', uploadLeads);
router.get('/', getLeads);
router.get('/analytics', getLeadAnalytics);
router.get('/export', exportLeads);
router.get('/:id', getLeadById);
router.put('/:id', updateLead);
router.delete('/:id', deleteLead);

// CSV import route
router.post('/import/csv', upload.single('file'), importLeadsFromCSV);

export default router;

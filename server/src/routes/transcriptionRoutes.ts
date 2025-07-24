import express from 'express';
import { authenticate } from '../middleware/auth';
import multer from 'multer';
import {
  startTranscription,
  stopTranscription,
  processAudio,
  transcribeAudioFile,
  getCircuitStatus,
  resetCircuit
} from '../controllers/deepgramController';

const router = express.Router();

// Memory storage for multer
const storage = multer.memoryStorage();
const upload = multer({ storage });

// All routes are protected with authentication
router.use(authenticate);

// Circuit breaker controls for operational staff
router.get('/circuit-status', getCircuitStatus);
router.post('/reset-circuit', resetCircuit);

// Transcription stream management
router.post('/transcription/:callId/start', startTranscription);
router.post('/transcription/:callId/stop', stopTranscription);

// Real-time audio processing
router.post('/audio/:connectionId', processAudio);

// File-based transcription
router.post('/transcribe-file', upload.single('audio'), transcribeAudioFile);

export default router;

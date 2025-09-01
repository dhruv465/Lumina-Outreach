/**
 * STT Routes
 * Speech-to-Text testing routes with file upload support
 */
import express from 'express';
import multer from 'multer';
import { testSTT, transcribeStreamChunk } from '../controllers/sttTestController';
import logger from '../utils/logger';

const router = express.Router();

// Configure multer for memory storage (no disk writes)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
    files: 1 // Only allow 1 file at a time
  },
  fileFilter: (req, file, cb) => {
    // Accept common audio formats
    const allowedMimeTypes = [
      'audio/wav',
      'audio/wave',
      'audio/x-wav',
      'audio/mpeg',
      'audio/mp3',
      'audio/mp4',
      'audio/m4a',
      'audio/aac',
      'audio/ogg',
      'audio/oga',
      'audio/webm',
      'audio/flac',
      'application/octet-stream' // For some browsers that don't set proper MIME type
    ];

    if (allowedMimeTypes.includes(file.mimetype) || 
        file.originalname?.match(/\.(wav|mp3|m4a|aac|ogg|webm|flac)$/i)) {
      cb(null, true);
    } else {
      logger.warn('Rejected file upload due to unsupported format', {
        mimetype: file.mimetype,
        filename: file.originalname
      });
      cb(new Error('Unsupported audio format. Please use WAV, MP3, M4A, AAC, OGG, WebM, or FLAC.'));
    }
  }
});

// Log middleware for STT routes
router.use((req, res, next) => {
  logger.info(`STT route: ${req.method} ${req.originalUrl}`);
  next();
});

/**
 * POST /api/stt/test
 * Single-shot STT test endpoint
 * Accepts either multipart/form-data with field "audio" or JSON with { audioBase64, language?, model? }
 */
router.post('/test', upload.single('audio'), testSTT);

/**
 * POST /api/stt/stream-chunk
 * Chunked near real-time STT endpoint
 * Accepts multipart/form-data with field "audio" (short chunks from MediaRecorder)
 */
router.post('/stream-chunk', upload.single('audio'), transcribeStreamChunk);



export default router;
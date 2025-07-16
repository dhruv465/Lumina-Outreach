/**
 * AI Orchestration API Controller
 * 
 * This controller exposes API endpoints for interacting with the
 * AI Orchestration Service, providing access to LLM, Voice, and other AI capabilities.
 */

import { Request, Response } from 'express';
import { getAIOrchestrationService } from '../services/aiOrchestrationService';
import { getRAGService } from '../services/ragService';

// Extend the Express Request interface to include fileValidationError
declare global {
  namespace Express {
    interface Request {
      fileValidationError?: string;
    }
  }
}
import { logger, getErrorMessage } from '../index';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import multer from 'multer';

// Promisify fs methods
const readFile = promisify(fs.readFile);

// Get services
const aiService = getAIOrchestrationService();
const ragService = getRAGService(aiService.getLLMService());

// File upload configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, path.join(__dirname, '../../uploads/audio'));
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const audioFileFilter = (req: any, file: Express.Multer.File, cb: any) => {
  if (
    file.mimetype === 'audio/mpeg' ||
    file.mimetype === 'audio/mp3' ||
    file.mimetype === 'audio/wav' ||
    file.mimetype === 'audio/webm'
  ) {
    cb(null, true);
  } else {
    cb(null, false);
    req.fileValidationError = 'Unsupported file type. Only audio files are allowed.';
  }
};

export const upload = multer({ 
  storage,
  fileFilter: audioFileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  }
});

/**
 * Process an LLM request
 */
export const processLLM = async (req: Request, res: Response) => {
  try {
    const {
      messages,
      model,
      provider,
      temperature,
      maxTokens,
      bypassCache,
      cacheKey
    } = req.body;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Messages array is required'
      });
    }
    
    const response = await aiService.processLLMRequest({
      messages,
      model,
      provider,
      options: {
        temperature: temperature || 0.7,
        maxTokens: maxTokens
      },
      bypassCache,
      cacheKey
    });
    
    return res.json(response);
  } catch (error) {
    logger.error(`Error processing LLM request: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Process a RAG query request
 */
export const processRAG = async (req: Request, res: Response) => {
  try {
    const {
      query,
      sources,
      maxResults,
      minRelevanceScore,
      provider,
      model,
      temperature,
      systemPrompt,
      bypassCache,
      cacheKey
    } = req.body;
    
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }
    
    const response = await ragService.generateResponse(
      query,
      {
        sources,
        maxResults,
        minRelevanceScore,
        provider,
        model,
        temperature,
        systemPrompt,
        bypassCache,
        cacheKey
      }
    );
    
    return res.json({
      success: true,
      data: response
    });
  } catch (error) {
    logger.error(`Error processing RAG request: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Process a voice synthesis request
 */
export const processVoice = async (req: Request, res: Response) => {
  try {
    const {
      text,
      personalityId,
      language
    } = req.body;
    
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }
    
    const response = await aiService.processVoiceRequest({
      text,
      personalityId,
      language
    });
    
    return res.json(response);
  } catch (error) {
    logger.error(`Error processing voice request: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Process a speech analysis request
 */
export const processSpeech = async (req: Request, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Audio file is required'
      });
    }
    
    // Read file
    const audioBuffer = await readFile(req.file.path);
    const fileType = req.file.mimetype;
    
    const response = await aiService.processSpeechAnalysisRequest({
      audioBuffer,
      fileType
    });
    
    // Delete file after processing
    fs.unlink(req.file.path, (err) => {
      if (err) logger.warn(`Failed to delete temp file: ${req.file?.path}`);
    });
    
    return res.json(response);
  } catch (error) {
    logger.error(`Error processing speech request: ${getErrorMessage(error)}`);
    
    // Delete file if there was an error
    if (req.file) {
      fs.unlink(req.file.path, (err) => {
        if (err) logger.warn(`Failed to delete temp file: ${req.file?.path}`);
      });
    }
    
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Process an emotion detection request
 */
export const detectEmotion = async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }
    
    const response = await aiService.detectEmotion(text);
    
    return res.json(response);
  } catch (error) {
    logger.error(`Error processing emotion detection request: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Process an intent detection request
 */
export const detectIntent = async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }
    
    const response = await aiService.processIntentDetectionRequest({ text });
    
    return res.json(response);
  } catch (error) {
    logger.error(`Error processing intent detection request: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Process an objection detection request
 */
export const detectObjection = async (req: Request, res: Response) => {
  try {
    const { text } = req.body;
    
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Text is required'
      });
    }
    
    const response = await aiService.processObjectionDetectionRequest({ text });
    
    return res.json(response);
  } catch (error) {
    logger.error(`Error processing objection detection request: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Process a conversation quality scoring request
 */
export const scoreConversation = async (req: Request, res: Response) => {
  try {
    const { conversationId, callId } = req.body;
    
    if (!conversationId) {
      return res.status(400).json({
        success: false,
        error: 'Conversation ID is required'
      });
    }
    
    if (!callId) {
      return res.status(400).json({
        success: false,
        error: 'Call ID is required'
      });
    }
    
    const response = await aiService.processQualityAnalysisRequest({
      conversationId,
      callId
    });
    
    return res.json(response);
  } catch (error) {
    logger.error(`Error processing conversation quality request: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Get AI service metrics
 */
export const getMetrics = async (req: Request, res: Response) => {
  try {
    const metrics = aiService.getMetrics();
    
    return res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error(`Error getting metrics: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Clear AI service cache
 */
export const clearCache = async (req: Request, res: Response) => {
  try {
    aiService.clearCache();
    ragService.clearCache();
    
    return res.json({
      success: true,
      message: 'Cache cleared successfully'
    });
  } catch (error) {
    logger.error(`Error clearing cache: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Update AI configuration
 */
export const updateConfig = async (req: Request, res: Response) => {
  try {
    await aiService.updateConfiguration();
    await ragService.updateConfiguration();
    
    return res.json({
      success: true,
      message: 'Configuration updated successfully'
    });
  } catch (error) {
    logger.error(`Error updating configuration: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

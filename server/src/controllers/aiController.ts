/**
 * AI Orchestration API Controller
 * 
 * This controller exposes API endpoints for interacting with the
 * AI Orchestration Service, providing access to LLM, Voice, and other AI capabilities.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { getAIOrchestrationService } from '../services/aiOrchestrationService';
import { getRAGSystem } from '../services/rag/ragSystem';
import { logger, getErrorMessage } from '../index';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

// Promisify fs methods
const readFile = promisify(fs.readFile);

// Get services
const aiService = getAIOrchestrationService();
const ragService = getRAGSystem();

/**
 * Process an LLM request
 */
export const processLLM = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const {
      messages,
      model,
      provider,
      temperature,
      maxTokens,
      bypassCache,
      cacheKey
    } = req.body as any;
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).send({
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
    
    return res.send(response);
  } catch (error) {
    logger.error(`Error processing LLM request: ${getErrorMessage(error)}`);
    return res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Process a RAG query request
 */
export const processRAG = async (req: FastifyRequest, res: FastifyReply) => {
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
    } = req.body as any;
    
    if (!query || typeof query !== 'string' || query.trim() === '') {
      return res.status(400).send({
        success: false,
        error: 'Query is required'
      });
    }
    
    const response = await ragService.generateEnhancedPrompt(query, [], {
      documentTypes: sources,
      maxDocuments: maxResults,
      filterMetadata: {
        provider,
        model,
        temperature,
        systemPrompt,
        bypassCache,
        cacheKey
      }
    });
    
    return res.send({
      success: true,
      data: response
    });
  } catch (error) {
    logger.error(`Error processing RAG request: ${getErrorMessage(error)}`);
    return res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Process a voice synthesis request
 */
export const processVoice = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const {
      text,
      personalityId,
      language
    } = req.body as any;
    
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).send({
        success: false,
        error: 'Text is required'
      });
    }
    
    const response = await aiService.processVoiceRequest({
      text,
      personalityId,
      language
    });
    
    return res.send(response);
  } catch (error) {
    logger.error(`Error processing voice request: ${getErrorMessage(error)}`);
    return res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Process a speech analysis request
 */
export const processSpeech = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const data = await (req as any).file();
    const audioBuffer = await data.toBuffer();
    const fileType = data.mimetype;

    const response = await aiService.processSpeechAnalysisRequest({
      audioBuffer,
      fileType
    });
    
    return res.send(response);
  } catch (error) {
    logger.error(`Error processing speech request: ${getErrorMessage(error)}`);
    return res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Process an emotion detection request
 */
export const detectEmotion = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { text } = req.body as any;
    
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).send({
        success: false,
        error: 'Text is required'
      });
    }
    
    const response = await aiService.detectEmotion(text);
    
    return res.send(response);
  } catch (error) {
    logger.error(`Error processing emotion detection request: ${getErrorMessage(error)}`);
    return res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Process an intent detection request
 */
export const detectIntent = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { text } = req.body as any;
    
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).send({
        success: false,
        error: 'Text is required'
      });
    }
    
    const response = await aiService.processIntentDetectionRequest({ text });
    
    return res.send(response);
  } catch (error) {
    logger.error(`Error processing intent detection request: ${getErrorMessage(error)}`);
    return res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Process an objection detection request
 */
export const detectObjection = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { text } = req.body as any;
    
    if (!text || typeof text !== 'string' || text.trim() === '') {
      return res.status(400).send({
        success: false,
        error: 'Text is required'
      });
    }
    
    const response = await aiService.processObjectionDetectionRequest({ text });
    
    return res.send(response);
  } catch (error) {
    logger.error(`Error processing objection detection request: ${getErrorMessage(error)}`);
    return res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Process a conversation quality scoring request
 */
export const scoreConversation = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { conversationId, callId } = req.body as any;
    
    if (!conversationId) {
      return res.status(400).send({
        success: false,
        error: 'Conversation ID is required'
      });
    }
    
    if (!callId) {
      return res.status(400).send({
        success: false,
        error: 'Call ID is required'
      });
    }
    
    const response = await aiService.processQualityAnalysisRequest({
      conversationId,
      callId
    });
    
    return res.send(response);
  } catch (error) {
    logger.error(`Error processing conversation quality request: ${getErrorMessage(error)}`);
    return res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Get AI service metrics
 */
export const getMetrics = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const metrics = aiService.getMetrics();
    
    return res.send({
      success: true,
      data: metrics
    });
  } catch (error) {
    logger.error(`Error getting metrics: ${getErrorMessage(error)}`);
    return res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Clear AI service cache
 */
export const clearCache = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    aiService.clearCache();
    
    
    return res.send({
      success: true,
      message: 'Cache cleared successfully'
    });
  } catch (error) {
    logger.error(`Error clearing cache: ${getErrorMessage(error)}`);
    return res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
};

/**
 * Update AI configuration
 */
export const updateConfig = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    await aiService.updateConfiguration();
    
    return res.send({
      success: true,
      message: 'Configuration updated successfully'
    });
  } catch (error) {
    logger.error(`Error updating configuration: ${getErrorMessage(error)}`);
    return res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
};
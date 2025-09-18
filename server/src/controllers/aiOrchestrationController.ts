/**
 * AI Orchestration Controller
 * 
 * Handles all API endpoints related to AI orchestration, including LLM interactions,
 * voice synthesis, and RAG operations.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { getAIOrchestrationService } from '../services/aiOrchestrationAdapter';
import { getRAGSystem } from '../services/rag/ragSystem';
import { getLLMService } from '../services';
import { logger } from '../index';

// @desc    Get AI service status
// @route   GET /api/ai-orchestration/status
// @access  Private
export const getServiceStatus = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const orchestrationService = getAIOrchestrationService();
    const metrics = orchestrationService.getMetrics();
    
    reply.send({
      status: 'operational',
      providers: orchestrationService.getActiveProviders(),
      metrics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error(`Error getting AI service status: ${error instanceof Error ? error.message : String(error)}`);
    
    reply.code(500).send({
      success: false,
      message: 'Failed to get AI service status',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// @desc    Generate chat response
// @route   POST /api/ai-orchestration/chat
// @access  Private
export const generateChatResponse = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { messages, options } = req.body as { messages: any[], options: any };
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({
        success: false,
        message: 'Messages array is required and must not be empty'
      });
    }
    
    const orchestrationService = getAIOrchestrationService();
    const response = await orchestrationService.processLLM(messages, options);
    
    reply.send({
      success: true,
      response
    });
  } catch (error) {
    logger.error(`Error generating chat response: ${error instanceof Error ? error.message : String(error)}`);
    
    reply.code(500).send({
      success: false,
      message: 'Failed to generate chat response',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// @desc    Stream chat response
// @route   POST /api/ai-orchestration/stream-chat
// @access  Private
export const streamChatResponse = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { messages, options } = req.body as { messages: any[], options: any };
    
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return reply.code(400).send({
        success: false,
        message: 'Messages array is required and must not be empty'
      });
    }
    
    const orchestrationService = getAIOrchestrationService();
    
    // Set up SSE
    reply.raw.setHeader('Content-Type', 'text/event-stream');
    reply.raw.setHeader('Cache-Control', 'no-cache');
    reply.raw.setHeader('Connection', 'keep-alive');
    
    // Stream response
    const streamOptions = {
      ...options,
      onChunk: (chunk: string) => {
        reply.raw.write(`data: ${JSON.stringify({ chunk })}\n\n`);
      },
      onComplete: (fullResponse: string) => {
        reply.raw.write(`data: ${JSON.stringify({ done: true, fullResponse })}\n\n`);
        reply.raw.end();
      },
      onError: (error: Error) => {
        reply.raw.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
        reply.raw.end();
      }
    };
    
    orchestrationService.streamLLM(messages, streamOptions);
  } catch (error) {
    logger.error(`Error streaming chat response: ${error instanceof Error ? error.message : String(error)}`);
    
    reply.raw.write(`data: ${JSON.stringify({
      error: error instanceof Error ? error.message : 'Unknown error',
      done: true
    })}\n\n`);
    
    reply.raw.end();
  }
};

// @desc    Synthesize voice
// @route   POST /api/ai-orchestration/voice
// @access  Private
export const synthesizeVoice = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { text, voiceId, options } = req.body as { text: string, voiceId: string, options: any };
    
    if (!text || typeof text !== 'string') {
      return reply.code(400).send({
        success: false,
        message: 'Text is required and must be a string'
      });
    }
    
    const orchestrationService = getAIOrchestrationService();
    const audioResult = await orchestrationService.processVoice(text, voiceId, options);
    
    // Check if the result is a Buffer
    if (Buffer.isBuffer(audioResult)) {
      reply.header('Content-Type', 'audio/mpeg');
      reply.header('Content-Disposition', 'attachment; filename="voice.mp3"');
      reply.send(audioResult);
    } else {
      // Handle case where result is a URL or path
      reply.send({
        success: true,
        audioUrl: audioResult
      });
    }
  } catch (error) {
    logger.error(`Error synthesizing voice: ${error instanceof Error ? error.message : String(error)}`);
    
    reply.code(500).send({
      success: false,
      message: 'Failed to synthesize voice',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// @desc    Retrieve context
// @route   POST /api/ai-orchestration/context
// @access  Private
export const retrieveContext = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { query, options } = req.body as { query: string, options: any };
    
    if (!query || typeof query !== 'string') {
      return reply.code(400).send({
        success: false,
        message: 'Query is required and must be a string'
      });
    }
    
    const llmService = getLLMService();
    const ragService = getRAGSystem();
    const result = await ragService.generateEnhancedPrompt(query, [], options);
    
    reply.send({
      success: true,
      results: result.retrievalResults.documents,
      augmentedPrompt: result.augmentedPrompt
    });
  } catch (error) {
    logger.error(`Error retrieving context: ${error instanceof Error ? error.message : String(error)}`);
    
    reply.code(500).send({
      success: false,
      message: 'Failed to retrieve context',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// @desc    Update AI orchestration configuration
// @route   PUT /api/ai-orchestration/config
// @access  Private/Admin
export const updateConfiguration = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { config } = req.body as { config: any };
    
    if (!config || typeof config !== 'object') {
      return reply.code(400).send({
        success: false,
        message: 'Configuration object is required'
      });
    }
    
    const orchestrationService = getAIOrchestrationService();
    const success = orchestrationService.updateConfig(config);
    
    if (success) {
      reply.send({
        success: true,
        message: 'Configuration updated successfully'
      });
    } else {
      reply.code(400).send({
        success: false,
        message: 'Failed to update configuration'
      });
    }
  } catch (error) {
    logger.error(`Error updating configuration: ${error instanceof Error ? error.message : String(error)}`);
    
    reply.code(500).send({
      success: false,
      message: 'Failed to update configuration',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

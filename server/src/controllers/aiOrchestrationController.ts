/**
 * AI Orchestration Controller
 * 
 * Handles all API endpoints related to AI orchestration, including LLM interactions,
 * voice synthesis, and RAG operations.
 */

import { FastifyRequest, FastifyReply } from 'fastify';
import { aiService } from '../services/aiService';

// @desc    Get AI service status
// @route   GET /api/ai-orchestration/status
// @access  Private
export const getServiceStatus = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const metrics = aiService.getMetrics();
    
    reply.send({
      status: 'operational',
      metrics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
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
    const response = await aiService.processLLM(messages, options);
    reply.send({ success: true, response });
  } catch (error) {
    reply.code(500).send({
      success: false,
      message: 'Failed to generate chat response',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// @desc    Synthesize voice
// @route   POST /api/ai-orchestration/voice
// @access  Private
export const synthesizeVoice = async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const { text, voiceId, options } = req.body as { text: string, voiceId: string, options: any };
    const audioResult = await aiService.processVoice(text, voiceId, options);
    
    if (Buffer.isBuffer(audioResult)) {
      reply.header('Content-Type', 'audio/mpeg');
      reply.header('Content-Disposition', 'attachment; filename="voice.mp3"');
      reply.send(audioResult);
    } else {
      reply.send({ success: true, audioUrl: audioResult });
    }
  } catch (error) {
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
    const result = await aiService.processRAG(query, options);
    reply.send({ success: true, results: result });
  } catch (error) {
    reply.code(500).send({
      success: false,
      message: 'Failed to retrieve context',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// @desc    Process speech analysis request
// @route   POST /api/ai-orchestration/speech
// @access  Private
export const processSpeech = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const data = await (req as any).file();
    const audioBuffer = await data.toBuffer();
    const fileType = data.mimetype;
    const response = await aiService.processSpeechAnalysis(audioBuffer, fileType);
    return res.send(response);
  } catch (error) {
    return res.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// @desc    Process an emotion detection request
// @route   POST /api/ai-orchestration/emotion
// @access  Private
export const detectEmotion = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { text } = req.body as any;
    const response = await aiService.detectEmotion(text);
    return res.send(response);
  } catch (error) {
    return res.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// @desc    Process an intent detection request
// @route   POST /api/ai-orchestration/intent
// @access  Private
export const detectIntent = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { text } = req.body as any;
    const response = await aiService.detectIntent(text);
    return res.send(response);
  } catch (error) {
    return res.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// @desc    Process an objection detection request
// @route   POST /api/ai-orchestration/objection
// @access  Private
export const detectObjection = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { text } = req.body as any;
    const response = await aiService.detectObjection(text);
    return res.send(response);
  } catch (error) {
    return res.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// @desc    Process a conversation quality scoring request
// @route   POST /api/ai-orchestration/quality
// @access  Private
export const scoreConversation = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { conversationId, callId } = req.body as any;
    const response = await aiService.scoreConversation(conversationId, callId);
    return res.send(response);
  } catch (error) {
    return res.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// @desc    Get AI service metrics
// @route   GET /api/ai-orchestration/metrics
// @access  Private
export const getMetrics = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const metrics = aiService.getMetrics();
    return res.send({ success: true, data: metrics });
  } catch (error) {
    return res.status(500).send({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// @desc    Clear AI service cache
// @route   POST /api/ai-orchestration/cache/clear
// @access  Private
export const clearCache = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    aiService.clearCache();
    return res.send({ success: true, message: 'Cache cleared successfully' });
  } catch (error) {
    return res.status(500).send({
      success: false,
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
    const success = aiService.updateConfig(config);
    
    if (success) {
      reply.send({ success: true, message: 'Configuration updated successfully' });
    } else {
      reply.code(400).send({ success: false, message: 'Failed to update configuration' });
    }
  } catch (error) {
    reply.code(500).send({
      success: false,
      message: 'Failed to update configuration',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
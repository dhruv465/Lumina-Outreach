import express from 'express';
import * as deepgramHelper from '../services/deepgramTranscriptionHelper';
import { CampaignService } from '../services/campaignService';
import { AgentService } from '../services/agentService';
import { LLMService } from '../services/llmService';
import { TextToSpeechService } from '../services/textToSpeechService';
import logger from '../utils/logger';
import path from 'path';
import fs from 'fs';

const router = express.Router();
const campaignService = new CampaignService();
const agentService = new AgentService();
const llmService = new LLMService(process.env.OPENAI_API_KEY || '', process.env.ANTHROPIC_API_KEY);
const ttsService = new TextToSpeechService();

// Helper function to save audio files
const saveAudioFile = async (audioBuffer: Buffer, filename: string): Promise<string> => {
  // Create audio directory if it doesn't exist
  const audioDir = path.join(__dirname, '../../uploads/audio');
  fs.mkdirSync(audioDir, { recursive: true });
  
  // Save the file
  const filePath = path.join(audioDir, filename);
  await fs.promises.writeFile(filePath, audioBuffer);
  
  // Return the URL that can be used to access the file
  return `/uploads/audio/${filename}`;
};

/**
 * HTTP Fallback route for starting a call when WebSocket isn't working
 * This provides an alternative entry point for the call simulation
 */
router.post('/start', async (req, res) => {
  try {
    const { campaignId, agentId, language = 'en', model = 'nova-3', systemPrompt } = req.body;

    logger.info('Starting call simulation via HTTP fallback', {
      campaignId,
      agentId,
      language,
      model
    });

    // Get campaign data if a campaign ID was provided
    let campaignData = null;
    let agentData = null;
    let prompt = systemPrompt || '';

    if (campaignId) {
      try {
        campaignData = await campaignService.getCampaign(campaignId);
        logger.info('Campaign data loaded for HTTP fallback call', { campaignId });
        
        // Extract system prompt from campaign data
        if (campaignData) {
          prompt = campaignData.systemPrompt || campaignData.script?.systemPrompt || prompt;
        }
      } catch (err) {
        logger.error('Error fetching campaign data for HTTP fallback call', { campaignId, error: err });
      }
    }

    // Get agent data if an agent ID was provided
    if (agentId) {
      try {
        agentData = await agentService.getAgent(agentId);
        logger.info('Agent data loaded for HTTP fallback call', { agentId });
      } catch (err) {
        logger.error('Error fetching agent data for HTTP fallback call', { agentId, error: err });
      }
    }

    // Generate a greeting using the LLM
    const greetingPrompt = [
      {
        role: 'system',
        content: prompt || 'You are an AI assistant making a phone call. Start with a brief, friendly greeting.'
      },
      {
        role: 'user',
        content: 'Start the conversation with a brief greeting.'
      }
    ];

    // Get the greeting from the LLM
    const greetingResponse = await llmService.generateResponse(greetingPrompt, {
      model: model || 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 100
    });
    
    const greeting = greetingResponse || "Hello, this is an AI assistant. How can I help you today?";

    logger.info('Generated greeting for HTTP fallback call', { greeting });

    // Generate audio for the greeting if text-to-speech is available
    let audioUrl = null;
    try {
      const ttsOptions = {
        text: greeting,
        voice: language === 'en' ? 'en-US-Neural2-F' : 'en-US-Neural2-F',
        speed: 1.0
      };
      
      const audioBuffer = await ttsService.generateSpeech(ttsOptions);
      
      // Create a unique filename for the audio
      const timestamp = Date.now();
      const filename = `greeting_${timestamp}.mp3`;
      
      // Save the audio file and get its URL
      audioUrl = await saveAudioFile(audioBuffer, filename);
      
      logger.info('Generated audio for HTTP fallback greeting', { audioUrl });
    } catch (err) {
      logger.error('Failed to generate audio for HTTP fallback greeting', { error: err });
    }

    // Return success response with greeting and audio URL
    res.json({
      success: true,
      greeting,
      audioUrl,
      campaignId,
      agentId
    });
  } catch (err) {
    logger.error('Error in HTTP fallback call start endpoint', { error: err });
    
    res.status(500).json({
      success: false,
      error: err.message || 'An error occurred while starting the call'
    });
  }
});

/**
 * HTTP Fallback route for handling user messages when WebSocket isn't working
 */
router.post('/message', async (req, res) => {
  try {
    const { message, campaignId, agentId, language = 'en', model = 'nova-3' } = req.body;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'No message provided'
      });
    }

    logger.info('Processing user message via HTTP fallback', {
      messageLength: message.length,
      campaignId,
      agentId
    });

    // Get campaign data if a campaign ID was provided
    let campaignData = null;
    let agentData = null;
    let systemPrompt = '';

    if (campaignId) {
      try {
        campaignData = await campaignService.getCampaign(campaignId);
        logger.info('Campaign data loaded for HTTP fallback message', { campaignId });
        
        // Extract system prompt from campaign data
        if (campaignData) {
          systemPrompt = campaignData.systemPrompt || campaignData.script?.systemPrompt || '';
        }
      } catch (err) {
        logger.error('Error fetching campaign data for HTTP fallback message', { campaignId, error: err });
      }
    }

    // Get agent data if an agent ID was provided
    if (agentId) {
      try {
        agentData = await agentService.getAgent(agentId);
        logger.info('Agent data loaded for HTTP fallback message', { agentId });
      } catch (err) {
        logger.error('Error fetching agent data for HTTP fallback message', { agentId, error: err });
      }
    }

    // Generate a response using the LLM
    const conversationPrompt = [
      {
        role: 'system',
        content: systemPrompt || 'You are an AI assistant on a phone call. Be concise, helpful and conversational.'
      },
      {
        role: 'user',
        content: message
      }
    ];

    // Get the response from the LLM
    const llmResponse = await llmService.generateResponse(conversationPrompt, {
      model: model || 'gpt-3.5-turbo',
      temperature: 0.7,
      maxTokens: 150
    });
    
    const response = llmResponse || "I'm sorry, I didn't catch that. Could you please repeat?";

    logger.info('Generated response for HTTP fallback message', { 
      userMessage: message,
      responseLength: response.length 
    });

    // Generate audio for the response if text-to-speech is available
    let audioUrl = null;
    try {
      const ttsOptions = {
        text: response,
        voice: language === 'en' ? 'en-US-Neural2-F' : 'en-US-Neural2-F',
        speed: 1.0
      };
      
      const audioBuffer = await ttsService.generateSpeech(ttsOptions);
      
      // Create a unique filename for the audio
      const timestamp = Date.now();
      const filename = `response_${timestamp}.mp3`;
      
      // Save the audio file and get its URL
      audioUrl = await saveAudioFile(audioBuffer, filename);
      
      logger.info('Generated audio for HTTP fallback response', { audioUrl });
    } catch (err) {
      logger.error('Failed to generate audio for HTTP fallback response', { error: err });
    }

    // Return success response with agent response and audio URL
    res.json({
      success: true,
      response,
      audioUrl,
      campaignId,
      agentId
    });
  } catch (err) {
    logger.error('Error in HTTP fallback message endpoint', { error: err });
    
    res.status(500).json({
      success: false,
      error: err.message || 'An error occurred while processing your message'
    });
  }
});

export default router;

export default router;

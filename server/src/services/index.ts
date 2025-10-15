// Export all services from a central file for easier imports
import { logger } from '../index';
import { AdvancedCampaignService, advancedCampaignService } from './advancedCampaignService';
import { AdvancedConversationEngine } from './advancedConversationEngine';
import ConversationEngineService from './conversationEngineService';
import { conversationStateMachine } from './conversationStateMachine';
import { EnhancedVoiceAIService } from './enhancedVoiceAIService';
import { LLMService } from './llm/service';
import SpeechAnalysisService from './speechAnalysisService';

// Import webhook handlers individually for proper re-export
import {
  handleTwilioGatherWebhook,
  handleTwilioStatusWebhook,
  handleTwilioStreamWebhook,
  handleTwilioVoiceWebhook,
  updateCallWithOutcome
} from './webhookHandlers';

import Configuration from '../models/Configuration';

// Create instances for services that need to be shared
// These services will load configuration from database on initialization
let elevenLabsApiKey = '';
let openAIApiKey = '';
let anthropicApiKey = '';
let googleSpeechKey = '';
let deepgramApiKey = '';

// Initialize API keys from database configuration
const initializeFromDatabase = async () => {
  try {
    // Check if mongoose is connected
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) {
      console.warn('MongoDB not connected yet. Skipping API key initialization.');
      return;
    }

    console.log('Loading API configuration from database...');
    const config = await Configuration.findOne();
    if (config) {
      elevenLabsApiKey = config.elevenLabsConfig?.apiKey || '';

      const openAIProvider = config.llmConfig?.providers?.find((p: any) => p.name === 'openai');
      openAIApiKey = openAIProvider?.apiKey || '';

      const anthropicProvider = config.llmConfig?.providers?.find((p: any) => p.name === 'anthropic');
      anthropicApiKey = anthropicProvider?.apiKey || '';

      const googleProvider = config.llmConfig?.providers?.find((p: any) => p.name === 'google');
      googleSpeechKey = googleProvider?.apiKey || '';

      // Get deepgram API key
      deepgramApiKey = config.deepgramConfig?.apiKey || '';

      // Log API key status (showing length for security, not actual keys)
      console.log('API keys loaded from database:', {
        elevenLabsApiKey: elevenLabsApiKey ? `SET (${elevenLabsApiKey.length} chars)` : 'NOT SET',
        openAIApiKey: openAIApiKey ? `SET (${openAIApiKey.length} chars)` : 'NOT SET',
        anthropicApiKey: anthropicApiKey ? `SET (${anthropicApiKey.length} chars)` : 'NOT SET',
        googleSpeechKey: googleSpeechKey ? `SET (${googleSpeechKey.length} chars)` : 'NOT SET',
        deepgramApiKey: deepgramApiKey ? `SET (${deepgramApiKey.length} chars)` : 'NOT SET'
      });
    } else {
      console.warn('No configuration document found in database');
    }
  } catch (error) {
    console.warn('Failed to load configuration from database, using empty keys:', error);
  }
};

// Initialize services with database configuration or empty keys
const getInitializedKeys = async () => {
  await initializeFromDatabase();
  return {
    elevenLabsApiKey,
    openAIApiKey,
    anthropicApiKey,
    googleSpeechKey
  };
};

// Use lazy initialization pattern to avoid creating services with empty API keys
let _conversationEngine: ConversationEngineService | null = null;
let _voiceAIService: EnhancedVoiceAIService | null = null;
let _llmService: LLMService | null = null;
let _advancedConversationEngine: AdvancedConversationEngine | null = null;

// Flag to track if services have been properly initialized with database configuration
let servicesInitialized = false;

// Getter functions that ensure services are initialized before returning
export const getConversationEngine = (): ConversationEngineService => {
  if (!_conversationEngine) {
    console.warn('ConversationEngine accessed before initialization, creating with empty keys');
    // Create with empty services
    const voiceAI = getVoiceAIService();
    const speechAnalysis = new SpeechAnalysisService('', '', '');
    const llmService = new LLMService({
      providers: [
        { name: 'openai', apiKey: '', isEnabled: true }
      ]
    });
    _conversationEngine = new ConversationEngineService(voiceAI, speechAnalysis, llmService);
  }
  return _conversationEngine;
};

export const getVoiceAIService = (): EnhancedVoiceAIService => {
  if (!_voiceAIService) {
    console.warn('VoiceAIService accessed before initialization, creating with empty key');
    _voiceAIService = new EnhancedVoiceAIService('');
  }
  return _voiceAIService;
};

export const getLLMService = (): LLMService => {
  if (!_llmService) {
    console.warn('LLMService accessed before initialization, creating with empty config');
    _llmService = new LLMService({
      providers: [],
      fallbackProviders: [],
      timeoutMs: 30000
    });
    // Make the LLM service available globally
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (global as any).llmService = _llmService;
  }
  return _llmService;
};

export const getAdvancedConversationEngine = (): AdvancedConversationEngine => {
  if (!_advancedConversationEngine) {
    console.warn('AdvancedConversationEngine accessed before initialization, creating with lazy services');
    _advancedConversationEngine = new AdvancedConversationEngine(getLLMService(), getVoiceAIService());
  }
  return _advancedConversationEngine;
};

// Legacy exports for backward compatibility (use getters internally)
export const conversationEngine = new Proxy({} as ConversationEngineService, {
  get: (target, prop) => getConversationEngine()[prop as keyof ConversationEngineService],
  set: (target, prop, value) => {
    (getConversationEngine() as any)[prop] = value;
    return true;
  }
});

export const voiceAIService = new Proxy({} as EnhancedVoiceAIService, {
  get: (target, prop) => getVoiceAIService()[prop as keyof EnhancedVoiceAIService],
  set: (target, prop, value) => {
    (getVoiceAIService() as any)[prop] = value;
    return true;
  }
});

export const llmService = new Proxy({} as LLMService, {
  get: (target, prop) => getLLMService()[prop as keyof LLMService],
  set: (target, prop, value) => {
    (getLLMService() as any)[prop] = value;
    return true;
  }
});

export const advancedConversationEngine = new Proxy({} as AdvancedConversationEngine, {
  get: (target, prop) => getAdvancedConversationEngine()[prop as keyof AdvancedConversationEngine],
  set: (target, prop, value) => {
    (getAdvancedConversationEngine() as any)[prop] = value;
    return true;
  }
});

// Export the conversation state machine
export { conversationStateMachine };

// Export webhook handlers individually - THIS IS THE KEY CHANGE
  export {
    handleTwilioGatherWebhook, handleTwilioStatusWebhook, handleTwilioStreamWebhook, handleTwilioVoiceWebhook, updateCallWithOutcome
  };

// Also export as namespace for backward compatibility if needed
  export * as webhookHandlers from './webhookHandlers';

// Export individual services
export {
  AdvancedCampaignService, AdvancedConversationEngine, ConversationEngineService,
  EnhancedVoiceAIService,
  LLMService,
  SpeechAnalysisService
};

// Export Model Compatibility Service
  export {
    getModelCompatibilityService, initializeModelCompatibilityService, ModelCompatibilityService
  } from './modelCompatibilityService';

// Deepgram Model Metrics removed

// Export service instances
export {
  advancedCampaignService
};

// Export optimized latency services
export { optimizedRealTimeAudioPipeline } from './optimizedRealTimeAudioPipeline';
export { enhancedBargeInDetectionService } from './enhancedBargeInDetectionService';
export { realTimeCallStateMachine } from './realTimeCallStateMachine';

// Export initialization function for post-database services
export const initializeServicesAfterDB = async () => {
  try {
    console.log('Starting services initialization after database connection...');

    // Re-initialize services that depend on database configuration
    await initializeFromDatabase();

    // Initialize the Deepgram controller
    try {
      const { initializeDeepgramController } = await import('../controllers/deepgramController');
      await initializeDeepgramController();
      logger.info('Deepgram controller initialized successfully');
    } catch (deepgramError) {
      logger.error('Failed to initialize Deepgram controller:', deepgramError);
    }

    // Monitoring metrics service initialization removed

    console.log('About to initialize services with keys:', {
      hasElevenLabsKey: !!elevenLabsApiKey,
      hasOpenAIKey: !!openAIApiKey,
      elevenLabsKeyLength: elevenLabsApiKey?.length || 0,
      openAIKeyLength: openAIApiKey?.length || 0
    });

    // Get TTS provider configuration
    const Configuration = require('../models/Configuration').default;
    const config = await Configuration.findOne();
    const selectedTTSProvider = config?.ttsConfig?.provider || 'elevenlabs';

    // Import TTS configuration helper
    const { isTTSProviderConfigured, hasAnyTTSProviderConfigured } = await import('../utils/ttsServiceFactory');

    // Check if the selected TTS provider is properly configured
    const isSelectedTTSConfigured = isTTSProviderConfigured(config);
    const hasAnyTTSConfigured = hasAnyTTSProviderConfigured(config);

    console.log('TTS Provider Configuration:', {
      selectedProvider: selectedTTSProvider,
      isSelectedConfigured: isSelectedTTSConfigured,
      hasAnyConfigured: hasAnyTTSConfigured,
      hasElevenLabsKey: !!elevenLabsApiKey,
      hasDeepgramKey: !!deepgramApiKey
    });

    // Initialize services - we need at least some API keys for core functionality
    // But TTS-specific services will only be initialized if the selected TTS provider is configured
    if (elevenLabsApiKey || openAIApiKey || anthropicApiKey || googleSpeechKey || deepgramApiKey) {
      console.log('Initializing services with API keys from database...');

      const voiceAIService = getVoiceAIService();
      if (selectedTTSProvider === 'elevenlabs' && isSelectedTTSConfigured && elevenLabsApiKey) {
        voiceAIService.updateApiKey(elevenLabsApiKey);
        console.log('VoiceAI service updated with ElevenLabs API key');
      } else {
        voiceAIService.updateApiKey('');
        if (selectedTTSProvider !== 'elevenlabs') {
          console.log(`Skipping ElevenLabs VoiceAI service - selected TTS provider is ${selectedTTSProvider}`);
        } else if (!isSelectedTTSConfigured) {
          console.log('ElevenLabs selected as TTS provider but not properly configured');
        } else {
          console.log('ElevenLabs selected but no API key available');
        }
      }

      // Initialize speech analysis service
      const speechAnalysis = new SpeechAnalysisService(
        openAIApiKey || '',
        googleSpeechKey || '',
        deepgramApiKey || ''
      );
      console.log('Speech analysis service initialized with API keys (Deepgram length:', deepgramApiKey?.length || 0, ')');

      // Initialize LLM service
      const llmService = new LLMService({
        providers: [
          { name: 'openai', apiKey: openAIApiKey || '', isEnabled: !!openAIApiKey },
          { name: 'anthropic', apiKey: anthropicApiKey || '', isEnabled: !!anthropicApiKey }
        ]
      });

      // Initialize ConversationEngine with all services
      _conversationEngine = new ConversationEngineService(
        _voiceAIService,
        speechAnalysis,
        llmService
      );

      // Initialize LLM service with proper configuration
      await reinitializeGlobalLLMService();

      // Initialize advanced conversation engine with initialized services
      _advancedConversationEngine = new AdvancedConversationEngine(getLLMService(), getVoiceAIService());

      servicesInitialized = true;
      console.log('Core services initialized with database configuration');

      // Log Deepgram configuration status
      console.log('Deepgram API key loaded:', deepgramApiKey ? `${deepgramApiKey.substring(0, 8)}...` : 'NOT SET');
    } else {
      console.warn('No API keys found in database for core services');
      console.log('Services will only be initialized if the selected TTS provider is properly configured');

      // Even without core API keys, we can still initialize basic services if TTS is configured
      if (isSelectedTTSConfigured) {
        _voiceAIService = new EnhancedVoiceAIService('');
        console.log(`Minimal service initialization - TTS provider ${selectedTTSProvider} is configured`);
      }
    }

    // Always update existing conversation engine with latest API keys from database
    // This ensures that even if the conversation engine was created earlier with empty keys,
    // it gets updated with the proper configuration from the database
    if (_conversationEngine) {
      console.log('Updating existing ConversationEngine with database API keys...');
      _conversationEngine.updateApiKeys(openAIApiKey, googleSpeechKey, deepgramApiKey);
      console.log('ConversationEngine updated with Deepgram API key:', deepgramApiKey ? 'SET' : 'NOT SET');
    }

    // Import and call reinitializeLLMServiceWithDbConfig to ensure campaign service LLM is properly initialized
    const { reinitializeLLMServiceWithDbConfig } = await import('./advancedCampaignService');
    await reinitializeLLMServiceWithDbConfig();

    // Initialize TTS services based on selected provider and its configuration
    const shouldInitializeElevenLabs = selectedTTSProvider === 'elevenlabs' && isSelectedTTSConfigured && elevenLabsApiKey && openAIApiKey;
    const shouldInitializeDeepgram = selectedTTSProvider === 'deepgram' && isSelectedTTSConfigured && deepgramApiKey;
    const shouldInitializeTTS = shouldInitializeElevenLabs || shouldInitializeDeepgram || (selectedTTSProvider !== 'elevenlabs' && selectedTTSProvider !== 'deepgram' && openAIApiKey);

    if (shouldInitializeTTS) {
      try {
        if (shouldInitializeElevenLabs) {
          console.log('Initializing ElevenLabs services with API keys from database...');

          // Re-initialize the ElevenLabs Conversational Service with the database API keys
          const { initializeConversationalService } = await import('./elevenLabsConversationalService');
          initializeConversationalService(elevenLabsApiKey, openAIApiKey);
          console.log('ElevenLabs Conversational Service initialized');

          // Re-initialize the ElevenLabs SDK Service with the database API keys
          const { initializeSDKService } = await import('./elevenlabsSDKService');
          const sdkService = initializeSDKService(elevenLabsApiKey);
          console.log('ElevenLabs SDK Service initialized:', !!sdkService);

          // Load the SDK extension with streaming methods
          await import('./elevenlabsSDKExtension');

          // Initialize parallel processing service if SDK service is available
          if (sdkService) {
            const { initializeParallelProcessingService } = await import('./parallelProcessingService');
            initializeParallelProcessingService(sdkService, getLLMService());
            logger.info('Parallel processing service initialized for low-latency responses');
          }

          console.log('ElevenLabs Voice AI services initialized with database configuration');
          logger.info('ElevenLabs Voice AI services initialized with database configuration');
        } else if (shouldInitializeDeepgram) {
          console.log('Initializing Deepgram TTS services with API key from database...');

          // Initialize Deepgram TTS service
          const { initializeDeepgramTTS } = await import('./deepgramTTSService');
          initializeDeepgramTTS(deepgramApiKey);
          console.log('Deepgram TTS service initialized');
          logger.info('Deepgram TTS service initialized with database configuration');
        } else {
          console.log(`TTS provider is ${selectedTTSProvider}, skipping provider-specific services`);
          logger.info(`TTS provider is ${selectedTTSProvider}, skipping provider-specific services`);
        }
      } catch (voiceAIError) {
        console.error('Failed to initialize Voice AI services:', voiceAIError);
        logger.error('Failed to initialize Voice AI services:', voiceAIError);
      }
    } else {
      console.warn(`Skipping TTS services initialization for provider ${selectedTTSProvider}:`, {
        selectedProvider: selectedTTSProvider,
        isSelectedConfigured: isSelectedTTSConfigured,
        hasElevenLabsKey: !!elevenLabsApiKey,
        hasDeepgramKey: !!deepgramApiKey,
        hasOpenAIKey: !!openAIApiKey,
        reason: !isSelectedTTSConfigured ? 'Selected TTS provider not properly configured' : 'Required API keys missing'
      });
    }

    // Update global conversation engine if it exists
    if (global.conversationEngine && typeof global.conversationEngine.updateApiKeys === 'function') {
      try {
        global.conversationEngine.updateApiKeys(elevenLabsApiKey, openAIApiKey, anthropicApiKey, googleSpeechKey);
        logger.info('Global conversation engine updated with database configuration');
      } catch (error) {
        logger.error('Failed to update global conversation engine API keys:', error);
      }
    }

    console.log('All services re-initialized with database configuration');
  } catch (error) {
    console.error('Error re-initializing services after database connection:', error);
  }
};

// Function to reinitialize global LLM service with database configuration
export const reinitializeGlobalLLMService = async () => {
  try {
    const config = await Configuration.findOne();
    if (config && config.llmConfig?.providers) {
      // Transform database configuration to LLM service configuration
      const llmConfig = {
        providers: config.llmConfig.providers.map(p => ({
          name: p.name.toLowerCase() as any,
          apiKey: p.apiKey,
          isEnabled: p.isEnabled,
          models: p.availableModels || [],
          defaultModel: p.availableModels && p.availableModels.length > 0 ? p.availableModels[0] : undefined,
          useRealtimeAPI: p.useRealtimeAPI || false // Ensure this is included in the LLM service config
        })),
        defaultProvider: (config.llmConfig.defaultProvider?.toLowerCase() || 'openai') as any,
        defaultModel: config.llmConfig.defaultModel || 'gpt-4',
        timeoutMs: 30000,
        retryConfig: {
          maxRetries: 2,
          initialDelayMs: 1000,
          maxDelayMs: 5000
        }
      };

      // Create or update the LLM service with proper configuration
      if (!_llmService) {
        _llmService = new LLMService(llmConfig);
      } else {
        // Update the existing service configuration
        _llmService.updateConfig(llmConfig);
      }

      // Make the LLM service available globally
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (global as any).llmService = _llmService;

      // Store the llmService instance in the configuration for shared access across controllers
      // This is stored as a property but not persisted to the database
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (config as any).llmConfig.llmService = _llmService;

      logger.info('Global LLM service reinitialized with database configuration and stored for shared access');
    } else {
      logger.warn('No LLM configuration found in database for global service');
    }
  } catch (error) {
    logger.error('Failed to reinitialize global LLM service:', error);
  }
};
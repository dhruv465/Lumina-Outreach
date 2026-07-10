// Export the LiveKit-era service surface from a central file for easier imports.
import Configuration from '../models/Configuration';
import { logger } from '../index';
import {
  CampaignService,
  campaignService,
  reinitializeLLMServiceWithDbConfig,
} from './campaignService';
import { LLMService } from './llm/service';
import { LLMConfig, LLMProvider } from './llm/types';

let _llmService: LLMService | null = null;

const createFallbackLLMService = () => new LLMService({
  providers: [],
  fallbackProviders: [],
  defaultProvider: 'openai' as LLMProvider,
  defaultModel: 'gpt-4',
  timeoutMs: 30000,
  retryConfig: {
    maxRetries: 2,
    initialDelayMs: 1000,
    maxDelayMs: 5000,
  },
});

export const getLLMService = (): LLMService => {
  if (!_llmService) {
    logger.warn('LLMService accessed before database initialization, creating fallback config');
    _llmService = createFallbackLLMService();
    (global as any).llmService = _llmService;
  }

  return _llmService;
};

export const llmService = new Proxy({} as LLMService, {
  get: (_target, prop) => (getLLMService() as any)[prop],
  set: (_target, prop, value) => {
    (getLLMService() as any)[prop] = value;
    return true;
  },
});

const legacyVoicePipelineRemoved = async () => ({
  success: false,
  error: 'Legacy voice pipeline removed. Use the LiveKit call pipeline.',
});

export const voiceAIService: any = new Proxy({}, {
  get: (_target, prop) => {
    if (prop === 'sdkService') return null;
    return legacyVoicePipelineRemoved;
  },
  set: () => true,
});

export const getVoiceAIService = () => voiceAIService;

export const conversationEngine: any = new Proxy({}, {
  get: () => legacyVoicePipelineRemoved,
  set: () => true,
});

export const getConversationEngine = () => conversationEngine;

export const reinitializeGlobalLLMService = async () => {
  try {
    const config = await Configuration.findOne();
    const dbLlmConfig = config?.llmConfig;

    if (!dbLlmConfig?.providers) {
      logger.warn('No LLM configuration found in database for global service');
      _llmService = createFallbackLLMService();
      (global as any).llmService = _llmService;
      return;
    }

    const llmConfig: LLMConfig = {
      providers: dbLlmConfig.providers.map((provider) => ({
        name: provider.name.toLowerCase() as LLMProvider,
        apiKey: provider.apiKey,
        isEnabled: provider.isEnabled,
        models: provider.availableModels || [],
        defaultModel: provider.availableModels?.[0],
        useRealtimeAPI: provider.useRealtimeAPI || false,
      })),
      defaultProvider: (dbLlmConfig.defaultProvider?.toLowerCase() || 'openai') as LLMProvider,
      defaultModel: dbLlmConfig.defaultModel || 'gpt-4',
      timeoutMs: 30000,
      retryConfig: {
        maxRetries: 2,
        initialDelayMs: 1000,
        maxDelayMs: 5000,
      },
    };

    if (!_llmService) {
      _llmService = new LLMService(llmConfig);
    } else {
      _llmService.updateConfig(llmConfig);
    }

    (global as any).llmService = _llmService;
    (config as any).llmConfig.llmService = _llmService;

    logger.info('Global LLM service reinitialized with database configuration');
  } catch (error) {
    logger.error('Failed to reinitialize global LLM service:', error);
    if (!_llmService) {
      _llmService = createFallbackLLMService();
      (global as any).llmService = _llmService;
    }
  }
};

export const initializeServicesAfterDB = async () => {
  await reinitializeGlobalLLMService();
  await reinitializeLLMServiceWithDbConfig();
};

export { CampaignService, campaignService, LLMService };

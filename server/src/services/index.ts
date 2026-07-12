// Export the LiveKit-era service surface from a central file for easier imports.
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
  _llmService = createFallbackLLMService();
  (global as any).llmService = _llmService;
  logger.warn(
    'Global database-key initialization disabled; BYO credentials require an owner-scoped request path.',
  );
};

export const initializeServicesAfterDB = async () => {
  await reinitializeGlobalLLMService();
  await reinitializeLLMServiceWithDbConfig();
};

export { CampaignService, campaignService, LLMService };

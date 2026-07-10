import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import logger, { getErrorMessage } from '../utils/logger';
import { LLMService } from './llm/service';
import { LLMChatRequest, LLMProvider } from './llm/types';

export interface AIServiceOptions {
  defaultTimeout?: number;
}

export interface AIResponse {
  requestId: string;
  success: boolean;
  data?: any;
  error?: string;
  metadata: {
    provider: string;
    model?: string;
    latency: number;
    tokens?: {
      prompt: number;
      completion: number;
      total: number;
    };
  };
}

export interface AIServiceMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatency: number;
  cacheHitRate: number;
  tokenUsage: {
    prompt: number;
    completion: number;
    total: number;
  };
  costEstimate: number;
  providerBreakdown: Record<string, {
    requests: number;
    success: number;
    failure: number;
    avgLatency: number;
  }>;
}

export class AIOrchestrationService extends EventEmitter {
  private llmService = new LLMService({
    providers: [],
    fallbackProviders: [],
    timeoutMs: 30000,
  });

  private metrics = {
    requestsTotal: 0,
    requestsSuccess: 0,
    requestsFailure: 0,
    latencySum: 0,
    tokenUsage: { prompt: 0, completion: 0, total: 0 },
    providerStats: new Map<string, { requests: number; success: number; failure: number; latencySum: number }>(),
  };

  constructor(private options: AIServiceOptions = {}) {
    super();
  }

  async processLLMRequest(
    params: Omit<LLMChatRequest, 'provider'> & {
      provider?: LLMProvider;
      timeout?: number;
    }
  ): Promise<AIResponse> {
    const requestId = uuidv4();
    const startTime = Date.now();
    const provider = params.provider || this.llmService.getDefaultProviderName();

    try {
      const timeout = params.timeout || this.options.defaultTimeout || 30000;
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`LLM request timed out after ${timeout}ms`)), timeout);
      });

      const result = await Promise.race([
        this.llmService.chat({
          provider,
          model: params.model,
          messages: params.messages,
          options: params.options,
          responseFormat: params.responseFormat,
        }),
        timeoutPromise,
      ]);

      const latency = Date.now() - startTime;
      const tokenUsage = result.usage
        ? {
            prompt: result.usage.promptTokens,
            completion: result.usage.completionTokens,
            total: result.usage.totalTokens,
          }
        : undefined;

      this.updateMetrics(result.provider, true, latency, tokenUsage);

      return {
        requestId,
        success: true,
        data: result,
        metadata: {
          provider: result.provider,
          model: result.model,
          latency,
          tokens: tokenUsage,
        },
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      this.updateMetrics(provider, false, latency);
      logger.error(`LLM request failed: ${getErrorMessage(error)}`);

      return {
        requestId,
        success: false,
        error: getErrorMessage(error),
        metadata: { provider, latency },
      };
    }
  }

  async processVoiceRequest(): Promise<AIResponse> {
    return this.removedResponse('livekit-agent');
  }

  async processSpeechAnalysisRequest(): Promise<AIResponse> {
    return this.removedResponse('livekit-agent');
  }

  async processConversationRequest(): Promise<AIResponse> {
    return this.removedResponse('livekit-agent');
  }

  async processIntentDetectionRequest(): Promise<AIResponse> {
    return this.removedResponse('local-fallback');
  }

  async processObjectionDetectionRequest(): Promise<AIResponse> {
    return this.removedResponse('local-fallback');
  }

  async processQualityAnalysisRequest(): Promise<AIResponse> {
    return {
      requestId: uuidv4(),
      success: true,
      data: { overallScore: 0.85 },
      metadata: { provider: 'local-scoring', latency: 0 },
    };
  }

  async detectEmotion(text: string): Promise<AIResponse> {
    const lower = text.toLowerCase();
    const emotion = lower.includes('yes') || lower.includes('interested') ? 'positive'
      : lower.includes('no') || lower.includes('not interested') ? 'negative'
        : 'neutral';

    return {
      requestId: uuidv4(),
      success: true,
      data: { emotion, confidence: 0.6 },
      metadata: { provider: 'local-fallback', latency: 0 },
    };
  }

  getMetrics(): AIServiceMetrics {
    const providerBreakdown: AIServiceMetrics['providerBreakdown'] = {};
    for (const [provider, stats] of this.metrics.providerStats.entries()) {
      providerBreakdown[provider] = {
        requests: stats.requests,
        success: stats.success,
        failure: stats.failure,
        avgLatency: stats.requests ? stats.latencySum / stats.requests : 0,
      };
    }

    return {
      totalRequests: this.metrics.requestsTotal,
      successfulRequests: this.metrics.requestsSuccess,
      failedRequests: this.metrics.requestsFailure,
      avgLatency: this.metrics.requestsTotal ? this.metrics.latencySum / this.metrics.requestsTotal : 0,
      cacheHitRate: 0,
      tokenUsage: this.metrics.tokenUsage,
      costEstimate: 0,
      providerBreakdown,
    };
  }

  clearCache(): void {}

  async updateConfiguration(): Promise<void> {
    logger.info('AI orchestration configuration update skipped; LLM service is database-initialized elsewhere');
  }

  getLLMService(): LLMService {
    return this.llmService;
  }

  getVoiceService(): null {
    return null;
  }

  getSpeechService(): null {
    return null;
  }

  getConversationEngine(): null {
    return null;
  }

  private removedResponse(provider: string): AIResponse {
    return {
      requestId: uuidv4(),
      success: false,
      error: 'Legacy voice pipeline removed; use LiveKit agent path',
      metadata: { provider, latency: 0 },
    };
  }

  private updateMetrics(
    provider: string,
    success: boolean,
    latency: number,
    tokenUsage?: { prompt: number; completion: number; total: number }
  ): void {
    this.metrics.requestsTotal++;
    this.metrics.latencySum += latency;
    if (success) this.metrics.requestsSuccess++;
    else this.metrics.requestsFailure++;

    if (tokenUsage) {
      this.metrics.tokenUsage.prompt += tokenUsage.prompt;
      this.metrics.tokenUsage.completion += tokenUsage.completion;
      this.metrics.tokenUsage.total += tokenUsage.total;
    }

    const stats = this.metrics.providerStats.get(provider) || {
      requests: 0,
      success: 0,
      failure: 0,
      latencySum: 0,
    };
    stats.requests++;
    stats.latencySum += latency;
    if (success) stats.success++;
    else stats.failure++;
    this.metrics.providerStats.set(provider, stats);
  }
}

let _aiOrchestrationService: AIOrchestrationService | null = null;

export const getAIOrchestrationService = (): AIOrchestrationService => {
  if (!_aiOrchestrationService) {
    _aiOrchestrationService = new AIOrchestrationService();
  }
  return _aiOrchestrationService;
};

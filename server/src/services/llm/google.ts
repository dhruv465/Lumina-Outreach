/**
 * Google/Gemini Provider Implementation
 */
import { GoogleGenerativeAI } from '@google/generative-ai';
import { ILLMProviderClient } from './base';
import { 
  LLMProvider,
  LLMMessage,
  LLMResponse,
  LLMStreamChunk,
  LLMError,
  TokenUsage,
  ModelInfo
} from './types';
import { logger } from '../../index';
import { executeWithRateLimit } from '../../utils/rateLimiter';

export class GoogleClient implements ILLMProviderClient {
  readonly provider: LLMProvider = 'google';
  private client: GoogleGenerativeAI | null = null;
  private defaultModel: string;
  private apiKey: string = '';
  
  constructor(
    apiKey?: string, 
    options?: { 
      defaultModel?: string;
    }
  ) {
    this.apiKey = apiKey || '';
    this.defaultModel = options?.defaultModel || 'gemini-1.5-flash';
    
    if (this.apiKey && this.apiKey.trim() !== '') {
      this.initializeClient();
    } else {
      logger.info('Google/Gemini client created without API key - will initialize when configuration is loaded from database');
    }
  }
  
  /**
   * Initialize the Google client with current API key
   */
  private initializeClient(): void {
    try {
      if (!this.apiKey || this.apiKey.trim() === '') {
        throw new Error('Google API key is required but not provided');
      }
      
      this.client = new GoogleGenerativeAI(this.apiKey);
      
      // Validate model name
      if (!this.defaultModel || this.defaultModel.trim() === '') {
        this.defaultModel = 'gemini-1.5-flash';
      }
      
      logger.info(`Google/Gemini client initialized with model: ${this.defaultModel}`);
    } catch (error) {
      logger.error('Failed to initialize Google/Gemini client:', error);
      this.client = null;
      throw error;
    }
  }
  
  /**
   * Update configuration from database
   */
  public updateConfiguration(apiKey: string, defaultModel?: string): void {
    this.apiKey = apiKey;
    if (defaultModel) {
      this.defaultModel = defaultModel;
    }
    
    if (this.apiKey && this.apiKey.trim() !== '') {
      this.initializeClient();
    } else {
      this.client = null;
      logger.info('Google/Gemini client API key cleared');
    }
  }
  
  getProviderName(): LLMProvider {
    return this.provider;
  }
  
  isConfigured(): boolean {
    return !!this.client && !!this.apiKey && this.apiKey.trim() !== '';
  }
  
  async testConnection(): Promise<boolean> {
    try {
      if (!this.client) {
        logger.warn('Google/Gemini client not initialized - cannot test connection');
        return false;
      }
      
      const model = this.client.getGenerativeModel({ model: this.defaultModel });
      await model.generateContent("");
      return true;
    } catch (error) {
      logger.error(`Google/Gemini connection test failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }
  
  async completion(request: Omit<import('./types').LLMCompletionRequest, 'provider'>): Promise<LLMResponse> {
    try {
      if (!this.client) {
        throw new Error('Google/Gemini client not initialized - API key may be missing');
      }
      
      const { model: requestModel, prompt, options } = request;
      const resolvedModel = (requestModel && requestModel.trim() !== '') ? requestModel : this.defaultModel;

      if (!resolvedModel || resolvedModel.trim() === '') {
        throw new Error('Google/Gemini model name is missing or empty after attempting to resolve.');
      }
      
      // Use rate limiter to manage API requests
      return await executeWithRateLimit('google', async () => {
        const googleModel = this.client!.getGenerativeModel({
          model: resolvedModel,
          generationConfig: {
            temperature: options?.temperature,
            maxOutputTokens: options?.maxTokens,
            topP: options?.topP,
            stopSequences: options?.stopSequences,
          }
        });
        
        const result = await googleModel.generateContent(prompt);
        const response = result.response;
        
        // Google doesn't provide token usage in the same way
        // Estimate based on input and output length
        const estimatedPromptTokens = Math.ceil(prompt.length / 4);
        const responseText = response.text();
        const estimatedCompletionTokens = Math.ceil(responseText.length / 4);
        
        const usage: TokenUsage = {
          promptTokens: estimatedPromptTokens,
          completionTokens: estimatedCompletionTokens,
          totalTokens: estimatedPromptTokens + estimatedCompletionTokens
        };
        
        return {
          content: responseText,
          model: resolvedModel, // Ensure resolvedModel is used here
          provider: this.provider,
          usage,
          rawResponse: response
        };
      });
    } catch (error) {
      this.handleError(error);
    }
  }
  
  async chat(request: Omit<import('./types').LLMChatRequest, 'provider'>): Promise<LLMResponse> {
    try {
      if (!this.client) {
        throw new Error('Google/Gemini client not initialized - API key may be missing');
      }
      
      const { model: requestModel, messages, options } = request;
      const resolvedModel = (requestModel && requestModel.trim() !== '') ? requestModel : this.defaultModel;

      if (!resolvedModel || resolvedModel.trim() === '') {
        throw new Error('Google/Gemini model name is missing or empty after attempting to resolve.');
      }
      
      // Use rate limiter to manage API requests
      return await executeWithRateLimit('google', async () => {
        const googleModel = this.client!.getGenerativeModel({
          model: resolvedModel,
          generationConfig: {
            temperature: options?.temperature,
            maxOutputTokens: options?.maxTokens,
            topP: options?.topP,
            stopSequences: options?.stopSequences,
          }
        });
        
        // Convert to Google's chat format
        const chat = googleModel.startChat({
          history: this.convertMessagesToGoogleFormat(messages),
        });
        
        // Get the last user message
        const lastUserMessage = messages.filter(m => m.role === 'user').pop();
        if (!lastUserMessage) {
          throw new Error('No user message found in the conversation');
        }
        
        const result = await chat.sendMessage(lastUserMessage.content);
        const response = result.response;
        
        // Estimate token usage
        const inputText = messages.map(m => m.content).join(' ');
        const estimatedPromptTokens = Math.ceil(inputText.length / 4);
        const responseText = response.text();
        const estimatedCompletionTokens = Math.ceil(responseText.length / 4);
        
        const usage: TokenUsage = {
          promptTokens: estimatedPromptTokens,
          completionTokens: estimatedCompletionTokens,
          totalTokens: estimatedPromptTokens + estimatedCompletionTokens
        };
        
        return {
          content: responseText,
          model: resolvedModel, // Ensure resolvedModel is used here
          provider: this.provider,
          usage,
          rawResponse: response
        };
      });
    } catch (error) {
      this.handleError(error);
    }
  }
  
  async streamChat(
    request: Omit<import('./types').LLMChatRequest, 'provider'>,
    onChunk: (chunk: LLMStreamChunk) => void
  ): Promise<void> {
    try {
      if (!this.client) {
        throw new Error('Google/Gemini client not initialized - API key may be missing');
      }
      
      const { model: requestModel, messages, options } = request;
      const resolvedModel = (requestModel && requestModel.trim() !== '') ? requestModel : this.defaultModel;

      if (!resolvedModel || resolvedModel.trim() === '') {
        throw new Error('Google/Gemini model name is missing or empty after attempting to resolve.');
      }
      
      // Use rate limiter to manage API requests
      await executeWithRateLimit('google', async () => {
        const googleModel = this.client!.getGenerativeModel({
          model: resolvedModel,
          generationConfig: {
            temperature: options?.temperature,
            maxOutputTokens: options?.maxTokens,
            topP: options?.topP,
            stopSequences: options?.stopSequences,
          }
        });
        
        // Convert to Google's chat format
        const chat = googleModel.startChat({
          history: this.convertMessagesToGoogleFormat(messages),
        });
        
        // Get the last user message
        const lastUserMessage = messages.filter(m => m.role === 'user').pop();
        if (!lastUserMessage) {
          throw new Error('No user message found in the conversation');
        }
        
        const result = await chat.sendMessageStream(lastUserMessage.content);
        
        for await (const chunk of result.stream) {
          const text = chunk.text();
          
          onChunk({
            content: text,
            isDone: false,
            rawChunk: chunk
          });
        }
        
        // Signal completion
        onChunk({
          content: '',
          isDone: true,
          rawChunk: null
        });
      });
    } catch (error) {
      this.handleError(error);
    }
  }
  
  async countTokens(input: string | LLMMessage[]): Promise<number> {
    // Simplified token counting
    let text = '';
    
    if (typeof input === 'string') {
      text = input;
    } else {
      text = input.map(m => m.content).join(' ');
    }
    
    // Rough approximation: 1 token ≈ 4 characters for English text
    return Math.ceil(text.length / 4);
  }
  
  async listModels(): Promise<string[]> {
    try {
      // Fetch available models from Gemini API
      const modelData = await this.fetchGeminiModels();
      return modelData.map(model => model.id);
    } catch (error) {
      logger.error(`Failed to fetch Gemini models: ${error instanceof Error ? error.message : String(error)}`);
      // Don't provide fallback models, just return an empty array
      return [];
    }
  }

  async getAvailableModels(): Promise<ModelInfo[]> {
    try {
      // Attempt to fetch models from Gemini API
      return await this.fetchGeminiModels();
    } catch (error) {
      logger.error(`Failed to fetch Gemini models details: ${error instanceof Error ? error.message : String(error)}`);
      // Don't provide fallback model info, just return an empty array
      return [];
    }
  }
  
  
  private convertMessagesToGoogleFormat(messages: LLMMessage[]): { role: string, parts: { text: string }[] }[] {
    return messages
      .filter(m => m.role !== 'system') // Google handles system messages differently
      .map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
  }
  
  private async fetchGeminiModels(): Promise<ModelInfo[]> {
    try {
      // Use the Gemini API to fetch available models
      // We need to make a direct request since the SDK doesn't expose a models.list method
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${
        (this.client as any).apiKey
      }`);
      
      if (!response.ok) {
        throw new Error(`API returned status ${response.status}`);
      }
      
      const data = await response.json() as { models: Array<{
        name: string;
        version: string;
        displayName?: string;
        description?: string;
        inputTokenLimit?: number;
        outputTokenLimit?: number;
      }> };
      
      if (!data.models || !Array.isArray(data.models)) {
        throw new Error('Invalid response format from Gemini API');
      }
      
      // Transform the API response to our ModelInfo format
      return data.models
        .filter(model => model.name && model.name.includes('gemini'))
        .map(model => {
          const modelName = model.name.split('/').pop() || '';
          const displayName = model.displayName || this.formatModelName(modelName);
          
          return {
            id: modelName,
            name: displayName,
            description: model.description || `${displayName} - Gemini model by Google`,
            maxTokens: model.inputTokenLimit || 8192,
            contextWindow: model.outputTokenLimit || 32768,
            capabilities: {
              chat: true,
              completion: true,
              streaming: true,
              vision: modelName.includes('vision'),
              functionCalling: modelName.includes('pro')
            }
          };
        });
    } catch (error) {
      logger.error(`Error fetching Gemini models: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
  
  private formatModelName(modelId: string): string {
    // Convert model ID like 'gemini-2.0-flash' to 'Gemini 2.0 Flash'
    return modelId
      .split('-')
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }
  
  private handleError(error: any): never {
    const llmError: LLMError = new Error(
      error.message || 'Unknown Google/Gemini error'
    ) as LLMError;
    
    llmError.provider = this.provider;
    llmError.name = 'GoogleError';
    
    // Google's error format is different, try to extract useful info
    if (error.status) {
      llmError.statusCode = error.status;
      // Determine if the error is retryable based on status code
      llmError.retryable = [429, 500, 502, 503, 504].includes(error.status);
    } else {
      // Network errors are generally retryable
      llmError.retryable = true;
    }
    
    llmError.rawError = error;
    
    logger.error(`Google/Gemini error: ${llmError.message}`, {
      statusCode: llmError.statusCode,
      retryable: llmError.retryable
    });
    
    throw llmError;
  }
}

/**
 * LLM Service SDK - Type Definitions
 * 
 * This file contains all type definitions and interfaces for the unified LLM service.
 */

// Provider types
export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'gemini';

// Message role types
export type MessageRole = 'system' | 'user' | 'assistant' | 'function';

// Base interfaces
export interface LLMMessage {
  role: MessageRole;
  content: string;
}

export interface LLMRequestOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stopSequences?: string[];
}

export interface LLMResponseFormat {
  type?: 'text' | 'json';
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// Model information interface
export interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  maxTokens?: number;
  contextWindow?: number;
  pricing?: {
    input: number;  // per 1K tokens
    output: number; // per 1K tokens
  };
  capabilities?: {
    chat: boolean;
    completion: boolean;
    streaming: boolean;
    functionCalling?: boolean;
    vision?: boolean;
  };
}

// Request interfaces
export interface LLMCompletionRequest {
  provider: LLMProvider;
  model: string;
  prompt: string;
  options?: LLMRequestOptions;
  responseFormat?: LLMResponseFormat;
}

export interface LLMChatRequest {
  provider: LLMProvider;
  model: string;
  messages: LLMMessage[];
  options?: LLMRequestOptions;
  responseFormat?: LLMResponseFormat;
}

// Response interfaces
export interface LLMResponse {
  content: string;
  model: string;
  provider: LLMProvider;
  usage?: TokenUsage;
  rawResponse?: any; // Original provider response
}

export interface LLMStreamChunk {
  content: string;
  isDone: boolean;
  rawChunk?: any; // Original provider chunk
}

// Error interface
export interface LLMError extends Error {
  provider: LLMProvider;
  statusCode?: number;
  errorCode?: string;
  retryable: boolean;
  rawError?: any; // Original provider error
}

// LLMError class implementation
export class LLMErrorImpl extends Error implements LLMError {
  provider: LLMProvider;
  statusCode?: number;
  errorCode?: string;
  retryable: boolean;
  rawError?: any;

  constructor(
    message: string,
    errorCode?: string,
    statusCode?: number,
    provider?: LLMProvider,
    retryable: boolean = false
  ) {
    super(message);
    this.name = 'LLMError';
    this.errorCode = errorCode;
    this.statusCode = statusCode;
    this.provider = provider || 'openai';
    this.retryable = retryable;
  }
}

// Configuration interface
export interface LLMProviderConfig {
  name: LLMProvider;
  apiKey: string;
  baseUrl?: string;
  defaultModel?: string;
  models?: string[];
  isEnabled?: boolean;
  organization?: string; // For OpenAI
}

export interface LLMConfig {
  providers: LLMProviderConfig[];
  defaultProvider?: LLMProvider;
  defaultModel?: string;
  fallbackProviders?: LLMProvider[];
  timeoutMs?: number;
  retryConfig?: {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
  };
}

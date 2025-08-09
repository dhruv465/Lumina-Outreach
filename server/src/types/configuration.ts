// Configuration type definitions

// LLM Provider Types
export interface BaseLLMProvider {
  name: string;
  apiKey: string;
  availableModels: string[];
  isEnabled: boolean;
  lastVerified?: Date;
  status?: 'unverified' | 'verified' | 'failed';
}

export interface UpdateLLMProvider {
  name: string;
  apiKey?: string;
  availableModels?: string[];
  isEnabled?: boolean;
  lastVerified?: Date;
  status?: 'unverified' | 'verified' | 'failed';
}

export interface LLMConfig {
  providers: BaseLLMProvider[];
  defaultProvider: string;
  defaultModel: string;
  temperature: number;
  maxTokens: number;
}

// Voice Configuration Types
export interface VoiceConfig {
  voiceId: string;
  name: string;
  previewUrl: string;
}

export interface ElevenLabsConfig {
  apiKey: string;
  selectedVoiceId?: string;
  availableVoices: VoiceConfig[];
  isEnabled: boolean;
  voiceSpeed: number;
  voiceStability: number;
  voiceClarity: number;
  lastVerified?: Date;
  status?: 'unverified' | 'verified' | 'failed';
}

// Communication Provider Types
export interface TwilioConfig {
  accountSid: string;
  authToken: string;
  phoneNumbers: string[];
  isEnabled: boolean;
  lastVerified?: Date;
  status?: 'unverified' | 'verified' | 'failed';
}

// Webhook Configuration
export interface WebhookConfig {
  url: string;
  secret: string;
  lastVerified?: Date;
  status?: 'unverified' | 'verified' | 'failed';
}

// Working Hours Configuration
export interface WorkingHours {
  start: string;
  end: string;
  timeZone: string;
  daysOfWeek: string[];
}

// General Settings
export interface GeneralSettings {
  defaultLanguage: string;
  supportedLanguages: string[];
  maxConcurrentCalls: number;
  callRetryAttempts: number;
  callRetryDelay: number;
  maxCallDuration: number;
  defaultSystemPrompt: string;
  defaultTimeZone: string;
  workingHours: WorkingHours;
}

// Compliance Settings
export interface ComplianceSettings {
  recordCalls: boolean;
  maxCallsPerLeadPerDay: number;
  callBlackoutPeriod: {
    start: string;
    end: string;
  };
}

// Voice AI Configuration Types
export interface VoiceAIPersonality {
  id: string;
  name: string;
  description: string;
  voiceId: string;
  personality: string;
  style: string;
  emotionalRange: string[];
  languageSupport: string[];
  settings: {
    stability: number;
    similarityBoost: number;
    style: number;
    useSpeakerBoost: boolean;
  };
}

export interface BilingualSupportConfig {
  enabled: boolean;
  primaryLanguage: string;
  secondaryLanguage: string;
  autoLanguageDetection: boolean;
}

export interface ConversationFlowConfig {
  personalityAdaptation: boolean;
  contextAwareness: boolean;
  naturalPauses: boolean;
}

export interface ConversationalAIConfig {
  enabled: boolean;
  useSDK: boolean;
  interruptible: boolean;
  adaptiveTone: boolean;
  naturalConversationPacing: boolean;
  voiceSettings: {
    speed: number;
    stability: number;
    style: number;
  };
  defaultVoiceId: string;
  defaultModelId: string;
}

export interface VoiceAIConfig {
  personalities: VoiceAIPersonality[];
  bilingualSupport: BilingualSupportConfig;
  conversationFlow: ConversationFlowConfig;
  conversationalAI: ConversationalAIConfig;
}

// Deepgram Configuration Types
export interface DeepgramConfig {
  apiKey: string;
  isEnabled: boolean;
  
  // Model configuration with fallback support
  primaryModel: string;
  fallbackModels: string[];
  autoFallback: boolean;
  
  // Account information
  accountTier?: 'free' | 'basic' | 'premium';
  availableModels?: string[];
  lastModelValidation?: Date | null;
  
  // Validation status
  lastVerified?: Date | null;
  status?: 'unverified' | 'verified' | 'failed' | 'degraded';
  lastError?: string;
  
  // Performance settings
  tier: string; // Kept for backward compatibility
  retryAttempts: number;
  timeoutMs: number;
  
  // Model compatibility tracking
  modelCompatibilityStatus?: Map<string, {
    isCompatible: boolean;
    lastTested: Date;
    error?: string;
  }>;
}

// Full Configuration Interface
export interface IConfiguration {
  twilioConfig: TwilioConfig;
  elevenLabsConfig: ElevenLabsConfig;
  llmConfig: LLMConfig;
  generalSettings: GeneralSettings;
  complianceSettings: ComplianceSettings;
  webhookConfig: WebhookConfig;
  voiceAIConfig: VoiceAIConfig;
  deepgramConfig: DeepgramConfig;
  toObject(): any;
  save(): Promise<any>;
}

// TTS Configuration Types
export interface DeepgramTTSConfig {
  apiKey: string;
  isEnabled: boolean;
  defaultModel: string;
  availableModels: string[];
  voiceSettings: {
    encoding: string;
    sampleRate: number;
  };
  lastVerified?: Date | null;
  status?: 'unverified' | 'verified' | 'failed';
  lastError?: string;
}

export interface TTSConfig {
  provider: 'elevenlabs' | 'deepgram' | 'openai' | 'google' | 'aws';
  primaryProvider: string;
  fallbackProviders: string[];
  autoFallback: boolean;
  deepgramTTS?: DeepgramTTSConfig;
}

// Update Configuration Interface
export interface UpdatedConfig {
  twilioConfig?: Partial<TwilioConfig>;
  elevenLabsConfig?: Partial<ElevenLabsConfig>;
  llmConfig?: {
    providers?: UpdateLLMProvider[];
    defaultProvider?: string;
    defaultModel?: string;
    temperature?: number;
    maxTokens?: number;
  };
  generalSettings?: Partial<GeneralSettings>;
  complianceSettings?: Partial<ComplianceSettings>;
  webhookConfig?: Partial<WebhookConfig>;
  voiceAIConfig?: Partial<VoiceAIConfig>;
  deepgramConfig?: Partial<DeepgramConfig>;
  ttsConfig?: Partial<TTSConfig>;
}

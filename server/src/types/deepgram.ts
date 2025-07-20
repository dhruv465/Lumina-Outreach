/**
 * Enhanced Deepgram configuration types for model compatibility
 */

export type DeepgramAccountTier = 'free' | 'basic' | 'premium';

export type DeepgramConfigStatus = 'unverified' | 'verified' | 'failed' | 'degraded';

export interface ModelCompatibilityStatus {
  isCompatible: boolean;
  lastTested: Date;
  error?: string;
}

export interface EnhancedDeepgramConfig {
  apiKey: string;
  isEnabled: boolean;
  
  // Model configuration with fallback support
  primaryModel: string;
  fallbackModels: string[];
  autoFallback: boolean;
  
  // Account information
  accountTier?: DeepgramAccountTier;
  availableModels?: string[];
  lastModelValidation?: Date | null;
  
  // Validation status
  lastVerified?: Date | null;
  status?: DeepgramConfigStatus;
  lastError?: string;
  
  // Performance settings
  tier: string; // Kept for backward compatibility
  retryAttempts: number;
  timeoutMs: number;
  
  // Model compatibility tracking
  modelCompatibilityStatus?: Map<string, ModelCompatibilityStatus>;
}

export interface DeepgramModelInfo {
  name: string;
  tier: DeepgramAccountTier;
  features: string[];
  useCases: string[];
  languages: string[];
  deprecated?: boolean;
  replacedBy?: string;
}

export interface DeepgramModelRegistry {
  models: { [key: string]: DeepgramModelInfo };
}

export interface ModelValidationResult {
  isValid: boolean;
  model: string;
  tier: DeepgramAccountTier;
  error?: string;
  suggestedAlternatives: string[];
}

export interface ModelPreferences {
  preferredModels: string[];
  useCase: 'general' | 'meeting' | 'phone' | 'conversational' | 'medical' | 'finance';
  language: string;
  realtime: boolean;
}

export interface AccountCapabilities {
  tier: DeepgramAccountTier;
  availableModels: string[];
  features: {
    realtime: boolean;
    batch: boolean;
    streaming: boolean;
  };
  limits: {
    requestsPerMinute: number;
    hoursPerMonth: number;
  };
}

export enum DeepgramErrorType {
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  INVALID_MODEL = 'INVALID_MODEL',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR'
}

export interface RecoveryStrategy {
  type: 'fallback_model' | 'retry' | 'degrade_service' | 'fail';
  parameters: any;
  maxAttempts: number;
}

export interface ValidationIssue {
  type: 'error' | 'warning';
  field: string;
  message: string;
  suggestedFix: string;
}

export interface ConfigRecommendation {
  field: string;
  currentValue: any;
  recommendedValue: any;
  reason: string;
}

export interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  recommendations: ConfigRecommendation[];
}

/**
 * Default model hierarchy for fallback logic
 */
export const DEFAULT_MODEL_HIERARCHY: { [key: string]: string[] } = {
  // Premium models fallback to standard then base
  'nova-2': ['nova', 'base'],
  'nova-2-general': ['nova-general', 'nova', 'base-general', 'base'],
  'nova-2-meeting': ['nova-meeting', 'nova', 'base'],
  'nova-2-phonecall': ['nova-phonecall', 'nova', 'base'],
  'nova-2-voicemail': ['nova-voicemail', 'nova', 'base'],
  'nova-2-finance': ['nova-finance', 'nova', 'base'],
  'nova-2-conversationalai': ['nova-conversationalai', 'nova', 'base'],
  'nova-2-video': ['nova-video', 'nova', 'base'],
  'nova-2-medical': ['nova-medical', 'nova', 'base'],
  'nova-2-drivethru': ['nova-drivethru', 'nova', 'base'],
  'nova-2-automotive': ['nova-automotive', 'nova', 'base'],
  
  // Standard models fallback to base
  'nova': ['base'],
  'nova-general': ['nova', 'base-general', 'base'],
  'nova-meeting': ['nova', 'base'],
  'nova-phonecall': ['nova', 'base'],
  'nova-voicemail': ['nova', 'base'],
  'nova-finance': ['nova', 'base'],
  'nova-conversationalai': ['nova', 'base'],
  'nova-video': ['nova', 'base'],
  'nova-medical': ['nova', 'base'],
  'nova-drivethru': ['nova', 'base'],
  'nova-automotive': ['nova', 'base'],
  
  // Base models have no fallback (they are the fallback)
  'base': [],
  'base-general': ['base'],
  
  // Legacy models
  'enhanced': ['base'],
  'general': ['base']
};

/**
 * Model registry with tier information
 */
export const DEEPGRAM_MODEL_REGISTRY: DeepgramModelRegistry = {
  models: {
    // Premium models (Nova-2 series)
    'nova-2': {
      name: 'Nova-2',
      tier: 'premium',
      features: ['streaming', 'batch', 'realtime'],
      useCases: ['general', 'meeting', 'phone'],
      languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'hi', 'ja', 'ko', 'zh']
    },
    'nova-2-general': {
      name: 'Nova-2 General',
      tier: 'premium',
      features: ['streaming', 'batch'],
      useCases: ['general'],
      languages: ['en']
    },
    'nova-2-meeting': {
      name: 'Nova-2 Meeting',
      tier: 'premium',
      features: ['streaming', 'batch'],
      useCases: ['meeting'],
      languages: ['en']
    },
    'nova-2-phonecall': {
      name: 'Nova-2 Phone Call',
      tier: 'premium',
      features: ['streaming', 'realtime'],
      useCases: ['phone'],
      languages: ['en']
    },
    'nova-2-conversationalai': {
      name: 'Nova-2 Conversational AI',
      tier: 'premium',
      features: ['streaming', 'realtime'],
      useCases: ['conversational'],
      languages: ['en']
    },
    
    // Standard models (Nova series)
    'nova': {
      name: 'Nova',
      tier: 'basic',
      features: ['streaming', 'batch'],
      useCases: ['general', 'meeting', 'phone'],
      languages: ['en', 'es', 'fr', 'de', 'it', 'pt', 'nl', 'hi', 'ja', 'ko', 'zh']
    },
    'nova-general': {
      name: 'Nova General',
      tier: 'basic',
      features: ['streaming', 'batch'],
      useCases: ['general'],
      languages: ['en']
    },
    'nova-meeting': {
      name: 'Nova Meeting',
      tier: 'basic',
      features: ['streaming', 'batch'],
      useCases: ['meeting'],
      languages: ['en']
    },
    'nova-phonecall': {
      name: 'Nova Phone Call',
      tier: 'basic',
      features: ['streaming'],
      useCases: ['phone'],
      languages: ['en']
    },
    
    // Base models (Free tier)
    'base': {
      name: 'Base',
      tier: 'free',
      features: ['streaming', 'batch'],
      useCases: ['general'],
      languages: ['en']
    },
    'base-general': {
      name: 'Base General',
      tier: 'free',
      features: ['streaming', 'batch'],
      useCases: ['general'],
      languages: ['en']
    }
  }
};
import mongoose from 'mongoose';

export interface IConfiguration extends mongoose.Document {
  twilioConfig: {
    accountSid: string;
    authToken: string;
    phoneNumbers: string[];
    isEnabled: boolean;
    lastVerified?: Date | null;
    status?: 'unverified' | 'verified' | 'failed';
  };
  elevenLabsConfig: {
    apiKey: string;
    selectedVoiceId?: string;
    availableVoices: {
      voiceId: string;
      name: string;
      previewUrl: string;
    }[];
    isEnabled: boolean;
    voiceSpeed: number;
    voiceStability: number;
    voiceClarity: number;
    lastVerified?: Date | null;
    status?: 'unverified' | 'verified' | 'failed';
    lastError?: string;
    unusualActivityDetected?: boolean;
    quotaInfo?: {
      tier: string;
      charactersUsed: number;
      characterLimit: number;
      percentUsed: number;
      resetDate?: Date;
      status: string;
    };
    useFlashModel?: boolean; // Whether to use the Flash v2.5 model
  };
  ragConfig?: {
    embeddingModel: string;
    embeddingProvider: string;
    embeddingApiKey?: string;
    chunkSize: number;
    chunkOverlap: number;
    similarityThreshold: number;
    maxResults: number;
    isEnabled: boolean;
    lastVerified?: Date | null;
    status?: 'unverified' | 'verified' | 'failed';
  };
  deepgramConfig: {
    apiKey: string;
    isEnabled: boolean;
    
    // Model configuration with fallback support
    primaryModel: string; // Primary model to use (e.g., 'nova-2')
    fallbackModels: string[]; // Array of fallback models in order of preference
    autoFallback: boolean; // Whether to automatically fallback on model errors
    
    // Account information
    accountTier?: 'free' | 'basic' | 'premium';
    availableModels?: string[]; // Models available for this account
    lastModelValidation?: Date | null;
    
    // Validation status
    lastVerified?: Date | null;
    status?: 'unverified' | 'verified' | 'failed' | 'degraded';
    lastError?: string;
    
    // Performance settings
    tier: string; // 'enhanced' by default - kept for backward compatibility
    retryAttempts: number; // Number of retry attempts for failed requests
    timeoutMs: number; // Request timeout in milliseconds
    
    // First-time setup tracking
    firstTimeSetupCompleted?: boolean;
    firstTimeSetupDate?: Date | null;
    
    // Model compatibility tracking
    modelCompatibilityStatus?: {
      [modelName: string]: {
        isCompatible: boolean;
        lastTested: Date;
        error?: string;
      };
    };
  };
  ttsConfig: {
    provider: 'elevenlabs' | 'deepgram' | 'openai' | 'google' | 'aws';
    primaryProvider: string;
    fallbackProviders: string[];
    autoFallback: boolean;
    deepgramTTS?: {
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
    };
  };
  voiceAIConfig: {
    personalities: {
      id: string;
      name: string;
      description: string;
      voiceId: string;
      personality: string;
      style: string;
      languageSupport: string[];
      settings: {
        stability: number;
        similarityBoost: number;
        style: number;
        useSpeakerBoost: boolean;
      };
    }[];
    bilingualSupport: {
      enabled: boolean;
      primaryLanguage: string;
      secondaryLanguage: string;
      autoLanguageDetection: boolean;
    };
    conversationFlow: {
      personalityAdaptation: boolean;
      contextAwareness: boolean;
      naturalPauses: boolean;
    };
    conversationalAI: {
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
    };
  };
  llmConfig: {
    providers: {
      name: string;
      apiKey: string;
      availableModels: string[];
      isEnabled: boolean;
      lastVerified?: Date | null;
      status?: 'unverified' | 'verified' | 'failed';
      useRealtimeAPI?: boolean; // Whether to use the OpenAI Realtime API for ultra-low latency
      defaultModel?: string; // Default model for the provider
      baseUrl?: string; // Optional base URL for the provider
      organization?: string; // Optional organization ID for OpenAI
    }[];
    defaultProvider: string;
    defaultModel: string;
    llmService?: any; // Runtime instance of LLMService for sharing
    temperature: number;
    maxTokens: number;
  };
  generalSettings: {
    defaultLanguage: string;
    supportedLanguages: string[];
    maxConcurrentCalls: number;
    callRetryAttempts: number;
    callRetryDelay: number;
    maxCallDuration: number;
    defaultSystemPrompt: string;
    defaultTimeZone: string;
    workingHours: {
      start: string;
      end: string;
      timeZone: string;
      daysOfWeek: string[];
    };
  };
  complianceSettings: {
    recordCalls: boolean;
    callIntroduction: string;
    maxCallsPerLeadPerDay: number;
    callBlackoutPeriod: {
      start: string;
      end: string;
    };
  };
  webhookConfig: {
    secret: string;
    lastVerified?: Date | null;
    status?: 'unverified' | 'verified' | 'failed';
  };
  configurationVersion?: number;
  lastSystemUpdate?: Date;
  updatedBy: mongoose.Schema.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  
  // Methods
  getMaskedConfig?: () => any;
  deleteApiKey?: (provider: string, name?: string | null) => boolean;
  updateApiKeyStatus?: (provider: string, name: string | null, status: 'unverified' | 'verified' | 'failed', details?: any) => boolean;

  // New fields for error messages, closing scripts, and intent detection
  errorMessages?: {
    generalError?: string;
    aiResponseError?: string;
    speechRecognitionError?: string;
    noCallFound?: string;
    configurationError?: string;
    serverError?: string;
    technicalIssue?: string;
    noSpeechDetected?: string;
    callDisconnected?: string;
  };
  closingScripts?: {
    default?: string;
    consentReceived?: string;
    withObjections?: string;
  };
  intentDetection?: {
    closingPhrases?: string[];
    objectionPhrases?: string[];
  };
  callResponses?: {
    goodbye?: string;
    thankYou?: string;
    speechPrompt?: string;
  };
}

const ConfigurationSchema = new mongoose.Schema(
  {
    twilioConfig: {
      accountSid: {
        type: String,
        required: false,
        default: '',
      },
      authToken: {
        type: String,
        required: false,
        default: '',
      },
      phoneNumbers: {
        type: [String],
        default: [],
      },
      isEnabled: {
        type: Boolean,
        default: false,
      },
      lastVerified: {
        type: Date,
        default: null,
      },
      status: {
        type: String,
        enum: ['unverified', 'verified', 'failed'],
        default: 'unverified',
      },
    },
    elevenLabsConfig: {
      apiKey: {
        type: String,
        required: false,
        default: '',
      },
      selectedVoiceId: {
        type: String,
        required: false,
        default: '',
      },
      availableVoices: [
        {
          voiceId: {
            type: String,
            required: true,
          },
          name: {
            type: String,
            required: true,
          },
          previewUrl: {
            type: String,
          },
        },
      ],
      isEnabled: {
        type: Boolean,
        default: false,
      },
      voiceSpeed: {
        type: Number,
        default: 1.0,
        min: 0.25,
        max: 4.0,
      },
      voiceStability: {
        type: Number,
        default: 0.8,
        min: 0.0,
        max: 1.0,
      },
      voiceClarity: {
        type: Number,
        default: 0.9,
        min: 0.0,
        max: 1.0,
      },
      lastVerified: {
        type: Date,
        default: null,
      },
      status: {
        type: String,
        enum: ['unverified', 'verified', 'failed'],
        default: 'unverified',
      },
      lastError: {
        type: String,
      },
      unusualActivityDetected: {
        type: Boolean,
        default: false,
      },
      quotaInfo: {
        tier: {
          type: String,
        },
        charactersUsed: {
          type: Number,
        },
        characterLimit: {
          type: Number,
        },
        percentUsed: {
          type: Number,
        },
        resetDate: {
          type: Date,
        },
        status: {
          type: String,
        },
      },
      useFlashModel: {
        type: Boolean,
        default: true,
      },
    },
    deepgramConfig: {
      apiKey: {
        type: String,
        required: false,
        default: '',
      },
      isEnabled: {
        type: Boolean,
        default: false,
      },
      
      // Model configuration with fallback support
      primaryModel: {
        type: String,
        default: 'nova-2',
      },
      fallbackModels: {
        type: [String],
        default: ['nova', 'base'],
      },
      autoFallback: {
        type: Boolean,
        default: true,
      },
      
      // Account information
      accountTier: {
        type: String,
        enum: ['free', 'basic', 'premium'],
        required: false,
      },
      availableModels: {
        type: [String],
        default: [],
      },
      lastModelValidation: {
        type: Date,
        default: null,
      },
      
      // Validation status
      lastVerified: {
        type: Date,
        default: null,
      },
      status: {
        type: String,
        enum: ['unverified', 'verified', 'failed', 'degraded'],
        default: 'unverified',
      },
      lastError: {
        type: String,
      },
      
      // Performance settings
      tier: {
        type: String,
        default: 'enhanced',
      },
      retryAttempts: {
        type: Number,
        default: 3,
        min: 1,
        max: 10,
      },
      timeoutMs: {
        type: Number,
        default: 30000,
        min: 5000,
        max: 120000,
      },
      
      // First-time setup tracking
      firstTimeSetupCompleted: {
        type: Boolean,
        default: false,
      },
      firstTimeSetupDate: {
        type: Date,
        default: null,
      },
      
      // Model compatibility tracking
      modelCompatibilityStatus: {
        type: Map,
        of: {
          isCompatible: {
            type: Boolean,
            required: true,
          },
          lastTested: {
            type: Date,
            required: true,
          },
          error: {
            type: String,
          },
        },
        default: new Map(),
      },
    },
    ttsConfig: {
      provider: {
        type: String,
        enum: ['elevenlabs', 'deepgram', 'openai', 'google', 'aws'],
        default: 'elevenlabs',
      },
      primaryProvider: {
        type: String,
        default: 'elevenlabs',
      },
      fallbackProviders: {
        type: [String],
        default: ['deepgram'],
      },
      autoFallback: {
        type: Boolean,
        default: true,
      },
      deepgramTTS: {
        apiKey: {
          type: String,
          required: false,
          default: '',
        },
        isEnabled: {
          type: Boolean,
          default: false,
        },
        defaultModel: {
          type: String,
          default: 'aura-2-thalia-en',
        },
        availableModels: {
          type: [String],
          default: [
            'aura-2-thalia-en',
            'aura-asteria-en',
            'aura-luna-en',
            'aura-stella-en',
            'aura-athena-en',
            'aura-hera-en',
            'aura-orion-en',
            'aura-arcas-en',
            'aura-perseus-en',
            'aura-angus-en',
            'aura-orpheus-en',
            'aura-helios-en',
            'aura-zeus-en'
          ],
        },
        voiceSettings: {
          encoding: {
            type: String,
            default: 'mp3',
          },
          sampleRate: {
            type: Number,
            default: 24000,
          },
        },
        lastVerified: {
          type: Date,
          default: null,
        },
        status: {
          type: String,
          enum: ['unverified', 'verified', 'failed'],
          default: 'unverified',
        },
        lastError: {
          type: String,
        },
      },
    },
    ragConfig: {
      embeddingModel: {
        type: String,
        default: 'text-embedding-ada-002',
      },
      embeddingProvider: {
        type: String,
        default: 'openai',
      },
      embeddingApiKey: {
        type: String,
        default: '',
      },
      chunkSize: {
        type: Number,
        default: 1000,
      },
      chunkOverlap: {
        type: Number,
        default: 200,
      },
      similarityThreshold: {
        type: Number,
        default: 0.7,
      },
      maxResults: {
        type: Number,
        default: 5,
      },
      isEnabled: {
        type: Boolean,
        default: false,
      },
      lastVerified: {
        type: Date,
        default: null,
      },
      status: {
        type: String,
        enum: ['unverified', 'verified', 'failed'],
        default: 'unverified',
      },
    },
    voiceAIConfig: {
      personalities: [{
        id: {
          type: String,
          required: true
        },
        name: {
          type: String,
          required: true
        },
        description: {
          type: String,
          default: ''
        },
        voiceId: {
          type: String,
          required: true
        },
        personality: {
          type: String,
          default: 'Professional'
        },
        style: {
          type: String,
          default: 'Conversational'
        },
        languageSupport: {
          type: [String],
          default: ['English']
        },
        settings: {
          stability: {
            type: Number,
            default: 0.8,
            min: 0.0,
            max: 1.0
          },
          similarityBoost: {
            type: Number,
            default: 0.75,
            min: 0.0,
            max: 1.0
          },
          style: {
            type: Number,
            default: 0.3,
            min: 0.0,
            max: 1.0
          },
          useSpeakerBoost: {
            type: Boolean,
            default: true
          }
        }
      }],
      bilingualSupport: {
        enabled: {
          type: Boolean,
          default: false
        },
        primaryLanguage: {
          type: String,
          default: 'English'
        },
        secondaryLanguage: {
          type: String,
          default: 'Hindi'
        },
        autoLanguageDetection: {
          type: Boolean,
          default: true
        }
      },
      conversationFlow: {
        personalityAdaptation: {
          type: Boolean,
          default: true
        },
        contextAwareness: {
          type: Boolean,
          default: true
        },
        naturalPauses: {
          type: Boolean,
          default: true
        }
      },
      conversationalAI: {
        enabled: {
          type: Boolean,
          default: true
        },
        useSDK: {
          type: Boolean,
          default: true
        },
        interruptible: {
          type: Boolean,
          default: true
        },
        adaptiveTone: {
          type: Boolean,
          default: true
        },
        naturalConversationPacing: {
          type: Boolean,
          default: true
        },
        voiceSettings: {
          speed: {
            type: Number,
            default: 1.0,
            min: 0.5,
            max: 2.0
          },
          stability: {
            type: Number,
            default: 0.75,
            min: 0.0,
            max: 1.0
          },
          style: {
            type: Number,
            default: 0.3,
            min: 0.0,
            max: 1.0
          }
        },
        defaultVoiceId: {
          type: String,
          default: ''
        },
        defaultModelId: {
          type: String,
          default: 'eleven_multilingual_v2'
        }
      }
    },
    llmConfig: {
      providers: [
        {
          name: {
            type: String,
            required: true,
          },
          apiKey: {
            type: String,
            required: false,
            default: '',
            set: function(val: string) {
              // This ensures that empty strings are properly saved to the database
              // and not converted to null or ignored
              return val === '' ? '' : val;
            }
          },
          availableModels: {
            type: [String],
            required: true,
          },
          isEnabled: {
            type: Boolean,
            default: true,
          },
          lastVerified: {
            type: Date,
            default: null,
          },
          status: {
            type: String,
            enum: ['unverified', 'verified', 'failed'],
            default: 'unverified',
          },
        },
      ],
      defaultProvider: {
        type: String,
        required: [true, 'Please specify a default LLM provider'],
        default: 'OpenAI',
      },
      defaultModel: {
        type: String,
        required: [true, 'Please specify a default LLM model'],
        default: 'gpt-4o',
      },
      temperature: {
        type: Number,
        min: 0,
        max: 2.0,
        default: 0.7,
      },
      maxTokens: {
        type: Number,
        min: 1,
        max: 32000,
        default: 150,
      },
    },
    generalSettings: {
      defaultLanguage: {
        type: String,
        required: [true, 'Please specify a default language'],
        default: 'English',
      },
      supportedLanguages: {
        type: [String],
        required: [true, 'Please specify supported languages'],
        default: ['English', 'Hindi'],
      },
      maxConcurrentCalls: {
        type: Number,
        default: 10,
        min: 1,
        max: 100,
      },
      callRetryAttempts: {
        type: Number,
        default: 3,
        min: 0,
        max: 10,
      },
      callRetryDelay: {
        type: Number,
        default: 60, // in minutes
        min: 15,
        max: 1440,
      },
      maxCallDuration: {
        type: Number,
        default: 300, // in seconds (5 minutes)
        min: 30,
        max: 3600,
      },
      defaultSystemPrompt: {
        type: String,
        default: 'You are a professional sales representative making cold calls. Be polite, respectful, and helpful.',
      },
      defaultTimeZone: {
        type: String,
        default: 'America/New_York',
      },
      workingHours: {
        start: {
          type: String,
          default: '09:00',
        },
        end: {
          type: String,
          default: '18:00',
        },
        timeZone: {
          type: String,
          default: 'Asia/Kolkata',
        },
        daysOfWeek: {
          type: [String],
          enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
          default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        },
      },
    },
    complianceSettings: {
      recordCalls: {
        type: Boolean,
        default: true,
      },
      maxCallsPerLeadPerDay: {
        type: Number,
        default: 1,
        min: 1,
        max: 5,
      },
      callBlackoutPeriod: {
        start: {
          type: String,
          default: '21:00',
        },
        end: {
          type: String,
          default: '08:00',
        },
      },
    },
    webhookConfig: {
      secret: {
        type: String,
        default: '',
      },
    },
    errorMessages: {
      generalError: {
        type: String,
        required: true, // Must be configured by user - no fallback messages
      },
      aiResponseError: {
        type: String,
        required: true, // Must be configured by user - no fallback messages
      },
      speechRecognitionError: {
        type: String,
        required: true, // Must be configured by user - no fallback messages
      },
      noCallFound: {
        type: String,
        required: true, // Must be configured by user - no fallback messages
      },
      configurationError: {
        type: String,
        required: true, // Must be configured by user - no fallback messages
      },
      serverError: {
        type: String,
        required: true, // Must be configured by user - no fallback messages
      },
      technicalIssue: {
        type: String,
        required: true, // Must be configured by user - no fallback messages
      },
      noSpeechDetected: {
        type: String,
        required: true, // Must be configured by user - no fallback messages
      },
      callDisconnected: {
        type: String,
        required: true, // Must be configured by user - no fallback messages
      },
    },
    closingScripts: {
      default: {
        type: String,
        required: true, // Must be configured by user - no fallback scripts
      },
      consentReceived: {
        type: String,
        required: true, // Must be configured by user - no fallback scripts
      },
      withObjections: {
        type: String,
        required: true, // Must be configured by user - no fallback scripts
      },
    },
    intentDetection: {
      closingPhrases: {
        type: [String],
        required: true, // Must be configured by user - no fallback phrases
      },
      objectionPhrases: {
        type: [String],
        required: true, // Must be configured by user - no fallback phrases
      },
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: false,
    },
  },
  { timestamps: true }
);

// Pre-save hook to ensure empty API keys are properly saved
ConfigurationSchema.pre('save', function(next) {
  try {
    // Ensure empty API keys for LLM providers are saved correctly
    if (this.llmConfig && this.llmConfig.providers) {
      for (let i = 0; i < this.llmConfig.providers.length; i++) {
        // Explicitly check and handle empty API keys
        if (this.llmConfig.providers[i].apiKey === '') {
          // Ensure the field is marked as modified
          this.markModified(`llmConfig.providers.${i}.apiKey`);
        }
      }
    }
    next();
  } catch (err) {
    next(err);
  }
});

const Configuration = mongoose.model<IConfiguration>('Configuration', ConfigurationSchema);

export default Configuration;

import mongoose from 'mongoose';

export interface ICampaign extends mongoose.Document {
  name: string;
  description: string;
  goal: string;
  targetAudience: string;
  script: {
    versions: {
      name: string;
      content: string;
      isActive: boolean;
      performance?: {
        successRate: number;
        avgCallDuration: number;
        conversionRate: number;
      };
    }[];
  };
  openingMessage?: string;
  initialPrompt?: string; // Added initial prompt property
  scriptClosing?: string;
  leadSources: string[];
  status: string;
  startDate: Date;
  endDate?: Date;
  primaryLanguage: string;
  supportedLanguages: string[];
  callTiming: {
    daysOfWeek: string[];
    startTime: string;
    endTime: string;
    timeZone: string;
  };
  llmConfiguration: {
    model: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
  };
  voiceConfiguration: {
    provider: string;
    voiceId: string;
    speed: number;
    pitch: number;
    stability?: number;
    clarity?: number;
    style?: number;
  };
  telephonyProvider: 'twilio' | 'livekit';
  transferPhoneNumber?: string;
  metrics: {
    totalCalls: number;
    connectedCalls: number;
    successfulCalls: number;
    avgCallDuration: number;
    conversionRate: number;
    totalCost?: number;
  };
  budget?: {
    maxCostPerCall: number;
    totalBudget: number;
    isBudgetExceeded: boolean;
  };
  createdBy: mongoose.Schema.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const CampaignSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Please provide a campaign name'],
      trim: true,
      maxlength: [100, 'Name cannot be more than 100 characters'],
    },
    description: {
      type: String,
      required: [true, 'Please provide a campaign description'],
    },
    goal: {
      type: String,
      required: [true, 'Please provide a campaign goal'],
    },
    targetAudience: {
      type: String,
      required: [true, 'Please define the target audience'],
    },
    script: {
      versions: [
        {
          name: {
            type: String,
            required: true,
          },
          content: {
            type: String,
            required: true,
          },
          isActive: {
            type: Boolean,
            default: false,
          },
          performance: {
            successRate: Number,
            avgCallDuration: Number,
            conversionRate: Number,
          },
        },
      ],
    },
    openingMessage: {
      type: String,
      required: false,
      default: '',
    },
    initialPrompt: {
      type: String,
      required: false,
      default: '',
    },
    scriptClosing: {
      type: String,
      required: false,
      default: '',
    },
    leadSources: {
      type: [String],
      required: [true, 'Please specify at least one lead source'],
    },
    status: {
      type: String,
      enum: ['Draft', 'Active', 'Paused', 'Completed'],
      default: 'Draft',
    },
    startDate: {
      type: Date,
      required: [true, 'Please specify a start date'],
    },
    endDate: {
      type: Date,
    },
    primaryLanguage: {
      type: String,
      required: [true, 'Please specify the primary language'],
      default: 'English',
    },
    supportedLanguages: {
      type: [String],
      default: ['English'],
    },
    callTiming: {
      daysOfWeek: {
        type: [String],
        enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
        default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
      },
      startTime: {
        type: String,
        default: '09:00',
      },
      endTime: {
        type: String,
        default: '17:00',
      },
      timeZone: {
        type: String,
        default: 'Asia/Kolkata',
      },
    },
    llmConfiguration: {
      model: {
        type: String,
        required: [true, 'Please specify an LLM model'],
        default: 'gpt-4o',
      },
      systemPrompt: {
        type: String,
        required: [true, 'Please provide a system prompt'],
      },
      temperature: {
        type: Number,
        default: 0.7,
        min: 0,
        max: 2,
      },
      maxTokens: {
        type: Number,
        default: 500,
      },
    },
    voiceConfiguration: {
      provider: {
        type: String,
        default: 'elevenlabs',
        enum: ['elevenlabs', 'deepgram', 'openai', 'google', 'aws'],
      },
      voiceId: {
        type: String,
        required: [true, 'Please specify a voice ID'],
      },
      speed: {
        type: Number,
        default: 1,
        min: 0.5,
        max: 2,
      },
      pitch: {
        type: Number,
        default: 1,
        min: 0.5,
        max: 2,
      },
      stability: {
        type: Number,
        default: 0.8,
        min: 0,
        max: 1,
      },
      clarity: {
        type: Number,
        default: 0.8,
        min: 0,
        max: 1,
      },
      style: {
        type: Number,
        default: 0.3,
        min: 0,
        max: 1,
      },
    },
    telephonyProvider: {
      type: String,
      enum: ['twilio', 'livekit'],
      default: 'livekit',
    },
    transferPhoneNumber: {
      type: String,
      default: '',
    },
    metrics: {
      totalCalls: {
        type: Number,
        default: 0,
      },
      connectedCalls: {
        type: Number,
        default: 0,
      },
      successfulCalls: {
        type: Number,
        default: 0,
      },
      avgCallDuration: {
        type: Number,
        default: 0,
      },
      conversionRate: {
        type: Number,
        default: 0,
      },
      totalCost: {
        type: Number,
        default: 0,
      },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

// Validate voice configuration before saving
CampaignSchema.pre('save', async function (next) {
  try {
    if (this.isModified('voiceConfiguration.voiceId')) {
      // Import directly to avoid circular dependencies
      const { EnhancedVoiceAIService } = await import('../services/enhancedVoiceAIService');
      // Get valid voice ID (will fallback to default if the voice ID is invalid)
      this.voiceConfiguration.voiceId = await EnhancedVoiceAIService.getValidVoiceId(this.voiceConfiguration.voiceId);
    }
    next();
  } catch (error) {
    next(error);
  }
});

// Index for faster queries
CampaignSchema.index({ status: 1 });
CampaignSchema.index({ createdBy: 1 });
CampaignSchema.index({ startDate: 1 });
CampaignSchema.index({ 'leadSources': 1 });

const Campaign = mongoose.model<ICampaign>('Campaign', CampaignSchema);

export default Campaign;

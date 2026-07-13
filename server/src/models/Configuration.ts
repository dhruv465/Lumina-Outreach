import mongoose from 'mongoose';
import { encryptSecret, decryptSecret, isEncrypted, maskSecret } from '../utils/secretCipher';

export type ProviderName = 'openai' | 'anthropic' | 'google';
export type VerifyStatus = 'unverified' | 'verified' | 'failed';

export interface IProviderModel {
  name: string;
  value: string;
}

export interface ILlmProvider {
  name: ProviderName;
  apiKey: string;
  status: VerifyStatus;
  lastVerified?: Date | null;
  lastError?: string;
  availableModels?: IProviderModel[];
}

export interface IConfiguration extends mongoose.Document {
  ownerId: mongoose.Types.ObjectId;
  deepgramConfig: {
    apiKey: string;
    sttModel: string;
    ttsVoice: string;
    isEnabled: boolean;
    status: VerifyStatus;
    lastVerified?: Date | null;
    lastError?: string;
  };
  llmConfig: {
    providers: ILlmProvider[];
    defaultProvider: ProviderName;
    defaultModel: string;
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
    callIntroduction?: string;
    maxCallsPerLeadPerDay: number;
    callBlackoutPeriod: { start: string; end: string };
  };
  webhookConfig: { secret: string; lastVerified?: Date | null; status?: VerifyStatus };
  errorMessages?: Record<string, string>;
  closingScripts?: Record<string, string>;
  intentDetection?: { closingPhrases?: string[]; objectionPhrases?: string[] };
  callResponses?: Record<string, string>;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  getMaskedConfig(): any;
}

const providerModelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    value: { type: String, required: true },
  },
  { _id: false },
);

const providerSchema = new mongoose.Schema(
  {
    name: { type: String, enum: ['openai', 'anthropic', 'google'], required: true },
    apiKey: { type: String, default: '' },
    status: { type: String, enum: ['unverified', 'verified', 'failed'], default: 'unverified' },
    lastVerified: { type: Date, default: null },
    lastError: { type: String, default: '' },
    // Chat models fetched from the provider with the user's own key at verify
    // time; the UI model picker prefers this list over the static catalog.
    availableModels: { type: [providerModelSchema], default: [] },
  },
  { _id: false },
);

const defaultProviders = () => [
  { name: 'openai', apiKey: '', status: 'unverified' },
  { name: 'anthropic', apiKey: '', status: 'unverified' },
  { name: 'google', apiKey: '', status: 'unverified' },
];

const ConfigurationSchema = new mongoose.Schema(
  {
    ownerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
      index: true,
    },
    deepgramConfig: {
      apiKey: { type: String, default: '' },
      sttModel: { type: String, default: 'nova-3' },
      ttsVoice: { type: String, default: 'aura-2-thalia-en' },
      isEnabled: { type: Boolean, default: true },
      status: { type: String, enum: ['unverified', 'verified', 'failed'], default: 'unverified' },
      lastVerified: { type: Date, default: null },
      lastError: { type: String, default: '' },
    },
    llmConfig: {
      providers: { type: [providerSchema], default: defaultProviders },
      defaultProvider: {
        type: String,
        enum: ['openai', 'anthropic', 'google'],
        default: 'openai',
      },
      defaultModel: { type: String, default: 'gpt-4.1' },
      temperature: { type: Number, min: 0, max: 2.0, default: 0.7 },
      maxTokens: { type: Number, min: 1, max: 32000, default: 150 },
    },
    generalSettings: {
      defaultLanguage: { type: String, default: 'English' },
      supportedLanguages: { type: [String], default: ['English', 'Hindi'] },
      maxConcurrentCalls: { type: Number, default: 10, min: 1, max: 100 },
      callRetryAttempts: { type: Number, default: 3, min: 0, max: 10 },
      callRetryDelay: { type: Number, default: 60, min: 15, max: 1440 },
      maxCallDuration: { type: Number, default: 300, min: 30, max: 3600 },
      defaultSystemPrompt: {
        type: String,
        default:
          'You are a professional sales representative making cold calls. Be polite, respectful, and helpful.',
      },
      defaultTimeZone: { type: String, default: 'America/New_York' },
      workingHours: {
        start: { type: String, default: '09:00' },
        end: { type: String, default: '18:00' },
        timeZone: { type: String, default: 'Asia/Kolkata' },
        daysOfWeek: {
          type: [String],
          enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
          default: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
        },
      },
    },
    complianceSettings: {
      recordCalls: { type: Boolean, default: true },
      callIntroduction: { type: String, default: '' },
      maxCallsPerLeadPerDay: { type: Number, default: 1, min: 1, max: 5 },
      callBlackoutPeriod: {
        start: { type: String, default: '21:00' },
        end: { type: String, default: '08:00' },
      },
    },
    webhookConfig: { secret: { type: String, default: '' } },
    errorMessages: { type: mongoose.Schema.Types.Mixed, default: {} },
    closingScripts: { type: mongoose.Schema.Types.Mixed, default: {} },
    intentDetection: {
      closingPhrases: { type: [String], default: [] },
      objectionPhrases: { type: [String], default: [] },
    },
    callResponses: { type: mongoose.Schema.Types.Mixed, default: {} },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: false },
  },
  { timestamps: true },
);

// Minimal shape encryptConfigKeys needs — kept loose (all-optional) so both
// the live mongoose document (whose subdocument typing mongoose widens with
// its own Document/FlatRecord wrappers) and plain test fixtures satisfy it.
interface EncryptableConfig {
  deepgramConfig?: { apiKey?: string } | null;
  llmConfig?: { providers?: Array<{ apiKey?: string }> } | null;
}

// Encrypt any plaintext API keys on the document in place.
// Extracted from the pre('save') hook so it can be unit-tested directly
// without depending on mongoose's internal middleware invocation shape.
export function encryptConfigKeys(doc: EncryptableConfig): void {
  const dg = doc.deepgramConfig;
  if (dg?.apiKey && !isEncrypted(dg.apiKey)) dg.apiKey = encryptSecret(dg.apiKey);
  for (const p of doc.llmConfig?.providers ?? []) {
    if (p.apiKey && !isEncrypted(p.apiKey)) p.apiKey = encryptSecret(p.apiKey);
  }
}

// Encrypt any plaintext API keys before persisting.
ConfigurationSchema.pre('save', function (next) {
  try {
    encryptConfigKeys(this);
    next();
  } catch (err) {
    next(err as Error);
  }
});

ConfigurationSchema.methods.getMaskedConfig = function () {
  const obj = this.toObject();
  if (obj.deepgramConfig) {
    obj.deepgramConfig.apiKey = maskSecret(decryptSecret(obj.deepgramConfig.apiKey || ''));
  }
  for (const p of obj.llmConfig?.providers ?? []) {
    p.apiKey = maskSecret(decryptSecret(p.apiKey || ''));
  }
  return obj;
};

const Configuration = mongoose.model<IConfiguration>('Configuration', ConfigurationSchema);
export default Configuration;

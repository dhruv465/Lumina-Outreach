import mongoose from 'mongoose';

export interface ICall extends mongoose.Document {
  leadId: mongoose.Types.ObjectId;
  campaignId: mongoose.Types.ObjectId;
  phoneNumber: string;
  status: 'queued' | 'dialing' | 'in-progress' | 'completed' | 'failed' | 'no-answer' | 'busy' | 'voicemail' | 'scheduled' | 'pending';
  priority: 'low' | 'medium' | 'high';
  scheduledAt: Date;
  twilioSid?: string;
  startTime?: Date;
  endTime?: Date;
  duration?: number;
  recordingUrl?: string;
  transcript?: string;
  personalityId?: string;
  abTestVariantId?: string;
  maxRetries: number;
  retryCount: number;
  callbackUrl?: string; // Make this optional since it's not required in schema
  callback?: {
    scheduled: boolean;
    dateTime: Date;
    notes: string;
  };
  createdAt: Date;
  updatedAt: Date;
  recordCall: boolean;
  complianceScriptId?: string;
  callReasons?: string[];
  outcome?: string;
  notes?: string;
  failureCode?: string;
  providerData?: {
    provider: 'twilio' | 'nexmo' | 'plivo' | 'livekit';
    callId: string;
    cost?: number;
    diagnostics?: Record<string, any>;
  };
  complianceChecks?: {
    disclosureProvided: boolean;
    withinPermittedHours: boolean;
    consentReceived: boolean;
    doNotCallChecked: boolean;
    recordingDisclosureProvided?: boolean;
    timeZone?: string;
  };
  networkInfo?: {
    callQuality: number;
    latency: number;
    packetLoss: number;
    jitter: number;
    codec: string;
  };
  customerInteraction?: {
    totalSpeakingTime: number;
    speakingTimeRatio: number; // AI speaking time / customer speaking time
    primaryEmotion?: string; // Added missing property
    interruptions: Array<{
      timestamp: Date;
      duration: number;
      interrupter: 'ai' | 'customer';
    }>;
    silencePeriods: Array<{
      timestamp: Date;
      duration: number;
    }>;
    engagementScore: number;
  };
  metrics?: {
    duration: number;
    outcome: string;
    conversationMetrics: {
      customerEngagement: number;
      emotionalTone: string[];
      objectionCount: number;
      interruptionCount: number;
      conversionIndicators: string[];
    };
    qualityScore: number;
    complianceScore?: number;
    interruptions?: number; // Added missing property
    scriptAdherence?: number; // Added missing property
    intentDetection?: {
      primaryIntent: string;
      confidence: number;
      secondaryIntents: Array<{intent: string, confidence: number}>;
    };
    callRecordingUrl?: string;
    transcriptionAnalysis?: {
      keyPhrases: string[];
      sentimentBySegment: Array<{segment: string, sentiment: number}>;
      followUpRecommendations: string[];
    };
    emotionalJourney?: Array<{
      timestamp: Date;
      emotion: string;
      confidence: number;
      trigger?: string;
    }>;
    conversionProbability?: number;
    followUpRecommendation?: 'immediate' | 'next-day' | '3-day' | 'week' | 'none';
    agentPerformance?: {
      scriptAdherence: number;
      objectionHandling: number;
      personalityAlignment: number;
      overallScore: number;
    };
  };
  metadata?: {
    transcription?: {
      connectionId?: string;
      startTime?: number;
      endTime?: number;
      provider?: string;
      processingLatency?: number;
    };
    custom?: Record<string, any>;
  };
  cost?: {
    llm: number;
    stt: number;
    tts: number;
    telephony: number;
    total: number;
  };
  conversationLog?: Array<{
    role: string;
    content: string;
    timestamp: Date;
    emotion?: string;
    intent?: string;
    confidence?: number;
    processingTime?: number;
  }>;
  followUpTasks?: Array<{
    type: 'email' | 'call' | 'sms' | 'task';
    scheduledFor: Date;
    completed: boolean;
    notes?: string;
    priority: 'low' | 'medium' | 'high';
  }>;
  webhookEvents?: Array<{
    event: string;
    timestamp: Date;
    payload: Record<string, any>;
    status: 'sent' | 'failed' | 'received';
  }>;
}

const CallSchema = new mongoose.Schema({
  leadId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Lead',
    required: true, 
    index: true 
  },
  campaignId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Campaign',
    required: true, 
    index: true 
  },
  phoneNumber: { type: String, required: true },
  status: { 
    type: String, 
    enum: ['queued', 'dialing', 'in-progress', 'completed', 'failed', 'no-answer', 'busy', 'voicemail', 'scheduled', 'pending'],
    default: 'queued',
    index: true
  },
  priority: { 
    type: String, 
    enum: ['low', 'medium', 'high'],
    default: 'medium' 
  },
  scheduledAt: { type: Date, default: Date.now, index: true },
  twilioSid: String,
  startTime: Date,
  endTime: Date,
  duration: Number,
  recordingUrl: String,
  transcript: String,
  personalityId: String,
  abTestVariantId: String,
  maxRetries: { type: Number, default: 3 },
  retryCount: { type: Number, default: 0 },
  callbackUrl: String,
  callback: {
    scheduled: Boolean,
    dateTime: Date,
    notes: String
  },
  recordCall: { type: Boolean, default: false },
  complianceScriptId: String,
  callReasons: [String],
  outcome: String,
  notes: String,
  failureCode: String,
  providerData: {
    provider: { 
      type: String, 
      enum: ['twilio', 'nexmo', 'plivo', 'livekit']
    },
    callId: String,
    cost: Number,
    diagnostics: mongoose.Schema.Types.Mixed
  },
  complianceChecks: {
    disclosureProvided: { type: Boolean, default: false },
    withinPermittedHours: { type: Boolean, default: true },
    consentReceived: { type: Boolean, default: false },
    doNotCallChecked: { type: Boolean, default: false },
    recordingDisclosureProvided: Boolean,
    timeZone: String
  },
  networkInfo: {
    callQuality: Number,
    latency: Number,
    packetLoss: Number,
    jitter: Number,
    codec: String
  },
  customerInteraction: {
    totalSpeakingTime: Number,
    speakingTimeRatio: Number,
    primaryEmotion: String,
    interruptions: [{
      timestamp: Date,
      duration: Number,
      interrupter: { 
        type: String, 
        enum: ['ai', 'customer'] 
      }
    }],
    silencePeriods: [{
      timestamp: Date,
      duration: Number
    }],
    engagementScore: Number
  },
  metrics: {
    duration: Number,
    outcome: String,
    conversationMetrics: {
      customerEngagement: Number,
      emotionalTone: [String],
      objectionCount: Number,
      interruptionCount: Number,
      conversionIndicators: [String]
    },
    qualityScore: Number,
    complianceScore: Number,
    interruptions: Number,
    scriptAdherence: Number,
    intentDetection: {
      primaryIntent: String,
      confidence: Number,
      secondaryIntents: [{
        intent: String,
        confidence: Number
      }]
    },
    callRecordingUrl: String,
    transcriptionAnalysis: {
      keyPhrases: [String],
      sentimentBySegment: [{
        segment: String,
        sentiment: Number
      }],
      followUpRecommendations: [String]
    },
    emotionalJourney: [{
      timestamp: Date,
      emotion: String,
      confidence: Number,
      trigger: String
    }],
    conversionProbability: Number,
    followUpRecommendation: { 
      type: String, 
      enum: ['immediate', 'next-day', '3-day', 'week', 'none'] 
    },
    agentPerformance: {
      scriptAdherence: Number,
      objectionHandling: Number,
      personalityAlignment: Number,
      overallScore: Number
    }
  },
  metadata: {
    transcription: {
      connectionId: String,
      startTime: Number,
      endTime: Number,
      provider: String,
      processingLatency: Number
    },
    custom: mongoose.Schema.Types.Mixed
  },
  cost: {
    llm: { type: Number, default: 0 },
    stt: { type: Number, default: 0 },
    tts: { type: Number, default: 0 },
    telephony: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },
  conversationLog: [{
    role: { type: String, required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    emotion: String,
    intent: String,
    confidence: Number,
    processingTime: Number
  }],
  followUpTasks: [{
    type: { 
      type: String, 
      enum: ['email', 'call', 'sms', 'task'],
      required: true 
    },
    scheduledFor: { type: Date, required: true },
    completed: { type: Boolean, default: false },
    notes: String,
    priority: { 
      type: String, 
      enum: ['low', 'medium', 'high'],
      default: 'medium' 
    }
  }],
  webhookEvents: [{
    event: String,
    timestamp: { type: Date, default: Date.now },
    payload: mongoose.Schema.Types.Mixed,
    status: { 
      type: String, 
      enum: ['sent', 'failed', 'received'],
      default: 'sent' 
    }
  }]
}, { 
  timestamps: true // This will automatically handle createdAt and updatedAt
});

// Create compound indexes for efficient queries
CallSchema.index({ campaignId: 1, status: 1 });
CallSchema.index({ phoneNumber: 1, createdAt: -1 });
CallSchema.index({ scheduledAt: 1, status: 1, priority: 1 });
CallSchema.index({ leadId: 1, createdAt: -1 });
CallSchema.index({ 'providerData.provider': 1, 'providerData.callId': 1 });
CallSchema.index({ 'metrics.outcome': 1, campaignId: 1 });
CallSchema.index({ 'complianceChecks.timeZone': 1, scheduledAt: 1 });
CallSchema.index({ 'followUpTasks.scheduledFor': 1, 'followUpTasks.completed': 1 });
CallSchema.index({ 'metrics.conversionProbability': -1 });
CallSchema.index({ createdAt: -1, status: 1 });

// Add static methods to the Call model
CallSchema.statics.findCallsByPhoneNumber = function(phoneNumber: string) {
  return this.find({ phoneNumber }).sort({ createdAt: -1 });
};

CallSchema.statics.findActiveCalls = function() {
  return this.find({ 
    status: { $in: ['dialing', 'in-progress'] } 
  }).sort({ startTime: -1 });
};

CallSchema.statics.findCallsDuringPeriod = function(startDate: Date, endDate: Date) {
  return this.find({
    startTime: { $gte: startDate },
    endTime: { $lte: endDate }
  });
};

CallSchema.statics.findCallsWithHighConversionProbability = function(threshold: number = 0.7) {
  return this.find({
    'metrics.conversionProbability': { $gte: threshold },
    status: 'completed'
  }).sort({ 'metrics.conversionProbability': -1 });
};

CallSchema.statics.getCallMetricsByCampaign = async function(campaignId: string) {
  const pipeline = [
    { $match: { campaignId } },
    { $group: {
      _id: '$status',
      count: { $sum: 1 },
      avgDuration: { $avg: '$duration' },
      totalCalls: { $sum: 1 }
    }},
    { $sort: { count: -1 } }
  ] as any[];
  
  return this.aggregate(pipeline);
};

export default mongoose.model<ICall>('Call', CallSchema);

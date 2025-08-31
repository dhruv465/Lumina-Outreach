import twilio from 'twilio';
import mongoose from 'mongoose';
import logger from '../utils/logger';
import Call, { ICall } from '../models/Call';
import Configuration from '../models/Configuration';
import CircuitBreaker from 'opossum';
import retry from 'async-retry';
import { parsePhoneNumberFromString } from 'libphonenumber-js';
import { v4 as uuidv4 } from 'uuid';

// In-memory rate limiter implementation
class InMemoryRateLimiter {
  private store: Map<string, { count: number, resetTime: number }> = new Map();
  private points: number;
  private duration: number;
  private keyPrefix: string;

  constructor({ keyPrefix, points, duration }: { keyPrefix: string, points: number, duration: number }) {
    this.keyPrefix = keyPrefix;
    this.points = points;
    this.duration = duration * 1000; // Convert to milliseconds
    
    // Cleanup expired entries periodically
    setInterval(() => this.cleanup(), 60000); // Cleanup every minute
  }
  
  private cleanup() {
    const now = Date.now();
    for (const [key, value] of this.store.entries()) {
      if (value.resetTime <= now) {
        this.store.delete(key);
      }
    }
  }

  async consume(key: string, points = 1): Promise<{ remainingPoints: number }> {
    const fullKey = `${this.keyPrefix}:${key}`;
    const now = Date.now();
    
    const record = this.store.get(fullKey);
    
    if (!record || record.resetTime <= now) {
      // Create new record if not exists or expired
      this.store.set(fullKey, {
        count: points,
        resetTime: now + this.duration
      });
      return { remainingPoints: this.points - points };
    }
    
    // Check if over limit
    if (record.count >= this.points) {
      throw new Error('Rate limit exceeded');
    }
    
    // Increment count
    record.count += points;
    this.store.set(fullKey, record);
    
    return { remainingPoints: this.points - record.count };
  }
}

// Configure rate limiters for different operations
const outboundCallLimiter = new InMemoryRateLimiter({
  keyPrefix: 'limiter:outbound-calls',
  points: 30, // 30 calls per minute
  duration: 60,
});

// Per phone number rate limiter (compliance)
const phoneNumberLimiter = new InMemoryRateLimiter({
  keyPrefix: 'limiter:phone-number',
  points: 2, // 2 calls per number per day
  duration: 86400,
});

// Configure circuit breaker for Twilio API
const twilioCircuitBreakerOptions = {
  timeout: 10000,
  errorThresholdPercentage: 30,
  resetTimeout: 30000,
  rollingCountTimeout: 60000,
};

// Create circuit breaker for Twilio calls
const makeCallCircuitBreaker = new CircuitBreaker(
  async (client: twilio.Twilio, params: any) => {
    return await client.calls.create(params);
  },
  twilioCircuitBreakerOptions
);

export interface CallConfiguration {
  leadId: string | mongoose.Types.ObjectId;
  campaignId: string | mongoose.Types.ObjectId;
  phoneNumber: string;
  personalityId?: string;
  abTestVariantId?: string;
  priority: 'low' | 'medium' | 'high';
  scheduledAt?: Date;
  maxRetries?: number;
  callbackUrl: string;
  callId?: string; 
  recordCall?: boolean;
  complianceScriptId?: string;
  smartDialingWindow?: boolean;
  customHeaders?: Record<string, string>;
  detectAnsweringMachine?: 'Continue' | 'Hangup' | 'DetectMessageEnd';
  timeZone?: string;
  disableCallDeduplication?: boolean;
  callReasons?: string[];
}

export interface CallMetrics {
  duration: number;
  outcome: 'connected' | 'no-answer' | 'busy' | 'failed' | 'voicemail';
  conversationMetrics: {
    customerEngagement: number;
    emotionalTone: string[];
    objectionCount: number;
    interruptionCount: number;
    conversionIndicators: string[];
  };
  qualityScore: number;
  complianceScore?: number;
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
}

export class AdvancedTelephonyService {
  private twilioClient: twilio.Twilio | null = null;
  private callQueue: Map<string, CallConfiguration> = new Map();
  private activeConversations: Map<string, any> = new Map();
  private fallbackVoiceProvider: any | null = null;
  private activeDialerStatus: 'active' | 'paused' | 'stopped' = 'stopped';
  private configuration: any = null;
  private initialized: boolean = false;
  private initializationPromise: Promise<void> | null = null;
  // Voice Agent patterns
  private keepAliveTimers: Map<string, NodeJS.Timeout> = new Map();
  private connectionHealthTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly KEEP_ALIVE_INTERVAL = 15000; // 15 seconds (like Deepgram Voice Agent)
  private readonly CONNECTION_HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  private readonly MAX_CONNECTION_RETRIES = 3;
  private connectionRetries: Map<string, number> = new Map();
  private dialingWindowsByTimezone: Record<string, {start: number, end: number}> = {
    'America/New_York': {start: 9, end: 20},
    'America/Chicago': {start: 9, end: 20},
    'America/Denver': {start: 9, end: 20},
    'America/Los_Angeles': {start: 9, end: 20},
    'default': {start: 9, end: 20}
  };

  constructor() {
    // Don't initialize immediately - wait for database to be ready
    // this.initializeWithConfiguration();
  }

  /**
   * Ensure the service is initialized before use
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    
    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }
    
    this.initializationPromise = this.initializeWithConfiguration();
    await this.initializationPromise;
  }

  /**
   * Initialize Twilio client with database configuration
   */
  private async initializeWithConfiguration(): Promise<void> {
    try {
      // Check if mongoose is connected
      const mongoose = require('mongoose');
      if (mongoose.connection.readyState !== 1) {
        logger.warn('MongoDB not connected yet. Skipping Twilio initialization.');
        return;
      }

      this.configuration = await Configuration.findOne();
      
      if (!this.configuration || !this.configuration.twilioConfig.isEnabled) {
        logger.warn('Twilio configuration not found or disabled. Telephony features will be limited.');
        this.initialized = true;
        return;
      }

      this.twilioClient = twilio(
        this.configuration.twilioConfig.accountSid,
        this.configuration.twilioConfig.authToken
      );
      
      logger.info('Twilio client initialized with database configuration');
      
      // Setup error event handlers
      makeCallCircuitBreaker.on('open', () => {
        logger.error('Twilio call circuit breaker tripped - too many failures');
      });
      
      makeCallCircuitBreaker.on('halfOpen', () => {
        logger.info('Twilio call circuit breaker attempting to recover...');
      });
      
      makeCallCircuitBreaker.on('close', () => {
        logger.info('Twilio call circuit breaker closed - service healthy');
      });
      
      // Start periodic cleanup of expired conversations
      setInterval(() => this.cleanupStaleConversations(), 60000);
      
      this.initialized = true;
    } catch (error) {
      logger.error('Error initializing advanced telephony service:', error);
      // Don't throw - allow service to work without Twilio if needed
      this.initialized = true;
    }
  }

  /**
   * Update configuration dynamically without restart
   */
  async updateConfiguration(): Promise<void> {
    await this.initializeWithConfiguration();
    logger.info('Advanced telephony service configuration updated');
  }

  /**
   * Queue a new outbound call with advanced configuration options
   */
  async makeCall(config: CallConfiguration): Promise<string> {
    try {
      await this.ensureInitialized();
      
      // Validate configuration
      if (!config.phoneNumber) {
        throw new Error('Phone number is required');
      }
      
      // Normalize phone number
      try {
        const phoneInfo = parsePhoneNumberFromString(config.phoneNumber);
        if (phoneInfo) {
          config.phoneNumber = phoneInfo.format('E.164');
        }
      } catch (error) {
        logger.warn(`Invalid phone number format: ${config.phoneNumber}`, error);
      }
      
      // Check compliance - daily call limits
      if (!config.disableCallDeduplication) {
        try {
          await phoneNumberLimiter.consume(config.phoneNumber);
        } catch (error) {
          logger.warn(`Rate limit exceeded for number ${config.phoneNumber}: ${error.message}`);
          throw new Error('Daily call limit exceeded for this phone number');
        }
      }

      // Check smart dialing window
      if (config.smartDialingWindow && !this.isWithinDialingWindow(config.timeZone)) {
        logger.info(`Call to ${config.phoneNumber} scheduled outside dialing window`);
        return this.scheduleCall(config);
      }
      
      // Apply rate limiting for outbound calls
      try {
        await outboundCallLimiter.consume('global');
      } catch (error) {
        logger.warn(`Outbound call rate limit exceeded: ${error.message}`);
        throw new Error('Call rate limit exceeded');
      }
      
      // Create call record in database
      const callRecord = new Call({
        leadId: config.leadId,
        campaignId: config.campaignId,
        phoneNumber: config.phoneNumber,
        status: 'queued',
        personalityId: config.personalityId,
        abTestVariantId: config.abTestVariantId,
        scheduledAt: config.scheduledAt || new Date(),
        priority: config.priority || 'medium',
        callReasons: config.callReasons || [],
        complianceScriptId: config.complianceScriptId,
        createdAt: new Date(),
        updatedAt: new Date()
      });
      
      const savedCall = await callRecord.save();
      const callId = savedCall._id.toString();
      
      // Add to queue
      config.callId = callId;
      this.callQueue.set(callId, config);
      
      // Initiate call with retry mechanism
      const twilioCall = await retry(
        async () => this.initiateCall(config),
        {
          retries: config.maxRetries || 3,
          factor: 2,
          minTimeout: 1000,
          maxTimeout: 5000,
          onRetry: (error, attempt) => {
            logger.warn(`Call attempt ${attempt} failed for ${config.phoneNumber}: ${error.message}`);
          }
        }
      );
      
      // Update call record with Twilio SID
      await Call.findByIdAndUpdate(callId, {
        $set: {
          twilioSid: twilioCall.sid,
          status: 'dialing',
          updatedAt: new Date()
        }
      });
      
      logger.info(`Call queued successfully with ID: ${callId}`);
      return callId;
      
    } catch (error) {
      logger.error('Error making call:', error);
      throw error;
    }
  }

  /**
   * Initiate a call using Twilio API with circuit breaker
   */
  private async initiateCall(config: CallConfiguration): Promise<any> {
    try {
      await this.ensureInitialized();
      
      const callParams: any = {
        to: config.phoneNumber,
        from: this.configuration.twilioConfig.phoneNumber,
        url: `${config.callbackUrl}?callId=${config.callId}`,
        statusCallback: `${config.callbackUrl}/status?callId=${config.callId}`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
        method: 'POST',
        timeout: 30,
        fallbackUrl: `${config.callbackUrl}/fallback?callId=${config.callId}`,
        fallbackMethod: 'POST'
      };
      
      // Add recording if requested
      if (config.recordCall) {
        callParams.record = true;
        callParams.recordingStatusCallback = `${config.callbackUrl}/recording?callId=${config.callId}`;
        callParams.recordingStatusCallbackMethod = 'POST';
      }
      
      // Configure answering machine detection
      if (config.detectAnsweringMachine) {
        callParams.machineDetection = 'Enable';
        callParams.machineDetectionTimeout = 5;
        callParams.machineDetectionAction = config.detectAnsweringMachine;
      }
      
      // Add custom headers if provided
      if (config.customHeaders) {
        callParams.headers = JSON.stringify(config.customHeaders);
      }
      
      // Place the call using circuit breaker
      logger.debug(`Making call to ${config.phoneNumber}`);
      const call = await makeCallCircuitBreaker.fire(this.twilioClient!, callParams);
      
      logger.info(`Call initiated to ${config.phoneNumber} with SID: ${call.sid}`);
      return call;
      
    } catch (error) {
      logger.error(`Error initiating call to ${config.phoneNumber}:`, error);
      throw error;
    }
  }

  /**
   * Check if current time is within allowed dialing window for timezone
   */
  private isWithinDialingWindow(timeZone?: string): boolean {
    const now = new Date();
    const zone = timeZone || 'default';
    const window = this.dialingWindowsByTimezone[zone] || this.dialingWindowsByTimezone.default;
    
    const currentHour = now.getHours();
    return currentHour >= window.start && currentHour < window.end;
  }

  /**
   * Schedule a call for later execution
   */
  private async scheduleCall(config: CallConfiguration): Promise<string> {
    // Implementation would depend on your scheduling system
    // For now, we'll just set a scheduledAt time for the next valid dialing window
    const scheduledAt = this.getNextDialingWindow(config.timeZone);
    config.scheduledAt = scheduledAt;
    
    logger.info(`Call to ${config.phoneNumber} scheduled for ${scheduledAt}`);
    return 'scheduled';
  }

  /**
   * Get the next valid dialing window time
   */
  private getNextDialingWindow(timeZone?: string): Date {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const zone = timeZone || 'default';
    const window = this.dialingWindowsByTimezone[zone] || this.dialingWindowsByTimezone.default;
    
    tomorrow.setHours(window.start, 0, 0, 0);
    return tomorrow;
  }

  /**
   * Clean up stale conversations and queue entries
   */
  private async cleanupStaleConversations(): Promise<void> {
    const staleThreshold = Date.now() - (30 * 60 * 1000); // 30 minutes
    
    for (const [callId, conversation] of this.activeConversations.entries()) {
      if (conversation.lastActivity < staleThreshold) {
        logger.debug(`Cleaning up stale conversation: ${callId}`);
        this.activeConversations.delete(callId);
        this.callQueue.delete(callId);
      }
    }
  }

  /**
   * Save conversation metrics to the database
   */
  private async saveConversationMetrics(callId: string, metrics: CallMetrics): Promise<void> {
    try {
      await Call.findOneAndUpdate(
        { _id: callId },
        { 
          $set: { 
            metrics,
            updatedAt: new Date()
          }
        }
      );
      logger.debug(`Saved metrics for call ${callId}`);
    } catch (error) {
      logger.error(`Error saving call metrics for ${callId}:`, error);
      throw error;
    }
  }

  /**
   * Update the status of a call in the database
   */
  private async updateCallStatus(
    callId: string, 
    status: ICall['status'], 
    additionalData: Record<string, any> = {}
  ): Promise<void> {
    try {
      await Call.findByIdAndUpdate(
        callId,
        {
          $set: {
            status,
            updatedAt: new Date(),
            ...additionalData
          }
        }
      );
      logger.debug(`Updated call ${callId} status to: ${status}`);
    } catch (error) {
      logger.error(`Error updating call status for ${callId}:`, error);
      throw error;
    }
  }

  /**
   * Handle voice webhooks from Twilio
   */
  async handleVoiceWebhook(req: any, res: any): Promise<void> {
    const callId = req.query.callId;
    
    try {
      logger.debug(`Received voice webhook for call ${callId}`);
      
      // Update call status to answered
      await this.updateCallStatus(callId, 'in-progress', {
        answeredAt: new Date()
      });
      
      // Initialize conversation tracking
      this.activeConversations.set(callId, {
        startTime: Date.now(),
        lastActivity: Date.now(),
        metrics: {
          duration: 0,
          outcome: 'connected',
          conversationMetrics: {
            customerEngagement: 0,
            emotionalTone: [],
            objectionCount: 0,
            interruptionCount: 0,
            conversionIndicators: []
          },
          qualityScore: 0
        },
        needsFinalSave: true,
        isConnectionHealthy: true,
        lastKeepAlive: Date.now()
      });

      // Set up keep-alive and connection health monitoring (inspired by Deepgram Voice Agent)
      this.setupConversationKeepAlive(callId);
      this.setupConversationHealthCheck(callId);
      
      // Return TwiML response to handle the call
      const twiml = new twilio.twiml.VoiceResponse();
      
      // Get the campaign's opening message
      const call = await Call.findById(callId).populate('campaignId');
      const campaign = call?.campaignId as any;
      const openingMessage = campaign?.openingMessage;

      // Add a greeting or redirect to your voice AI handler
      twiml.say({
        voice: 'alice',
        language: 'en-US'
      }, openingMessage || '');
      
      // You would typically redirect to your voice AI service here
      const conversationId = uuidv4();
      twiml.redirect(`${req.query.callbackUrl}/voice-ai?callId=${callId}&conversationId=${conversationId}`);
      
      res.type('text/xml');
      res.send(twiml.toString());
      
    } catch (error) {
      logger.error(`Error in voice webhook for call ${callId}:`, error);
      
      const twiml = new twilio.twiml.VoiceResponse();
      twiml.say('We apologize, but there was an error. Please try again later.');
      twiml.hangup();
      
      res.type('text/xml');
      res.send(twiml.toString());
    }
  }

  /**
   * Handle status update webhooks from Twilio
   */
  async handleStatusWebhook(req: any, res: any): Promise<void> {
    const callId = req.query.callId;
    const callStatus = req.body.CallStatus;
    const callDuration = parseInt(req.body.CallDuration || '0', 10);
    
    try {
      logger.debug(`Received status webhook for call ${callId}: ${callStatus}`);
      
      // Map Twilio statuses to internal statuses
      const statusMap: Record<string, ICall['status']> = {
        'queued': 'queued',
        'initiated': 'dialing',
        'ringing': 'dialing',
        'in-progress': 'in-progress',
        'completed': 'completed',
        'busy': 'busy',
        'failed': 'failed',
        'no-answer': 'no-answer',
        'canceled': 'failed'
      };
      
      const internalStatus = statusMap[callStatus] || 'failed';
      
      if (callStatus === 'completed') {
        await this.updateCallStatus(callId, internalStatus, {
          endTime: new Date(),
          duration: callDuration
        });
        
        const conversation = this.activeConversations.get(callId);
        if (conversation && conversation.needsFinalSave) {
          await this.saveConversationMetrics(callId, {
            ...conversation.metrics,
            duration: callDuration,
            outcome: 'connected'
          });
          conversation.needsFinalSave = false;
        }
        
        this.callQueue.delete(callId);
        this.activeConversations.delete(callId);
      } else if (['failed', 'busy', 'no-answer'].includes(callStatus)) {
        await this.updateCallStatus(callId, internalStatus, {
          endTime: new Date(),
          failureCode: callStatus
        });
      } else {
        await this.updateCallStatus(callId, internalStatus);
      }
      
      res.status(200).send('Status update received');
      
    } catch (error) {
      logger.error(`Error in status webhook for call ${callId}:`, error);
      res.status(500).send('Error processing status update');
    }
  }

  /**
   * Handle recording webhooks from Twilio
   */
  async handleRecordingWebhook(req: any, res: any): Promise<void> {
    const callId = req.query.callId;
    const recordingUrl = req.body.RecordingUrl;
    
    try {
      logger.debug(`Received recording webhook for call ${callId}: ${recordingUrl}`);
      
      await Call.findByIdAndUpdate(callId, {
        $set: {
          recordingUrl,
          'metrics.callRecordingUrl': recordingUrl
        }
      });
      
      res.status(200).send('Recording processed');
      
    } catch (error) {
      logger.error(`Error in recording webhook for call ${callId}:`, error);
      res.status(500).send('Error processing recording');
    }
  }

  /**
   * Get call queue status
   */
  getQueueStatus(): any {
    return {
      totalQueued: this.callQueue.size,
      activeConversations: this.activeConversations.size,
      dialerStatus: this.activeDialerStatus
    };
  }

  /**
   * Pause the dialer
   */
  pauseDialer(): void {
    this.activeDialerStatus = 'paused';
    logger.info('Advanced telephony dialer paused');
  }

  /**
   * Resume the dialer
   */
  resumeDialer(): void {
    this.activeDialerStatus = 'active';
    logger.info('Advanced telephony dialer resumed');
  }

  /**
   * Stop the dialer
   */
  stopDialer(): void {
    this.activeDialerStatus = 'stopped';
    logger.info('Advanced telephony dialer stopped');
  }

  /**
   * Handle Twilio webhook events
   */
  public handleTwilioWebhook(event: any): void {
    const { CallSid: callId, CallStatus: status } = event;
    
    if (!callId) {
      logger.warn('Received Twilio webhook without CallSid');
      return;
    }

    logger.info(`Twilio webhook: ${callId} status changed to ${status}`);
    
    // Update conversation status
    const conversation = this.activeConversations.get(callId);
    if (conversation) {
      conversation.status = this.mapTwilioStatus(status);
      conversation.lastActivity = Date.now();
      
      // Handle call completion
      if (status === 'completed' || status === 'failed' || status === 'busy' || status === 'no-answer') {
        this.finalizeCall(callId, status);
      }
    }
  }

  /**
   * Map Twilio call status to internal status
   */
  private mapTwilioStatus(twilioStatus: string): ICall['status'] {
    const statusMap: Record<string, ICall['status']> = {
      'initiated': 'dialing',
      'ringing': 'dialing',
      'queued': 'dialing',
      'in-progress': 'in-progress',
      'completed': 'completed',
      'failed': 'failed',
      'busy': 'busy',
      'no-answer': 'no-answer',
      'canceled': 'failed'
    };
    
    return statusMap[twilioStatus] || 'failed';
  }

  // Duplicate function removed - using enhanced version below

  /**
   * Update call metrics in database
   */
  private async updateCallMetrics(callId: string, metrics: Partial<CallMetrics>): Promise<void> {
    try {
      // This would typically update a Call record in the database
      // Implementation depends on your database setup
      logger.debug(`Updating metrics for call ${callId}:`, metrics);
    } catch (error) {
      logger.error(`Error updating call metrics for ${callId}:`, error);
    }
  }

  /**
   * Get conversation history for a call
   */
  public getConversationHistory(callId: string): any[] {
    const conversation = this.activeConversations.get(callId);
    return conversation?.messages || [];
  }

  /**
   * Get active call statistics
   */
  public getActiveCallStats(): {
    totalActive: number;
    byStatus: Record<string, number>;
    queueSize: number;
  } {
    const stats = {
      totalActive: this.activeConversations.size,
      byStatus: {} as Record<string, number>,
      queueSize: this.callQueue.size
    };

    for (const conversation of this.activeConversations.values()) {
      const status = conversation.status;
      stats.byStatus[status] = (stats.byStatus[status] || 0) + 1;
    }

    return stats;
  }

  /**
   * Health check for the telephony service
   */
  public async healthCheck(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    checks: Record<string, boolean>;
    metrics: any;
  }> {
    const checks = {
      twilio: false,
      configuration: false,
      asr: false
    };

    try {
      // Check Twilio connectivity
      if (this.twilioClient) {
        await this.twilioClient.api.accounts.list({ limit: 1 });
        checks.twilio = true;
      }
    } catch (error) {
      logger.error('Twilio health check failed:', error);
    }

    // Check configuration status
    checks.configuration = this.configuration !== null;
    
    // Check ASR configuration status
    if (this.configuration) {
      checks.asr = !!(
        this.configuration.deepgramConfig?.apiKey
      );
    }

    const healthyChecks = Object.values(checks).filter(Boolean).length;
    const totalChecks = Object.keys(checks).length;
    
    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (healthyChecks === 0) {
      status = 'unhealthy';
    } else if (healthyChecks < totalChecks) {
      status = 'degraded';
    }

    return {
      status,
      checks,
      metrics: this.getActiveCallStats()
    };
  }

  /**
   * Graceful shutdown
   */
  public async shutdown(): Promise<void> {
    logger.info('Shutting down Advanced Telephony Service...');
    
    try {
      // Stop accepting new calls
      this.isShuttingDown = true;
      
      // Wait for active calls to complete (with timeout)
      const shutdownTimeout = 30000; // 30 seconds
      const startTime = Date.now();
      
      while (this.activeConversations.size > 0 && (Date.now() - startTime) < shutdownTimeout) {
        logger.info(`Waiting for ${this.activeConversations.size} active calls to complete...`);
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Force cleanup remaining calls
      if (this.activeConversations.size > 0) {
        logger.warn(`Force cleaning up ${this.activeConversations.size} remaining calls`);
        for (const callId of this.activeConversations.keys()) {
          await this.finalizeCall(callId, 'canceled');
        }
      }
      
      logger.info('Advanced Telephony Service shutdown complete');
      
    } catch (error) {
      logger.error('Error during telephony service shutdown:', error);
    }
  }

  /**
   * Map call status to outcome
   */
  private mapStatusToOutcome(status: string): CallMetrics['outcome'] {
    const outcomeMap: Record<string, CallMetrics['outcome']> = {
      'completed': 'connected',
      'busy': 'busy',
      'no-answer': 'no-answer',
      'failed': 'failed',
      'voicemail': 'voicemail'
    };
    
    return outcomeMap[status] || 'failed';
  }

  /**
   * Get call queue (compatibility method)
   */
  public async getCallQueue(): Promise<any[]> {
    return Array.from(this.callQueue.values());
  }

  /**
   * Get active conversations (compatibility method)
   */
  public async getActiveConversations(): Promise<any[]> {
    return Array.from(this.activeConversations.values());
  }

  /**
   * Get call metrics for a time range (compatibility method)
   */
  public async getCallMetrics(timeRange: string): Promise<any> {
    // This would typically query the database for call metrics
    // For now, return basic stats
    return {
      timeRange,
      totalCalls: this.callQueue.size + this.activeConversations.size,
      activeCalls: this.activeConversations.size,
      queuedCalls: this.callQueue.size,
      stats: this.getActiveCallStats()
    };
  }

  /**
   * Pause a specific call (compatibility method)
   */
  public async pauseCall(callId: string): Promise<void> {
    const conversation = this.activeConversations.get(callId);
    if (conversation) {
      conversation.paused = true;
      logger.info(`Call ${callId} paused`);
    } else {
      throw new Error(`Call ${callId} not found`);
    }
  }

  private isShuttingDown = false;

  /**
   * Set up keep-alive mechanism for a conversation (inspired by Deepgram Voice Agent)
   * @param callId Call ID
   */
  private setupConversationKeepAlive(callId: string): void {
    // Clear any existing timer
    this.clearConversationKeepAlive(callId);

    // Set up keep-alive timer
    const timer = setInterval(() => {
      this.sendConversationKeepAlive(callId);
    }, this.KEEP_ALIVE_INTERVAL);

    this.keepAliveTimers.set(callId, timer);
    logger.debug(`Keep-alive setup for conversation ${callId}`);
  }

  /**
   * Send keep-alive signal for a conversation
   * @param callId Call ID
   */
  private sendConversationKeepAlive(callId: string): void {
    const conversation = this.activeConversations.get(callId);
    
    if (!conversation) {
      this.clearConversationKeepAlive(callId);
      return;
    }

    // Update last keep-alive time
    conversation.lastKeepAlive = Date.now();
    conversation.lastActivity = Date.now();

    // Emit keep-alive event (you can integrate with your event system)
    logger.debug(`Keep-alive sent for conversation ${callId}`, {
      duration: Date.now() - conversation.startTime,
      isHealthy: conversation.isConnectionHealthy
    });
  }

  /**
   * Clear keep-alive timer for a conversation
   * @param callId Call ID
   */
  private clearConversationKeepAlive(callId: string): void {
    const timer = this.keepAliveTimers.get(callId);
    if (timer) {
      clearInterval(timer);
      this.keepAliveTimers.delete(callId);
      logger.debug(`Keep-alive cleared for conversation ${callId}`);
    }
  }

  /**
   * Set up connection health monitoring for a conversation
   * @param callId Call ID
   */
  private setupConversationHealthCheck(callId: string): void {
    // Clear any existing timer
    this.clearConversationHealthCheck(callId);

    // Set up health check timer
    const timer = setInterval(() => {
      this.checkConversationHealth(callId);
    }, this.CONNECTION_HEALTH_CHECK_INTERVAL);

    this.connectionHealthTimers.set(callId, timer);
    logger.debug(`Connection health check setup for conversation ${callId}`);
  }

  /**
   * Check connection health for a conversation
   * @param callId Call ID
   */
  private async checkConversationHealth(callId: string): Promise<void> {
    const conversation = this.activeConversations.get(callId);
    
    if (!conversation) {
      this.clearConversationHealthCheck(callId);
      return;
    }

    const now = Date.now();
    const lastKeepAlive = conversation.lastKeepAlive || conversation.startTime;
    const healthCheckThreshold = this.KEEP_ALIVE_INTERVAL * 3; // 3x keep-alive interval

    // Check if we've missed keep-alive signals
    const isHealthy = (now - lastKeepAlive) < healthCheckThreshold;

    if (conversation.isConnectionHealthy !== isHealthy) {
      conversation.isConnectionHealthy = isHealthy;

      if (!isHealthy) {
        logger.warn(`Connection health degraded for conversation ${callId}`);
        
        // Attempt connection recovery
        await this.attemptConversationRecovery(callId);
      } else {
        logger.info(`Connection health restored for conversation ${callId}`);
        this.connectionRetries.delete(callId); // Reset retry count
      }
    }
  }

  /**
   * Attempt to recover conversation connection
   * @param callId Call ID
   */
  private async attemptConversationRecovery(callId: string): Promise<void> {
    const retryCount = this.connectionRetries.get(callId) || 0;
    this.connectionRetries.set(callId, retryCount + 1);

    if (retryCount >= this.MAX_CONNECTION_RETRIES) {
      logger.error(`Max connection retries exceeded for conversation ${callId}, ending call`);
      
      // End the call due to connection issues
      try {
        if (this.twilioClient) {
          await this.twilioClient.calls(callId).update({ status: 'completed' });
        }
      } catch (error) {
        logger.error(`Failed to end call ${callId} after connection recovery failure:`, error);
      }
      
      this.finalizeCall(callId, 'failed');
      return;
    }

    logger.info(`Attempting connection recovery for conversation ${callId} (attempt ${retryCount + 1})`);

    // Reset keep-alive to try to restore connection
    this.setupConversationKeepAlive(callId);
  }

  /**
   * Clear connection health check timer
   * @param callId Call ID
   */
  private clearConversationHealthCheck(callId: string): void {
    const timer = this.connectionHealthTimers.get(callId);
    if (timer) {
      clearInterval(timer);
      this.connectionHealthTimers.delete(callId);
      logger.debug(`Connection health check cleared for conversation ${callId}`);
    }
  }

  /**
   * Handle conversation audio events (inspired by Deepgram Voice Agent)
   * @param callId Call ID
   * @param event Event type
   * @param data Event data
   */
  public handleConversationAudioEvent(callId: string, event: string, data: any): void {
    const conversation = this.activeConversations.get(callId);
    if (!conversation) {
      logger.warn(`Received audio event for unknown conversation: ${callId}`);
      return;
    }

    // Update last activity time
    conversation.lastActivity = Date.now();

    switch (event) {
      case 'userStartedSpeaking':
        logger.debug(`User started speaking in conversation ${callId}`);
        break;

      case 'agentStartedSpeaking':
        logger.debug(`Agent started speaking in conversation ${callId}`);
        if (data.responseLatency) {
          // Track response latency
          if (!conversation.metrics.responseTimes) {
            conversation.metrics.responseTimes = [];
          }
          conversation.metrics.responseTimes.push(data.responseLatency);
        }
        break;

      case 'agentAudioDone':
        logger.debug(`Agent audio completed for conversation ${callId}`);
        break;

      case 'audioChunkReceived':
        // Update activity without logging every chunk
        break;

      default:
        logger.debug(`Unknown audio event for conversation ${callId}: ${event}`);
    }
  }

  /**
   * Enhanced finalize call with voice agent cleanup
   */
  private async finalizeCall(callId: string, status: string): Promise<void> {
    const conversation = this.activeConversations.get(callId);
    if (!conversation) return;

    try {
      // Clear voice agent timers
      this.clearConversationKeepAlive(callId);
      this.clearConversationHealthCheck(callId);
      this.connectionRetries.delete(callId);

      const duration = Date.now() - conversation.startTime;
      
      // Update call metrics with voice agent data
      const enhancedMetrics = {
        ...conversation.metrics,
        duration,
        outcome: this.mapStatusToOutcome(status),
        connectionHealth: {
          wasHealthy: conversation.isConnectionHealthy,
          lastKeepAlive: conversation.lastKeepAlive,
          retryAttempts: this.connectionRetries.get(callId) || 0
        }
      };

      await this.updateCallMetrics(callId, enhancedMetrics);

      // Log call completion with voice agent metrics
      logger.info(`Call ${callId} finalized with enhanced voice agent metrics`, {
        status,
        duration,
        connectionHealth: enhancedMetrics.connectionHealth,
        responseTimes: enhancedMetrics.responseTimes?.length || 0
      });
      
      // Clean up
      this.activeConversations.delete(callId);
      this.callQueue.delete(callId);
      
    } catch (error) {
      logger.error(`Error finalizing call ${callId}:`, error);
    }
  }
}

export const advancedTelephonyService = new AdvancedTelephonyService();

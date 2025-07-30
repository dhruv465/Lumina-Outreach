/**
 * realTelephonyService.ts
 * Production implementation of the telephony service using Twilio
 */

import twilio from 'twilio';
import { EventEmitter } from 'events';
import { TwilioCallStatus, CallData, TelephonyServiceInterface } from '../types/telephony';
import logger, { getErrorMessage } from '../utils/logger';

export class RealTelephonyService implements TelephonyServiceInterface {
  private client: twilio.Twilio;
  private events: EventEmitter;
  private activeCalls: Map<string, CallData>;
  private webhookBaseUrl: string;
  private fallbackMode: boolean = false;
  // Voice Agent patterns
  private keepAliveTimers: Map<string, NodeJS.Timeout> = new Map();
  private connectionHealthTimers: Map<string, NodeJS.Timeout> = new Map();
  private readonly KEEP_ALIVE_INTERVAL = 15000; // 15 seconds (like Deepgram Voice Agent)
  private readonly CONNECTION_HEALTH_CHECK_INTERVAL = 30000; // 30 seconds
  private readonly MAX_CONNECTION_RETRIES = 3;
  private connectionRetries: Map<string, number> = new Map();

  constructor(
    accountSid: string,
    authToken: string,
    webhookBaseUrl: string
  ) {
    // Initialize Twilio client
    this.client = twilio(accountSid, authToken);
    this.events = new EventEmitter();
    this.activeCalls = new Map();
    this.webhookBaseUrl = webhookBaseUrl;
    
    // Monitor Twilio API health
    this.monitorApiHealth();
  }

  /**
   * Initiates an outbound call
   */
  public async makeCall(
    to: string,
    from: string,
    callbackUrl: string,
    options?: { 
      timeout?: number; 
      machineDetection?: 'Enable' | 'DetectMessageEnd';
      recordingEnabled?: boolean;
    }
  ): Promise<string> {
    try {
      if (this.fallbackMode) {
        throw new Error('Telephony service is in fallback mode. Using simulated call.');
      }
      
      // Configure call parameters
      const callParams: any = {
        to,
        from,
        url: callbackUrl,
        statusCallback: `${this.webhookBaseUrl}/call-status`,
        statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
        statusCallbackMethod: 'POST',
      };
      
      // Add optional parameters
      if (options?.timeout) {
        callParams.timeout = options.timeout;
      }
      
      if (options?.machineDetection) {
        callParams.machineDetection = options.machineDetection;
      }
      
      if (options?.recordingEnabled) {
        callParams.record = true;
        callParams.recordingStatusCallback = `${this.webhookBaseUrl}/recording-status`;
      }
      
      // Place the call
      const call = await this.client.calls.create(callParams);
      
      // Store call data
      this.activeCalls.set(call.sid, {
        id: call.sid,
        to,
        from,
        status: call.status as TwilioCallStatus,
        startTime: new Date().toISOString(),
        recordings: []
      });

      // Set up keep-alive and connection health monitoring (inspired by Deepgram Voice Agent)
      this.setupCallKeepAlive(call.sid);
      this.setupConnectionHealthCheck(call.sid);
      
      logger.info(`Call initiated: ${call.sid} to ${to} from ${from}`);
      
      return call.sid;
    } catch (error) {
      logger.error(`Error making call: ${getErrorMessage(error)}`, { error });
      
      // Use fallback mode if we're not already in it
      if (!this.fallbackMode) {
        this.fallbackMode = true;
        logger.warn('Switching to fallback telephony mode');
        
        // Use simulated call (fallback logic)
        const simulatedCallId = `sim_${Date.now()}`;
        
        this.activeCalls.set(simulatedCallId, {
          id: simulatedCallId,
          to,
          from,
          status: 'initiated',
          startTime: new Date().toISOString(),
          recordings: [],
          isFallback: true
        });

        // Set up keep-alive and health monitoring even for fallback calls
        this.setupCallKeepAlive(simulatedCallId);
        this.setupConnectionHealthCheck(simulatedCallId);
        
        // Simulate call progress events
        setTimeout(() => this.handleCallStatusChange(simulatedCallId, 'ringing'), 1000);
        setTimeout(() => this.handleCallStatusChange(simulatedCallId, 'in-progress'), 3000);
        
        return simulatedCallId;
      }
      
      throw error;
    }
  }
  
  /**
   * Ends an active call
   */
  public async endCall(callId: string): Promise<boolean> {
    try {
      if (!this.activeCalls.has(callId)) {
        logger.warn(`Call ${callId} not found in active calls`);
        return false;
      }
      
      const callData = this.activeCalls.get(callId);
      
      // Use fallback for simulated calls
      if (callData.isFallback) {
        this.handleCallStatusChange(callId, 'completed');
        return true;
      }
      
      if (this.fallbackMode) {
        throw new Error('Telephony service is in fallback mode');
      }
      
      // End the call via Twilio
      await this.client.calls(callId).update({ status: 'completed' });
      
      logger.info(`Call ended: ${callId}`);
      return true;
    } catch (error) {
      logger.error(`Error ending call ${callId}: ${getErrorMessage(error)}`, { error });
      
      // If in fallback mode or error occurs, simulate call end
      if (this.activeCalls.has(callId)) {
        this.handleCallStatusChange(callId, 'completed');
        return true;
      }
      
      return false;
    }
  }
  
  /**
   * Handles incoming webhook for call status changes
   */
  public handleWebhook(eventType: string, data: any): void {
    const callId = data.CallSid;
    
    if (!callId) {
      logger.error('Received webhook without CallSid', { data });
      return;
    }
    
    switch (eventType) {
      case 'call-status':
        this.handleCallStatusChange(callId, data.CallStatus);
        break;
        
      case 'recording-status':
        this.handleRecordingUpdate(callId, data);
        break;
        
      default:
        logger.warn(`Unknown webhook event type: ${eventType}`, { data });
    }
  }
  
  /**
   * Updates call status based on webhook data
   */
  private handleCallStatusChange(callId: string, status: TwilioCallStatus): void {
    if (!this.activeCalls.has(callId)) {
      // This might be a new incoming call we're not tracking yet
      if (status === 'ringing' || status === 'initiated') {
        this.activeCalls.set(callId, {
          id: callId,
          status,
          startTime: new Date().toISOString(),
          recordings: []
        });
      } else {
        logger.warn(`Received status update for unknown call: ${callId}`);
        return;
      }
    }
    
    // Update call status
    const callData = this.activeCalls.get(callId);
    const updatedCallData = { ...callData, status };
    
    // Add end time if call is completed or failed
    if (status === 'completed' || status === 'failed' || status === 'busy' || status === 'no-answer') {
      updatedCallData.endTime = new Date().toISOString();
    }
    
    this.activeCalls.set(callId, updatedCallData);
    
    // Emit event for status change
    this.events.emit('call-status-change', {
      callId,
      status,
      callData: updatedCallData
    });
    
    logger.info(`Call ${callId} status changed to ${status}`);
    
    // Clean up completed calls after a delay
    if (status === 'completed' || status === 'failed') {
      // Clear timers immediately
      this.clearCallKeepAlive(callId);
      this.clearConnectionHealthCheck(callId);
      this.connectionRetries.delete(callId);

      setTimeout(() => {
        this.activeCalls.delete(callId);
        logger.info(`Call ${callId} removed from active calls`);
      }, 300000); // 5 minutes
    }
  }
  
  /**
   * Updates recording information for a call
   */
  private handleRecordingUpdate(callId: string, data: any): void {
    if (!this.activeCalls.has(callId)) {
      logger.warn(`Received recording update for unknown call: ${callId}`);
      return;
    }
    
    const callData = this.activeCalls.get(callId);
    const recordings = [...(callData.recordings || [])];
    
    recordings.push({
      id: data.RecordingSid,
      duration: parseInt(data.RecordingDuration || '0', 10),
      url: data.RecordingUrl,
      status: data.RecordingStatus === 'completed' ? 'completed' : 
              data.RecordingStatus === 'failed' ? 'failed' : 'processing'
    });
    
    this.activeCalls.set(callId, { ...callData, recordings });
    
    logger.info(`Call ${callId} recording updated: ${data.RecordingSid}`);
  }
  
  /**
   * Gets current status of a call
   */
  public getCallStatus(callId: string): TwilioCallStatus | null {
    const call = this.activeCalls.get(callId);
    return call ? call.status : null;
  }
  
  /**
   * Gets data for a specific call
   */
  public getCallData(callId: string): CallData | null {
    return this.activeCalls.get(callId) || null;
  }
  
  /**
   * Retrieves all active calls
   */
  public getActiveCalls(): CallData[] {
    return Array.from(this.activeCalls.values());
  }
  
  /**
   * Subscribes to telephony events
   */
  public on(event: string, listener: (...args: any[]) => void): void {
    this.events.on(event, listener);
  }
  
  /**
   * Unsubscribes from telephony events
   */
  public off(event: string, listener: (...args: any[]) => void): void {
    this.events.off(event, listener);
  }
  
  /**
   * Monitors Twilio API health and toggles fallback mode
   */
  private monitorApiHealth(): void {
    const checkApiHealth = async () => {
      try {
        if (this.fallbackMode) {
          // Try to recover from fallback mode
          await this.client.api.v2010.account.fetch();
          
          // If no error, exit fallback mode
          this.fallbackMode = false;
          logger.info('Telephony service recovered from fallback mode');
        }
      } catch (error) {
        if (!this.fallbackMode) {
          logger.error('Twilio API health check failed, entering fallback mode', { error });
          this.fallbackMode = true;
        }
      }
    };
    
    // Check health every 5 minutes
    setInterval(checkApiHealth, 300000);
  }

  /**
   * Set up keep-alive mechanism for a call (inspired by Deepgram Voice Agent)
   * @param callId Call ID
   */
  private setupCallKeepAlive(callId: string): void {
    // Clear any existing timer
    this.clearCallKeepAlive(callId);

    // Set up keep-alive timer
    const timer = setInterval(() => {
      this.sendCallKeepAlive(callId);
    }, this.KEEP_ALIVE_INTERVAL);

    this.keepAliveTimers.set(callId, timer);
    logger.debug(`Keep-alive setup for call ${callId}`);
  }

  /**
   * Send keep-alive signal for a call
   * @param callId Call ID
   */
  private sendCallKeepAlive(callId: string): void {
    const callData = this.activeCalls.get(callId);
    
    if (!callData) {
      this.clearCallKeepAlive(callId);
      return;
    }

    // Only send keep-alive for active calls
    if (callData.status === 'completed' || callData.status === 'failed') {
      this.clearCallKeepAlive(callId);
      return;
    }

    // Emit keep-alive event
    this.events.emit('call-keep-alive', {
      callId,
      timestamp: new Date().toISOString(),
      status: callData.status,
      duration: callData.endTime ? 
        new Date(callData.endTime).getTime() - new Date(callData.startTime).getTime() : 
        Date.now() - new Date(callData.startTime).getTime()
    });

    logger.debug(`Keep-alive sent for call ${callId}`);
  }

  /**
   * Clear keep-alive timer for a call
   * @param callId Call ID
   */
  private clearCallKeepAlive(callId: string): void {
    const timer = this.keepAliveTimers.get(callId);
    if (timer) {
      clearInterval(timer);
      this.keepAliveTimers.delete(callId);
      logger.debug(`Keep-alive cleared for call ${callId}`);
    }
  }

  /**
   * Set up connection health monitoring for a call
   * @param callId Call ID
   */
  private setupConnectionHealthCheck(callId: string): void {
    // Clear any existing timer
    this.clearConnectionHealthCheck(callId);

    // Set up health check timer
    const timer = setInterval(() => {
      this.checkCallConnectionHealth(callId);
    }, this.CONNECTION_HEALTH_CHECK_INTERVAL);

    this.connectionHealthTimers.set(callId, timer);
    logger.debug(`Connection health check setup for call ${callId}`);
  }

  /**
   * Check connection health for a call
   * @param callId Call ID
   */
  private async checkCallConnectionHealth(callId: string): Promise<void> {
    const callData = this.activeCalls.get(callId);
    
    if (!callData) {
      this.clearConnectionHealthCheck(callId);
      return;
    }

    // Skip health check for completed calls
    if (callData.status === 'completed' || callData.status === 'failed') {
      this.clearConnectionHealthCheck(callId);
      return;
    }

    try {
      // For real calls, check Twilio call status
      if (!callData.isFallback && !this.fallbackMode) {
        const twilioCall = await this.client.calls(callId).fetch();
        
        // Update local status if different
        if (twilioCall.status !== callData.status) {
          logger.info(`Call ${callId} status updated from health check: ${callData.status} -> ${twilioCall.status}`);
          this.handleCallStatusChange(callId, twilioCall.status as TwilioCallStatus);
        }
      }

      // Reset retry count on successful health check
      this.connectionRetries.delete(callId);

      // Emit health status
      this.events.emit('call-health-check', {
        callId,
        isHealthy: true,
        timestamp: new Date().toISOString(),
        status: callData.status
      });

    } catch (error) {
      logger.warn(`Connection health check failed for call ${callId}: ${getErrorMessage(error)}`);
      
      // Attempt connection recovery
      await this.attemptCallConnectionRecovery(callId);
    }
  }

  /**
   * Attempt to recover call connection
   * @param callId Call ID
   */
  private async attemptCallConnectionRecovery(callId: string): Promise<void> {
    const retryCount = this.connectionRetries.get(callId) || 0;
    this.connectionRetries.set(callId, retryCount + 1);

    if (retryCount >= this.MAX_CONNECTION_RETRIES) {
      logger.error(`Max connection retries exceeded for call ${callId}, marking as failed`);
      
      this.handleCallStatusChange(callId, 'failed');
      this.clearCallKeepAlive(callId);
      this.clearConnectionHealthCheck(callId);
      this.connectionRetries.delete(callId);
      
      // Emit recovery failure event
      this.events.emit('call-recovery-failed', {
        callId,
        attempts: retryCount,
        timestamp: new Date().toISOString()
      });
      
      return;
    }

    logger.info(`Attempting connection recovery for call ${callId} (attempt ${retryCount + 1})`);

    // Emit recovery attempt event
    this.events.emit('call-recovery-attempt', {
      callId,
      attempt: retryCount + 1,
      maxAttempts: this.MAX_CONNECTION_RETRIES,
      timestamp: new Date().toISOString()
    });

    // For fallback calls, just reset the health check
    const callData = this.activeCalls.get(callId);
    if (callData?.isFallback) {
      // Simulate recovery for fallback calls
      setTimeout(() => {
        this.events.emit('call-health-check', {
          callId,
          isHealthy: true,
          timestamp: new Date().toISOString(),
          recovered: true
        });
      }, 1000);
    }
  }

  /**
   * Clear connection health check timer
   * @param callId Call ID
   */
  private clearConnectionHealthCheck(callId: string): void {
    const timer = this.connectionHealthTimers.get(callId);
    if (timer) {
      clearInterval(timer);
      this.connectionHealthTimers.delete(callId);
      logger.debug(`Connection health check cleared for call ${callId}`);
    }
  }

  /**
   * Handle call audio streaming events (inspired by Deepgram Voice Agent)
   * @param callId Call ID
   * @param event Event type
   * @param data Event data
   */
  public handleCallAudioEvent(callId: string, event: string, data: any): void {
    const callData = this.activeCalls.get(callId);
    if (!callData) {
      logger.warn(`Received audio event for unknown call: ${callId}`);
      return;
    }

    switch (event) {
      case 'userStartedSpeaking':
        this.events.emit('call-user-started-speaking', {
          callId,
          timestamp: new Date().toISOString(),
          ...data
        });
        logger.debug(`User started speaking in call ${callId}`);
        break;

      case 'agentStartedSpeaking':
        this.events.emit('call-agent-started-speaking', {
          callId,
          timestamp: new Date().toISOString(),
          ...data
        });
        logger.debug(`Agent started speaking in call ${callId}`);
        break;

      case 'agentAudioDone':
        this.events.emit('call-agent-audio-done', {
          callId,
          timestamp: new Date().toISOString(),
          ...data
        });
        logger.debug(`Agent audio completed for call ${callId}`);
        break;

      case 'audioChunkReceived':
        // Don't log every chunk to avoid spam
        this.events.emit('call-audio-chunk-received', {
          callId,
          timestamp: new Date().toISOString(),
          ...data
        });
        break;

      default:
        logger.debug(`Unknown audio event for call ${callId}: ${event}`);
    }
  }
  
  /**
   * Check service health
   */
  public async checkHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    message?: string;
  }> {
    try {
      if (this.fallbackMode) {
        return {
          status: 'degraded',
          message: 'Telephony service is in fallback mode'
        };
      }

      // Try to fetch account info to verify API connectivity
      try {
        // Ping the Twilio API by listing a resource
        await this.client.calls.list({limit: 1});
        return { status: 'healthy' };
      } catch (error) {
        logger.error(`Twilio API check failed: ${getErrorMessage(error)}`);
        this.fallbackMode = true;
        return {
          status: 'unhealthy',
          message: `Twilio API check failed: ${getErrorMessage(error)}`
        };
      }
    } catch (error) {
      logger.error(`Error checking telephony service health: ${getErrorMessage(error)}`);
      return {
        status: 'unhealthy',
        message: `Internal error: ${getErrorMessage(error)}`
      };
    }
  }
}

// Types
export interface TelephonyConfig {
  accountSid: string;
  authToken: string;
  webhookBaseUrl: string;
}

// Create singleton instance
let telephonyService: RealTelephonyService | null = null;

export function initializeTelephonyService(config: TelephonyConfig): RealTelephonyService {
  if (!telephonyService) {
    telephonyService = new RealTelephonyService(
      config.accountSid,
      config.authToken,
      config.webhookBaseUrl
    );
  }
  
  return telephonyService;
}

export function getTelephonyService(): RealTelephonyService {
  if (!telephonyService) {
    throw new Error('Telephony service not initialized');
  }
  
  return telephonyService;
}

export default {
  initialize: initializeTelephonyService,
  getService: getTelephonyService
};
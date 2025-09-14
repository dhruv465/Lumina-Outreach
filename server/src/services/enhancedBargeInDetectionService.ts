import { EventEmitter } from 'events';
import { logger } from '../index';
import { realTimeCallStateMachine, CallEvent } from './realTimeCallStateMachine';

/**
 * Enhanced barge-in detection service for real-time interruption handling
 * Provides sophisticated voice activity detection and interruption management
 */

export interface BargeInConfig {
  // Audio analysis settings
  energyThreshold: number;      // Minimum energy level to consider as speech
  silenceThreshold: number;     // Maximum energy level to consider as silence
  minSpeechDuration: number;    // Minimum duration to confirm speech (ms)
  maxSilenceDuration: number;   // Maximum silence before stopping speech detection (ms)
  
  // Barge-in settings
  bargeInEnabled: boolean;      // Whether barge-in is enabled
  bargeInGracePeriod: number;   // Grace period before allowing barge-in (ms)
  maxBargeInPerMinute: number;  // Rate limiting for barge-ins
  
  // Audio processing
  sampleRate: number;           // Audio sample rate (Hz)
  frameSize: number;            // Audio frame size for analysis
  bufferSize: number;           // Buffer size for audio analysis
  
  // Sensitivity settings
  sensitivity: 'low' | 'medium' | 'high' | 'custom';
  customSensitivity?: {
    energyMultiplier: number;
    durationMultiplier: number;
  };
}

export interface VoiceActivityResult {
  isSpeech: boolean;
  energyLevel: number;
  confidence: number;
  timestamp: Date;
  duration: number;
  metadata?: Record<string, any>;
}

export interface BargeInEvent {
  callId: string;
  timestamp: Date;
  confidence: number;
  energyLevel: number;
  agentWasSpeaking: boolean;
  previousBargeIns: number;
  metadata: Record<string, any>;
}

export class EnhancedBargeInDetectionService extends EventEmitter {
  private callConfigs: Map<string, BargeInConfig> = new Map();
  private audioBuffers: Map<string, Buffer[]> = new Map();
  private speechStates: Map<string, {
    isSpeaking: boolean;
    speechStart?: Date;
    lastActivity?: Date;
    energyHistory: number[];
    bargeInCount: number;
    lastBargeIn?: Date;
  }> = new Map();
  
  private readonly DEFAULT_CONFIG: BargeInConfig = {
    energyThreshold: 0.01,
    silenceThreshold: 0.005,
    minSpeechDuration: 100,   // 100ms for faster detection
    maxSilenceDuration: 500,  // 500ms for faster response
    bargeInEnabled: true,
    bargeInGracePeriod: 200,  // 200ms grace period for ultra-low latency
    maxBargeInPerMinute: 10,  // Increased for more responsive detection
    sampleRate: 16000,        // 16kHz for faster processing
    frameSize: 80,            // 5ms at 16kHz
    bufferSize: 1024,         // 1KB for faster processing
    sensitivity: 'high'       // High sensitivity for faster detection
  };

  constructor() {
    super();
    this.setupEventListeners();
  }

  /**
   * Initialize barge-in detection for a call
   */
  public initializeCall(
    callId: string, 
    config: Partial<BargeInConfig> = {}
  ): void {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };
    
    // Apply sensitivity presets
    this.applySensitivityPreset(finalConfig);
    
    this.callConfigs.set(callId, finalConfig);
    this.audioBuffers.set(callId, []);
    this.speechStates.set(callId, {
      isSpeaking: false,
      energyHistory: [],
      bargeInCount: 0
    });

    logger.info(`Barge-in detection initialized for call ${callId}`, {
      config: finalConfig,
      sensitivity: finalConfig.sensitivity
    });

    this.emit('callInitialized', { callId, config: finalConfig });
  }

  /**
   * Process audio chunk for voice activity detection
   */
  public processAudioChunk(
    callId: string,
    audioBuffer: Buffer,
    timestamp: Date = new Date()
  ): VoiceActivityResult | null {
    const config = this.callConfigs.get(callId);
    const speechState = this.speechStates.get(callId);
    
    if (!config || !speechState) {
      logger.warn(`Call ${callId} not initialized for barge-in detection`);
      return null;
    }

    // Calculate energy level
    const energyLevel = this.calculateAudioEnergy(audioBuffer);
    
    // Update energy history
    speechState.energyHistory.push(energyLevel);
    if (speechState.energyHistory.length > 50) { // Keep last 50 samples
      speechState.energyHistory.shift();
    }

    // Determine if this is speech
    const isSpeech = this.detectSpeech(energyLevel, speechState, config);
    const confidence = this.calculateConfidence(energyLevel, speechState, config);

    const result: VoiceActivityResult = {
      isSpeech,
      energyLevel,
      confidence,
      timestamp,
      duration: speechState.speechStart ? 
        timestamp.getTime() - speechState.speechStart.getTime() : 0
    };

    // Update speech state
    this.updateSpeechState(callId, isSpeech, timestamp, energyLevel);

    // Check for barge-in if speech detected
    if (isSpeech && this.shouldTriggerBargeIn(callId, energyLevel, timestamp)) {
      this.triggerBargeIn(callId, energyLevel, confidence, timestamp);
    }

    this.emit('voiceActivityDetected', {
      callId,
      result
    });

    return result;
  }

  /**
   * Set agent speaking status (for barge-in context)
   */
  public setAgentSpeaking(callId: string, isSpeaking: boolean): void {
    const session = realTimeCallStateMachine.getSession(callId);
    if (session) {
      realTimeCallStateMachine.setAgentSpeaking(callId, isSpeaking);
    }

    this.emit('agentSpeakingChanged', {
      callId,
      isSpeaking,
      timestamp: new Date()
    });
  }

  /**
   * Check if barge-in should be triggered
   */
  private shouldTriggerBargeIn(
    callId: string,
    energyLevel: number,
    timestamp: Date
  ): boolean {
    const config = this.callConfigs.get(callId);
    const speechState = this.speechStates.get(callId);
    const session = realTimeCallStateMachine.getSession(callId);

    if (!config || !speechState || !session) return false;

    // Check if barge-in is enabled
    if (!config.bargeInEnabled) return false;

    // Check if agent is currently speaking
    if (!session.isAgentSpeaking) return false;

    // Check if we can be interrupted
    if (!session.canBeInterrupted) return false;

    // Check grace period since agent started speaking
    if (session.lastAgentSpeechTime) {
      const timeSinceAgentStart = timestamp.getTime() - session.lastAgentSpeechTime.getTime();
      if (timeSinceAgentStart < config.bargeInGracePeriod) return false;
    }

    // Check rate limiting
    if (speechState.lastBargeIn) {
      const timeSinceLastBargeIn = timestamp.getTime() - speechState.lastBargeIn.getTime();
      const bargeInWindow = 60000; // 1 minute
      
      if (timeSinceLastBargeIn < bargeInWindow && 
          speechState.bargeInCount >= config.maxBargeInPerMinute) {
        return false;
      }
    }

    // Check energy threshold
    if (energyLevel < config.energyThreshold * 2) { // Higher threshold for barge-in
      return false;
    }

    // Check minimum speech duration
    if (speechState.speechStart) {
      const speechDuration = timestamp.getTime() - speechState.speechStart.getTime();
      if (speechDuration < config.minSpeechDuration) return false;
    }

    return true;
  }

  /**
   * Trigger a barge-in event
   */
  private triggerBargeIn(
    callId: string,
    energyLevel: number,
    confidence: number,
    timestamp: Date
  ): void {
    const speechState = this.speechStates.get(callId);
    const session = realTimeCallStateMachine.getSession(callId);

    if (!speechState || !session) return;

    speechState.bargeInCount++;
    speechState.lastBargeIn = timestamp;

    const bargeInEvent: BargeInEvent = {
      callId,
      timestamp,
      confidence,
      energyLevel,
      agentWasSpeaking: session.isAgentSpeaking,
      previousBargeIns: speechState.bargeInCount - 1,
      metadata: {
        speechDuration: speechState.speechStart ? 
          timestamp.getTime() - speechState.speechStart.getTime() : 0,
        averageEnergy: speechState.energyHistory.reduce((a, b) => a + b, 0) / 
          speechState.energyHistory.length || 0
      }
    };

    logger.info(`Barge-in triggered for call ${callId}`, {
      energyLevel,
      confidence,
      bargeInCount: speechState.bargeInCount,
      agentWasSpeaking: session.isAgentSpeaking
    });

    // Notify state machine
    realTimeCallStateMachine.handleEvent(callId, CallEvent.BARGE_IN_DETECTED, {
      energyLevel,
      confidence,
      bargeInCount: speechState.bargeInCount
    });

    // Emit barge-in event
    this.emit('bargeInDetected', bargeInEvent);
  }

  /**
   * Calculate audio energy level
   */
  private calculateAudioEnergy(audioBuffer: Buffer): number {
    if (audioBuffer.length === 0) return 0;

    let sum = 0;
    let sampleCount = 0;

    // Assume 16-bit PCM audio
    for (let i = 0; i < audioBuffer.length - 1; i += 2) {
      const sample = audioBuffer.readInt16LE(i);
      sum += sample * sample;
      sampleCount++;
    }

    if (sampleCount === 0) return 0;

    // Root mean square
    const rms = Math.sqrt(sum / sampleCount);
    
    // Normalize to 0-1 range
    return Math.min(rms / 32768.0, 1.0);
  }

  /**
   * Detect speech based on energy and history
   */
  private detectSpeech(
    energyLevel: number,
    speechState: any,
    config: BargeInConfig
  ): boolean {
    // Simple energy-based detection
    const threshold = config.energyThreshold;
    
    // Consider recent energy history for smoothing
    const recentEnergy = speechState.energyHistory.slice(-5); // Last 5 samples
    const avgRecentEnergy = recentEnergy.reduce((a: number, b: number) => a + b, 0) / 
      Math.max(recentEnergy.length, 1);

    // Speech if current energy or recent average exceeds threshold
    return energyLevel > threshold || avgRecentEnergy > threshold * 0.8;
  }

  /**
   * Calculate confidence score for speech detection
   */
  private calculateConfidence(
    energyLevel: number,
    speechState: any,
    config: BargeInConfig
  ): number {
    const threshold = config.energyThreshold;
    
    // Base confidence on energy level relative to threshold
    let confidence = Math.min(energyLevel / threshold, 1.0);
    
    // Boost confidence if speech has been consistent
    if (speechState.energyHistory.length > 5) {
      const recentSpeechSamples = speechState.energyHistory.slice(-10)
        .filter((energy: number) => energy > threshold).length;
      const consistencyBoost = recentSpeechSamples / 10;
      confidence = Math.min(confidence + consistencyBoost * 0.2, 1.0);
    }

    return confidence;
  }

  /**
   * Update speech state for a call
   */
  private updateSpeechState(
    callId: string,
    isSpeech: boolean,
    timestamp: Date,
    energyLevel: number
  ): void {
    const speechState = this.speechStates.get(callId);
    if (!speechState) return;

    const wasSpeeking = speechState.isSpeaking;

    if (isSpeech && !wasSpeeking) {
      // Speech started
      speechState.isSpeaking = true;
      speechState.speechStart = timestamp;
      speechState.lastActivity = timestamp;

      // Notify state machine
      realTimeCallStateMachine.setUserSpeaking(callId, true, energyLevel);
      
    } else if (!isSpeech && wasSpeeking) {
      // Check if we should stop speech detection (silence duration)
      const config = this.callConfigs.get(callId);
      if (config && speechState.lastActivity) {
        const silenceDuration = timestamp.getTime() - speechState.lastActivity.getTime();
        
        if (silenceDuration > config.maxSilenceDuration) {
          // Speech ended
          speechState.isSpeaking = false;
          speechState.speechStart = undefined;
          
          // Notify state machine
          realTimeCallStateMachine.setUserSpeaking(callId, false);
        }
      }
    } else if (isSpeech) {
      // Continue speech
      speechState.lastActivity = timestamp;
    }
  }

  /**
   * Apply sensitivity preset configurations
   */
  private applySensitivityPreset(config: BargeInConfig): void {
    switch (config.sensitivity) {
      case 'low':
        config.energyThreshold *= 1.5;
        config.minSpeechDuration *= 1.2;
        config.bargeInGracePeriod *= 1.5;
        break;
        
      case 'high':
        config.energyThreshold *= 0.7;
        config.minSpeechDuration *= 0.8;
        config.bargeInGracePeriod *= 0.7;
        break;
        
      case 'custom':
        if (config.customSensitivity) {
          config.energyThreshold *= config.customSensitivity.energyMultiplier;
          config.minSpeechDuration *= config.customSensitivity.durationMultiplier;
        }
        break;
        
      case 'medium':
      default:
        // Use default values
        break;
    }
  }

  /**
   * Set up event listeners
   */
  private setupEventListeners(): void {
    // Listen for state machine events
    realTimeCallStateMachine.on('stateChanged', (data) => {
      const { session, transition } = data;
      
      // Adjust barge-in settings based on state
      if (transition.to === 'speaking') {
        // Agent started speaking, reset grace period
        this.resetBargeInGracePeriod(session.callId);
      }
    });
  }

  /**
   * Reset barge-in grace period for a call
   */
  private resetBargeInGracePeriod(callId: string): void {
    const speechState = this.speechStates.get(callId);
    if (speechState) {
      // Reset any relevant timing states
      speechState.lastActivity = new Date();
    }
  }

  /**
   * Update barge-in configuration for a call
   */
  public updateConfig(callId: string, config: Partial<BargeInConfig>): void {
    const currentConfig = this.callConfigs.get(callId);
    if (currentConfig) {
      const updatedConfig = { ...currentConfig, ...config };
      this.applySensitivityPreset(updatedConfig);
      this.callConfigs.set(callId, updatedConfig);
      
      logger.info(`Barge-in config updated for call ${callId}`, updatedConfig);
    }
  }

  /**
   * Get current configuration for a call
   */
  public getConfig(callId: string): BargeInConfig | undefined {
    return this.callConfigs.get(callId);
  }

  /**
   * Get speech state for a call
   */
  public getSpeechState(callId: string): any {
    return this.speechStates.get(callId);
  }

  /**
   * Clean up call data
   */
  public cleanupCall(callId: string): void {
    this.callConfigs.delete(callId);
    this.audioBuffers.delete(callId);
    this.speechStates.delete(callId);
    
    logger.info(`Cleaned up barge-in detection for call ${callId}`);
    
    this.emit('callCleaned', { callId });
  }

  /**
   * Get metrics for a call
   */
  public getCallMetrics(callId: string): Record<string, any> | null {
    const speechState = this.speechStates.get(callId);
    const config = this.callConfigs.get(callId);
    
    if (!speechState || !config) return null;

    return {
      callId,
      isCurrentlySpeaking: speechState.isSpeaking,
      totalBargeIns: speechState.bargeInCount,
      lastBargeIn: speechState.lastBargeIn,
      speechStart: speechState.speechStart,
      lastActivity: speechState.lastActivity,
      averageEnergyLevel: speechState.energyHistory.reduce((a, b) => a + b, 0) / 
        Math.max(speechState.energyHistory.length, 1),
      config: {
        sensitivity: config.sensitivity,
        bargeInEnabled: config.bargeInEnabled,
        energyThreshold: config.energyThreshold
      }
    };
  }

  /**
   * Get all active calls
   */
  public getActiveCalls(): string[] {
    return Array.from(this.callConfigs.keys());
  }
}

// Export singleton instance
export const enhancedBargeInDetectionService = new EnhancedBargeInDetectionService();
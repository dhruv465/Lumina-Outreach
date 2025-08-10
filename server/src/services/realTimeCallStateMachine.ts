import { EventEmitter } from 'events';
import { logger } from '../index';
import { v4 as uuidv4 } from 'uuid';

/**
 * Real-time call state machine for managing interruption-friendly AI voice agent workflow
 * Supports barge-in detection, streaming STT/TTS, and low-latency audio processing
 */

export enum CallState {
  INITIALIZING = 'initializing',
  CONNECTING = 'connecting',
  GREETING = 'greeting',
  LISTENING = 'listening',
  PROCESSING = 'processing',
  SPEAKING = 'speaking',
  INTERRUPTED = 'interrupted',
  WAITING_FOR_RESPONSE = 'waiting_for_response',
  ENDING = 'ending',
  ENDED = 'ended',
  ERROR = 'error'
}

export enum CallEvent {
  CALL_CONNECTED = 'call_connected',
  MEDIA_STREAM_STARTED = 'media_stream_started',
  USER_STARTED_SPEAKING = 'user_started_speaking',
  USER_STOPPED_SPEAKING = 'user_stopped_speaking',
  SPEECH_DETECTED = 'speech_detected',
  TRANSCRIPTION_RECEIVED = 'transcription_received',
  AI_RESPONSE_GENERATED = 'ai_response_generated',
  TTS_STARTED = 'tts_started',
  TTS_COMPLETED = 'tts_completed',
  BARGE_IN_DETECTED = 'barge_in_detected',
  CALL_ENDED = 'call_ended',
  ERROR_OCCURRED = 'error_occurred',
  SILENCE_TIMEOUT = 'silence_timeout',
  RESPONSE_TIMEOUT = 'response_timeout'
}

export interface CallSessionData {
  callId: string;
  conversationId: string;
  streamSid?: string;
  currentState: CallState;
  previousState?: CallState;
  lastStateChange: Date;
  sessionStartTime: Date;
  
  // Audio processing
  isUserSpeaking: boolean;
  isAgentSpeaking: boolean;
  lastUserSpeechTime?: Date;
  lastAgentSpeechTime?: Date;
  
  // Barge-in handling
  bargeInCount: number;
  lastBargeInTime?: Date;
  canBeInterrupted: boolean;
  
  // Performance metrics
  responseLatency: number[];
  averageResponseTime: number;
  
  // Configuration
  silenceTimeout: number; // ms
  responseTimeout: number; // ms
  bargeInThreshold: number; // audio level threshold
  
  // Metadata
  leadId: string;
  campaignId: string;
  metadata: Record<string, any>;
}

export interface StateTransition {
  from: CallState;
  to: CallState;
  event: CallEvent;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export class RealTimeCallStateMachine extends EventEmitter {
  private sessions: Map<string, CallSessionData> = new Map();
  private stateTransitions: Map<string, StateTransition[]> = new Map();
  private timers: Map<string, Map<string, NodeJS.Timeout>> = new Map();
  
  // Default configuration
  private readonly DEFAULT_SILENCE_TIMEOUT = 3000; // 3 seconds
  private readonly DEFAULT_RESPONSE_TIMEOUT = 5000; // 5 seconds
  private readonly DEFAULT_BARGE_IN_THRESHOLD = 0.3; // Audio level threshold
  
  constructor() {
    super();
    this.setupEventHandlers();
  }

  /**
   * Create a new call session
   */
  public createSession(
    callId: string,
    conversationId: string,
    leadId: string,
    campaignId: string,
    options: Partial<CallSessionData> = {}
  ): CallSessionData {
    const session: CallSessionData = {
      callId,
      conversationId,
      currentState: CallState.INITIALIZING,
      lastStateChange: new Date(),
      sessionStartTime: new Date(),
      isUserSpeaking: false,
      isAgentSpeaking: false,
      bargeInCount: 0,
      canBeInterrupted: true,
      responseLatency: [],
      averageResponseTime: 0,
      silenceTimeout: this.DEFAULT_SILENCE_TIMEOUT,
      responseTimeout: this.DEFAULT_RESPONSE_TIMEOUT,
      bargeInThreshold: this.DEFAULT_BARGE_IN_THRESHOLD,
      leadId,
      campaignId,
      metadata: {},
      ...options
    };

    this.sessions.set(callId, session);
    this.stateTransitions.set(callId, []);
    this.timers.set(callId, new Map());

    logger.info(`Real-time call session created for call ${callId}`, {
      conversationId,
      initialState: session.currentState,
      leadId,
      campaignId
    });

    this.emit('sessionCreated', session);
    return session;
  }

  /**
   * Get session data for a call
   */
  public getSession(callId: string): CallSessionData | undefined {
    return this.sessions.get(callId);
  }

  /**
   * Transition to a new state
   */
  public transitionToState(
    callId: string,
    newState: CallState,
    event: CallEvent,
    metadata: Record<string, any> = {}
  ): boolean {
    const session = this.sessions.get(callId);
    if (!session) {
      logger.error(`Cannot transition state: session not found for call ${callId}`);
      return false;
    }

    const currentState = session.currentState;
    
    // Validate state transition
    if (!this.isValidTransition(currentState, newState, event)) {
      logger.warn(`Invalid state transition for call ${callId}`, {
        from: currentState,
        to: newState,
        event,
        metadata
      });
      return false;
    }

    // Record transition
    const transition: StateTransition = {
      from: currentState,
      to: newState,
      event,
      timestamp: new Date(),
      metadata
    };

    const transitions = this.stateTransitions.get(callId) || [];
    transitions.push(transition);
    this.stateTransitions.set(callId, transitions);

    // Update session
    session.previousState = currentState;
    session.currentState = newState;
    session.lastStateChange = new Date();

    // Merge metadata
    Object.assign(session.metadata, metadata);

    logger.info(`State transition for call ${callId}`, {
      from: currentState,
      to: newState,
      event,
      duration: new Date().getTime() - session.lastStateChange.getTime(),
      metadata
    });

    // Clear existing timers for this state
    this.clearTimers(callId);

    // Set up timers for new state
    this.setupStateTimers(callId, newState);

    // Emit state change event
    this.emit('stateChanged', {
      session,
      transition,
      callId
    });

    // Handle specific state logic
    this.handleStateEntry(callId, newState, metadata);

    return true;
  }

  /**
   * Handle events that trigger state transitions
   */
  public handleEvent(
    callId: string,
    event: CallEvent,
    data: Record<string, any> = {}
  ): void {
    const session = this.sessions.get(callId);
    if (!session) {
      logger.error(`Cannot handle event: session not found for call ${callId}`);
      return;
    }

    const currentState = session.currentState;
    
    logger.debug(`Handling event for call ${callId}`, {
      event,
      currentState,
      data
    });

    // Update session data based on event
    this.updateSessionFromEvent(session, event, data);

    // Determine next state based on current state and event
    const nextState = this.determineNextState(currentState, event, session, data);
    
    if (nextState && nextState !== currentState) {
      this.transitionToState(callId, nextState, event, data);
    }

    // Emit event for external listeners
    this.emit(event, {
      callId,
      session,
      data
    });
  }

  /**
   * Check if user is currently speaking (for barge-in detection)
   */
  public setUserSpeaking(callId: string, isSpeaking: boolean, audioLevel?: number): void {
    const session = this.sessions.get(callId);
    if (!session) return;

    const wasUserSpeaking = session.isUserSpeaking;
    session.isUserSpeaking = isSpeaking;

    if (isSpeaking && !wasUserSpeaking) {
      session.lastUserSpeechTime = new Date();
      this.handleEvent(callId, CallEvent.USER_STARTED_SPEAKING, { audioLevel });
      
      // Check for barge-in if agent is currently speaking
      if (session.isAgentSpeaking && session.canBeInterrupted) {
        this.handleBargeIn(callId, audioLevel);
      }
    } else if (!isSpeaking && wasUserSpeaking) {
      this.handleEvent(callId, CallEvent.USER_STOPPED_SPEAKING);
    }
  }

  /**
   * Set agent speaking status
   */
  public setAgentSpeaking(callId: string, isSpeaking: boolean): void {
    const session = this.sessions.get(callId);
    if (!session) return;

    session.isAgentSpeaking = isSpeaking;
    
    if (isSpeaking) {
      session.lastAgentSpeechTime = new Date();
      this.handleEvent(callId, CallEvent.TTS_STARTED);
    } else {
      this.handleEvent(callId, CallEvent.TTS_COMPLETED);
    }
  }

  /**
   * Handle barge-in detection
   */
  private handleBargeIn(callId: string, audioLevel?: number): void {
    const session = this.sessions.get(callId);
    if (!session) return;

    // Check audio level threshold
    if (audioLevel && audioLevel < session.bargeInThreshold) {
      return; // Not loud enough to be considered barge-in
    }

    session.bargeInCount++;
    session.lastBargeInTime = new Date();

    logger.info(`Barge-in detected for call ${callId}`, {
      bargeInCount: session.bargeInCount,
      audioLevel,
      currentState: session.currentState
    });

    // Emit barge-in event
    this.handleEvent(callId, CallEvent.BARGE_IN_DETECTED, {
      audioLevel,
      bargeInCount: session.bargeInCount
    });
  }

  /**
   * End a call session
   */
  public endSession(callId: string, reason: string = 'normal'): void {
    const session = this.sessions.get(callId);
    if (!session) return;

    // Transition to ending state
    this.transitionToState(callId, CallState.ENDING, CallEvent.CALL_ENDED, { reason });

    // Calculate final metrics
    const sessionDuration = new Date().getTime() - session.sessionStartTime.getTime();
    const finalMetrics = {
      sessionDuration,
      totalBargeIns: session.bargeInCount,
      averageResponseTime: session.averageResponseTime,
      totalStateTransitions: this.stateTransitions.get(callId)?.length || 0,
      reason
    };

    logger.info(`Call session ended for call ${callId}`, finalMetrics);

    // Clean up
    this.clearTimers(callId);
    setTimeout(() => {
      this.sessions.delete(callId);
      this.stateTransitions.delete(callId);
      this.timers.delete(callId);
    }, 5000); // Keep data for 5 seconds for final processing

    this.emit('sessionEnded', {
      session,
      metrics: finalMetrics
    });
  }

  /**
   * Validate if a state transition is allowed
   */
  private isValidTransition(from: CallState, to: CallState, event: CallEvent): boolean {
    // Define valid transitions
    const validTransitions: Record<CallState, Partial<Record<CallEvent, CallState[]>>> = {
      [CallState.INITIALIZING]: {
        [CallEvent.CALL_CONNECTED]: [CallState.CONNECTING],
        [CallEvent.ERROR_OCCURRED]: [CallState.ERROR]
      },
      [CallState.CONNECTING]: {
        [CallEvent.MEDIA_STREAM_STARTED]: [CallState.GREETING],
        [CallEvent.ERROR_OCCURRED]: [CallState.ERROR],
        [CallEvent.CALL_ENDED]: [CallState.ENDING]
      },
      [CallState.GREETING]: {
        [CallEvent.TTS_STARTED]: [CallState.SPEAKING],
        [CallEvent.TTS_COMPLETED]: [CallState.LISTENING],
        [CallEvent.BARGE_IN_DETECTED]: [CallState.INTERRUPTED],
        [CallEvent.ERROR_OCCURRED]: [CallState.ERROR],
        [CallEvent.CALL_ENDED]: [CallState.ENDING]
      },
      [CallState.LISTENING]: {
        [CallEvent.USER_STARTED_SPEAKING]: [CallState.LISTENING], // Stay in listening
        [CallEvent.SPEECH_DETECTED]: [CallState.PROCESSING],
        [CallEvent.SILENCE_TIMEOUT]: [CallState.WAITING_FOR_RESPONSE],
        [CallEvent.ERROR_OCCURRED]: [CallState.ERROR],
        [CallEvent.CALL_ENDED]: [CallState.ENDING]
      },
      [CallState.PROCESSING]: {
        [CallEvent.AI_RESPONSE_GENERATED]: [CallState.SPEAKING],
        [CallEvent.BARGE_IN_DETECTED]: [CallState.INTERRUPTED],
        [CallEvent.RESPONSE_TIMEOUT]: [CallState.ERROR],
        [CallEvent.ERROR_OCCURRED]: [CallState.ERROR],
        [CallEvent.CALL_ENDED]: [CallState.ENDING]
      },
      [CallState.SPEAKING]: {
        [CallEvent.TTS_COMPLETED]: [CallState.LISTENING],
        [CallEvent.BARGE_IN_DETECTED]: [CallState.INTERRUPTED],
        [CallEvent.ERROR_OCCURRED]: [CallState.ERROR],
        [CallEvent.CALL_ENDED]: [CallState.ENDING]
      },
      [CallState.INTERRUPTED]: {
        [CallEvent.USER_STOPPED_SPEAKING]: [CallState.LISTENING],
        [CallEvent.SPEECH_DETECTED]: [CallState.PROCESSING],
        [CallEvent.ERROR_OCCURRED]: [CallState.ERROR],
        [CallEvent.CALL_ENDED]: [CallState.ENDING]
      },
      [CallState.WAITING_FOR_RESPONSE]: {
        [CallEvent.USER_STARTED_SPEAKING]: [CallState.LISTENING],
        [CallEvent.TTS_STARTED]: [CallState.SPEAKING],
        [CallEvent.RESPONSE_TIMEOUT]: [CallState.ENDING],
        [CallEvent.ERROR_OCCURRED]: [CallState.ERROR],
        [CallEvent.CALL_ENDED]: [CallState.ENDING]
      },
      [CallState.ERROR]: {
        [CallEvent.CALL_ENDED]: [CallState.ENDING]
      },
      [CallState.ENDING]: {
        // No transitions from ending
      },
      [CallState.ENDED]: {
        // No transitions from ended
      }
    };

    const allowedStates = validTransitions[from]?.[event];
    return allowedStates ? allowedStates.includes(to) : false;
  }

  /**
   * Determine next state based on current state and event
   */
  private determineNextState(
    currentState: CallState,
    event: CallEvent,
    session: CallSessionData,
    data: Record<string, any>
  ): CallState | null {
    // Simple state machine logic - can be enhanced
    switch (currentState) {
      case CallState.INITIALIZING:
        if (event === CallEvent.CALL_CONNECTED) return CallState.CONNECTING;
        if (event === CallEvent.ERROR_OCCURRED) return CallState.ERROR;
        break;

      case CallState.CONNECTING:
        if (event === CallEvent.MEDIA_STREAM_STARTED) return CallState.GREETING;
        if (event === CallEvent.ERROR_OCCURRED) return CallState.ERROR;
        if (event === CallEvent.CALL_ENDED) return CallState.ENDING;
        break;

      case CallState.GREETING:
        if (event === CallEvent.TTS_STARTED) return CallState.SPEAKING;
        if (event === CallEvent.TTS_COMPLETED) return CallState.LISTENING;
        if (event === CallEvent.BARGE_IN_DETECTED) return CallState.INTERRUPTED;
        break;

      case CallState.LISTENING:
        if (event === CallEvent.SPEECH_DETECTED || event === CallEvent.TRANSCRIPTION_RECEIVED) {
          return CallState.PROCESSING;
        }
        if (event === CallEvent.SILENCE_TIMEOUT) return CallState.WAITING_FOR_RESPONSE;
        break;

      case CallState.PROCESSING:
        if (event === CallEvent.AI_RESPONSE_GENERATED) return CallState.SPEAKING;
        if (event === CallEvent.BARGE_IN_DETECTED) return CallState.INTERRUPTED;
        if (event === CallEvent.RESPONSE_TIMEOUT) return CallState.ERROR;
        break;

      case CallState.SPEAKING:
        if (event === CallEvent.TTS_COMPLETED) return CallState.LISTENING;
        if (event === CallEvent.BARGE_IN_DETECTED) return CallState.INTERRUPTED;
        break;

      case CallState.INTERRUPTED:
        if (event === CallEvent.USER_STOPPED_SPEAKING) return CallState.LISTENING;
        if (event === CallEvent.SPEECH_DETECTED) return CallState.PROCESSING;
        break;

      case CallState.WAITING_FOR_RESPONSE:
        if (event === CallEvent.USER_STARTED_SPEAKING) return CallState.LISTENING;
        if (event === CallEvent.TTS_STARTED) return CallState.SPEAKING;
        if (event === CallEvent.RESPONSE_TIMEOUT) return CallState.ENDING;
        break;
    }

    // Handle universal transitions
    if (event === CallEvent.ERROR_OCCURRED) return CallState.ERROR;
    if (event === CallEvent.CALL_ENDED) return CallState.ENDING;

    return null; // No state change
  }

  /**
   * Update session data based on event
   */
  private updateSessionFromEvent(
    session: CallSessionData,
    event: CallEvent,
    data: Record<string, any>
  ): void {
    switch (event) {
      case CallEvent.MEDIA_STREAM_STARTED:
        if (data.streamSid) session.streamSid = data.streamSid;
        break;

      case CallEvent.AI_RESPONSE_GENERATED:
        if (data.responseTime) {
          session.responseLatency.push(data.responseTime);
          session.averageResponseTime = 
            session.responseLatency.reduce((a, b) => a + b, 0) / session.responseLatency.length;
        }
        break;

      case CallEvent.BARGE_IN_DETECTED:
        session.bargeInCount++;
        session.lastBargeInTime = new Date();
        break;
    }
  }

  /**
   * Handle state entry logic
   */
  private handleStateEntry(callId: string, state: CallState, metadata: Record<string, any>): void {
    switch (state) {
      case CallState.LISTENING:
        // Start silence timeout
        this.startSilenceTimer(callId);
        break;

      case CallState.PROCESSING:
        // Start response timeout
        this.startResponseTimer(callId);
        break;

      case CallState.INTERRUPTED:
        // Cancel any ongoing TTS
        this.emit('cancelTTS', { callId });
        break;

      case CallState.ENDING:
        // Clean up any ongoing processes
        this.emit('cleanupCall', { callId });
        break;
    }
  }

  /**
   * Set up state-specific timers
   */
  private setupStateTimers(callId: string, state: CallState): void {
    const session = this.sessions.get(callId);
    if (!session) return;

    switch (state) {
      case CallState.LISTENING:
        this.startSilenceTimer(callId);
        break;

      case CallState.PROCESSING:
        this.startResponseTimer(callId);
        break;
    }
  }

  /**
   * Start silence timeout timer
   */
  private startSilenceTimer(callId: string): void {
    const session = this.sessions.get(callId);
    if (!session) return;

    const timer = setTimeout(() => {
      this.handleEvent(callId, CallEvent.SILENCE_TIMEOUT);
    }, session.silenceTimeout);

    this.setTimer(callId, 'silence', timer);
  }

  /**
   * Start response timeout timer
   */
  private startResponseTimer(callId: string): void {
    const session = this.sessions.get(callId);
    if (!session) return;

    const timer = setTimeout(() => {
      this.handleEvent(callId, CallEvent.RESPONSE_TIMEOUT);
    }, session.responseTimeout);

    this.setTimer(callId, 'response', timer);
  }

  /**
   * Set a timer for a call
   */
  private setTimer(callId: string, timerName: string, timer: NodeJS.Timeout): void {
    let callTimers = this.timers.get(callId);
    if (!callTimers) {
      callTimers = new Map();
      this.timers.set(callId, callTimers);
    }

    // Clear existing timer with same name
    const existingTimer = callTimers.get(timerName);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    callTimers.set(timerName, timer);
  }

  /**
   * Clear all timers for a call
   */
  private clearTimers(callId: string): void {
    const callTimers = this.timers.get(callId);
    if (callTimers) {
      callTimers.forEach(timer => clearTimeout(timer));
      callTimers.clear();
    }
  }

  /**
   * Set up event handlers
   */
  private setupEventHandlers(): void {
    // Monitor for performance metrics
    this.on('stateChanged', (data) => {
      const { session, transition } = data;
      const duration = transition.timestamp.getTime() - session.lastStateChange.getTime();
      
      logger.debug(`State transition performance for call ${session.callId}`, {
        transition: `${transition.from} -> ${transition.to}`,
        duration: `${duration}ms`,
        event: transition.event
      });
    });
  }

  /**
   * Get session metrics
   */
  public getSessionMetrics(callId: string): Record<string, any> | null {
    const session = this.sessions.get(callId);
    const transitions = this.stateTransitions.get(callId);

    if (!session || !transitions) return null;

    const sessionDuration = new Date().getTime() - session.sessionStartTime.getTime();
    
    return {
      callId: session.callId,
      currentState: session.currentState,
      sessionDuration,
      bargeInCount: session.bargeInCount,
      averageResponseTime: session.averageResponseTime,
      totalTransitions: transitions.length,
      isUserSpeaking: session.isUserSpeaking,
      isAgentSpeaking: session.isAgentSpeaking,
      lastUserSpeechTime: session.lastUserSpeechTime,
      lastAgentSpeechTime: session.lastAgentSpeechTime,
      responseLatency: session.responseLatency
    };
  }

  /**
   * Get all active sessions
   */
  public getActiveSessions(): CallSessionData[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get state transition history for a call
   */
  public getStateHistory(callId: string): StateTransition[] {
    return this.stateTransitions.get(callId) || [];
  }
}

// Export singleton instance
export const realTimeCallStateMachine = new RealTimeCallStateMachine();
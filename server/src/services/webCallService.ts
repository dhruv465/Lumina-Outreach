import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';
import logger from '../utils/logger';
import webCallMetricsService from './webCallMetricsService';
import webCallDebugService from './webCallDebugService';

/**
 * Interface for web call session options
 */
export interface WebCallOptions {
  campaignId: string;
  userId: string;
  testId?: string;
  initialPrompt?: string;
}

/**
 * Interface for transcript entry
 */
export interface TranscriptEntry {
  speaker: 'agent' | 'user';
  text: string;
  timestamp: Date;
  isFinal: boolean;
}

/**
 * Interface for session metrics
 */
export interface SessionMetrics {
  responseTime: number[];
  userSpeakingTime: number;
  agentSpeakingTime: number;
  interruptions: number;
  speechToTextLatency: number;
  textToSpeechLatency: number;
  llmLatency: number;
  totalTurns: number;
}

/**
 * Interface for web call session state
 */
export type SessionState =
  | 'initializing'   // Session is being created
  | 'connecting'     // Establishing connection
  | 'connected'      // Connection established
  | 'speaking'       // Agent is speaking
  | 'listening'      // Waiting for user input
  | 'processing'     // Processing user input
  | 'paused'         // Session temporarily paused
  | 'ended'          // Session completed normally
  | 'error';         // Session encountered an error

/**
 * Interface for web call session data
 */
export interface WebCallSession {
  id: string;
  campaignId: string;
  userId: string;
  testId?: string;
  status: SessionState;
  startTime: Date;
  endTime?: Date;
  lastActivityTime: Date;
  transcript: TranscriptEntry[];
  metrics: SessionMetrics;
  resources: {
    audioBuffers: Map<string, Buffer>;
    currentSpeaker: 'agent' | 'user' | null;
    speakingStartTime?: Date;
    inactivityTimer?: NodeJS.Timeout;
  };
  config: {
    inactivityTimeout: number;
    maxSessionDuration: number;
    voiceSettings?: {
      voiceId: string;
      stability: number;
      similarity: number;
      speed: number;
      modelId: string;
    };
  };
}

/**
 * Session statistics interface
 */
export interface SessionStatistics {
  totalSessions: number;
  activeSessions: number;
  completedSessions: number;
  errorSessions: number;
  averageSessionDuration: number;
  averageResponseTime: number;
}

/**
 * Service for managing web call testing sessions
 */
export class WebCallService extends EventEmitter {
  private sessions: Map<string, WebCallSession>;
  private readonly DEFAULT_INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  private readonly DEFAULT_MAX_SESSION_DURATION = 30 * 60 * 1000; // 30 minutes
  private readonly SESSION_CLEANUP_INTERVAL = 15 * 60 * 1000; // 15 minutes

  constructor() {
    super();
    this.sessions = new Map();
    logger.info('WebCallService initialized');

    // Set up periodic cleanup
    setInterval(() => {
      this.cleanupOldSessions();
    }, this.SESSION_CLEANUP_INTERVAL);
  }

  /**
   * Create a new web call session
   * @param options Session options including campaignId and userId
   * @returns The created session
   */
  async createSession(options: WebCallOptions): Promise<WebCallSession> {
    const sessionId = uuidv4();
    const now = new Date();

    const session: WebCallSession = {
      id: sessionId,
      campaignId: options.campaignId,
      userId: options.userId,
      testId: options.testId,
      status: 'initializing',
      startTime: now,
      lastActivityTime: now,
      transcript: [],
      metrics: {
        responseTime: [],
        userSpeakingTime: 0,
        agentSpeakingTime: 0,
        interruptions: 0,
        speechToTextLatency: 0,
        textToSpeechLatency: 0,
        llmLatency: 0,
        totalTurns: 0
      },
      resources: {
        audioBuffers: new Map(),
        currentSpeaker: null
      },
      config: {
        inactivityTimeout: this.DEFAULT_INACTIVITY_TIMEOUT,
        maxSessionDuration: this.DEFAULT_MAX_SESSION_DURATION
      }
    };

    // Store the session
    this.sessions.set(sessionId, session);
    logger.info(`Web call session created: ${sessionId} for campaign ${options.campaignId}`);

    // Initialize metrics and debug logs for the session
    webCallMetricsService.initializeMetrics(sessionId);
    webCallDebugService.initializeDebugLogs(sessionId);

    // Log session creation
    webCallDebugService.addLogEntry(
      sessionId,
      'info',
      'WebCallService',
      `Session created for campaign ${options.campaignId}`,
      { userId: options.userId, testId: options.testId }
    );

    // Set up inactivity timer
    this.setupInactivityTimer(sessionId);

    // Set up max duration timer
    this.setupMaxDurationTimer(sessionId);

    // Update session state to connecting
    this.updateSessionState(sessionId, 'connecting');

    // Emit session created event
    this.emit('session:created', {
      sessionId,
      campaignId: options.campaignId,
      userId: options.userId,
      testId: options.testId,
      timestamp: now
    });

    return session;
  }

  /**
   * Update session state with proper state transition
   * @param sessionId The session ID
   * @param newState The new state to transition to
   * @param metadata Optional metadata for the state transition
   */
  async updateSessionState(sessionId: string, newState: SessionState, metadata?: any): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const oldState = session.status;
    const now = new Date();

    // Validate state transition
    const validTransitions: Record<SessionState, SessionState[]> = {
      'initializing': ['connecting', 'error'],
      'connecting': ['connected', 'error', 'ended'],
      'connected': ['listening', 'speaking', 'error', 'ended'],
      'listening': ['processing', 'speaking', 'paused', 'error', 'ended'],
      'speaking': ['listening', 'processing', 'paused', 'error', 'ended'],
      'processing': ['speaking', 'listening', 'error', 'ended'],
      'paused': ['listening', 'speaking', 'ended', 'error'],
      'ended': [],
      'error': ['ended']
    };

    if (!validTransitions[oldState].includes(newState)) {
      logger.warn(`Invalid state transition for session ${sessionId}: ${oldState} -> ${newState}`);
      // Allow the transition anyway but log the warning
    }

    // Update session state
    session.status = newState;
    session.lastActivityTime = now;

    // Reset inactivity timer
    this.resetInactivityTimer(sessionId);

    // Handle state-specific actions
    switch (newState) {
      case 'connected':
        // Session is now fully connected
        break;

      case 'speaking':
        // Agent started speaking
        session.resources.currentSpeaker = 'agent';
        session.resources.speakingStartTime = now;

        // Record turn taking delay if we have metadata with response time
        if (metadata && metadata.responseTime) {
          webCallMetricsService.recordComponentLatency(sessionId, 'totalResponse', metadata.responseTime);
        }
        break;

      case 'listening':
        // If agent was speaking, calculate speaking time
        if (session.resources.currentSpeaker === 'agent' && session.resources.speakingStartTime) {
          const speakingTime = now.getTime() - session.resources.speakingStartTime.getTime();
          session.metrics.agentSpeakingTime += speakingTime;

          // Record agent speaking time in metrics service
          webCallMetricsService.recordSpeechTiming(sessionId, 'agent', speakingTime);
        }
        session.resources.currentSpeaker = null;
        break;

      case 'processing':
        // If user was speaking, calculate speaking time
        if (session.resources.currentSpeaker === 'user' && session.resources.speakingStartTime) {
          const speakingTime = now.getTime() - session.resources.speakingStartTime.getTime();
          session.metrics.userSpeakingTime += speakingTime;

          // Record user speaking time in metrics service
          webCallMetricsService.recordSpeechTiming(sessionId, 'user', speakingTime);

          // Increment turn count
          webCallMetricsService.incrementTurnCount(sessionId);
        }
        session.resources.currentSpeaker = null;
        break;

      case 'ended':
        // Clean up resources
        this.cleanupSessionResources(sessionId);
        session.endTime = now;
        break;

      case 'error':
        // Keep resources for debugging
        break;
    }

    // Emit state change event
    this.emit('session:stateChanged', {
      sessionId,
      oldState,
      newState,
      timestamp: now,
      metadata
    });

    logger.info(`Session ${sessionId} state changed: ${oldState} -> ${newState}`);

    // Log state change in debug service
    webCallDebugService.addLogEntry(
      sessionId,
      'info',
      'StateManager',
      `State changed: ${oldState} -> ${newState}`,
      metadata
    );
  }

  /**
   * Process user audio input
   * @param sessionId The session ID
   * @param audioBuffer Audio buffer from the user
   */
  async processUserAudio(sessionId: string, audioBuffer: Buffer): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Update last activity time
    session.lastActivityTime = new Date();

    // Store audio buffer with unique ID
    const audioId = uuidv4();
    session.resources.audioBuffers.set(audioId, audioBuffer);

    // Update session state if needed
    if (session.status === 'listening' || session.status === 'connected') {
      // If agent was speaking, count as interruption
      if (session.resources.currentSpeaker === 'agent') {
        session.metrics.interruptions++;

        // Record interruption in metrics service
        webCallMetricsService.recordInterruption(sessionId, 'user');
      }

      // User started speaking
      session.resources.currentSpeaker = 'user';
      session.resources.speakingStartTime = new Date();

      await this.updateSessionState(sessionId, 'processing');
    }

    // Emit audio data event for processing
    this.emit('audio:received', {
      sessionId,
      audioId,
      audioSize: audioBuffer.length,
      timestamp: new Date()
    });

    // Reset inactivity timer
    this.resetInactivityTimer(sessionId);
  }

  /**
   * Generate agent response
   * @param sessionId The session ID
   * @param userInput Transcribed user input
   */
  async generateAgentResponse(sessionId: string, userInput: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Update last activity time
    session.lastActivityTime = new Date();

    // Add user input to transcript
    session.transcript.push({
      speaker: 'user',
      text: userInput,
      timestamp: new Date(),
      isFinal: true
    });

    // Increment turn counter
    session.metrics.totalTurns++;

    // Emit transcript updated event
    this.emit('transcript:updated', {
      sessionId,
      transcript: session.transcript,
      lastEntry: {
        speaker: 'user',
        text: userInput
      }
    });

    // Emit user input event for processing
    this.emit('input:received', {
      sessionId,
      input: userInput,
      timestamp: new Date(),
      turnIndex: session.metrics.totalTurns
    });

    // Reset inactivity timer
    this.resetInactivityTimer(sessionId);
  }

  /**
   * Add agent response to the session
   * @param sessionId The session ID
   * @param response Agent response text
   * @param responseTime Time taken to generate the response
   */
  async addAgentResponse(sessionId: string, response: string, responseTime: number): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Update last activity time
    session.lastActivityTime = new Date();

    // Add agent response to transcript
    session.transcript.push({
      speaker: 'agent',
      text: response,
      timestamp: new Date(),
      isFinal: true
    });

    // Update metrics
    session.metrics.responseTime.push(responseTime);
    session.metrics.totalTurns++;

    // Update session state
    await this.updateSessionState(sessionId, 'speaking', { responseTime });

    // Emit transcript updated event
    this.emit('transcript:updated', {
      sessionId,
      transcript: session.transcript,
      lastEntry: {
        speaker: 'agent',
        text: response
      }
    });

    // Emit response event
    this.emit('response:generated', {
      sessionId,
      response,
      responseTime,
      timestamp: new Date(),
      turnIndex: session.metrics.totalTurns
    });

    // Reset inactivity timer
    this.resetInactivityTimer(sessionId);
  }

  /**
   * Update session metrics
   * @param sessionId The session ID
   * @param metricUpdates Metrics to update
   */
  async updateSessionMetrics(sessionId: string, metricUpdates: Partial<SessionMetrics>): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Update metrics
    Object.assign(session.metrics, metricUpdates);

    // Update component latency metrics if provided
    if (metricUpdates.speechToTextLatency) {
      webCallMetricsService.recordComponentLatency(
        sessionId,
        'speechToText',
        metricUpdates.speechToTextLatency
      );
    }

    if (metricUpdates.llmLatency) {
      webCallMetricsService.recordComponentLatency(
        sessionId,
        'llmProcessing',
        metricUpdates.llmLatency
      );
    }

    if (metricUpdates.textToSpeechLatency) {
      webCallMetricsService.recordComponentLatency(
        sessionId,
        'textToSpeech',
        metricUpdates.textToSpeechLatency
      );
    }

    // Emit metrics updated event
    this.emit('metrics:updated', {
      sessionId,
      metrics: session.metrics,
      updates: metricUpdates,
      timestamp: new Date()
    });
  }

  /**
   * End web call session
   * @param sessionId The session ID
   * @returns The completed session
   */
  async endSession(sessionId: string): Promise<WebCallSession> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Update session state
    await this.updateSessionState(sessionId, 'ended');

    // Calculate final metrics
    const avgResponseTime = session.metrics.responseTime.length > 0
      ? session.metrics.responseTime.reduce((sum, time) => sum + time, 0) / session.metrics.responseTime.length
      : 0;

    // Save metrics and logs to database if testId is available
    if (session.testId) {
      await webCallMetricsService.saveMetricsToDatabase(sessionId, session.testId);
      await webCallDebugService.saveLogsToDatabase(sessionId, session.testId);
    }

    // Clean up metrics and logs
    webCallMetricsService.cleanupSessionMetrics(sessionId);
    webCallDebugService.cleanupSessionLogs(sessionId);

    // Log session end
    webCallDebugService.addLogEntry(
      sessionId,
      'info',
      'WebCallService',
      'Session ended',
      {
        duration: session.endTime ? session.endTime.getTime() - session.startTime.getTime() : 0,
        turnCount: session.metrics.totalTurns
      }
    );

    // Emit session ended event
    this.emit('session:ended', {
      sessionId,
      duration: session.endTime ? session.endTime.getTime() - session.startTime.getTime() : 0,
      metrics: {
        ...session.metrics,
        avgResponseTime
      },
      timestamp: new Date()
    });

    return session;
  }

  /**
   * Pause a session
   * @param sessionId The session ID
   * @param reason Reason for pausing
   */
  async pauseSession(sessionId: string, reason: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Only pause if not already ended or in error state
    if (session.status !== 'ended' && session.status !== 'error') {
      await this.updateSessionState(sessionId, 'paused', { reason });
    }
  }

  /**
   * Resume a paused session
   * @param sessionId The session ID
   */
  async resumeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Only resume if paused
    if (session.status === 'paused') {
      await this.updateSessionState(sessionId, 'listening');
    }
  }

  /**
   * Get session by ID
   * @param sessionId The session ID
   * @returns The session or null if not found
   */
  async getSession(sessionId: string): Promise<WebCallSession | null> {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Get all active sessions
   * @returns Array of active sessions
   */
  async getActiveSessions(): Promise<WebCallSession[]> {
    const activeSessions: WebCallSession[] = [];

    for (const session of this.sessions.values()) {
      if (session.status !== 'ended' && session.status !== 'error') {
        activeSessions.push(session);
      }
    }

    return activeSessions;
  }

  /**
   * Get sessions by campaign ID
   * @param campaignId The campaign ID
   * @returns Array of sessions for the campaign
   */
  async getSessionsByCampaign(campaignId: string): Promise<WebCallSession[]> {
    const campaignSessions: WebCallSession[] = [];

    for (const session of this.sessions.values()) {
      if (session.campaignId === campaignId) {
        campaignSessions.push(session);
      }
    }

    return campaignSessions;
  }

  /**
   * Get sessions by user ID
   * @param userId The user ID
   * @returns Array of sessions for the user
   */
  async getSessionsByUser(userId: string): Promise<WebCallSession[]> {
    const userSessions: WebCallSession[] = [];

    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        userSessions.push(session);
      }
    }

    return userSessions;
  }

  /**
   * Handle session error
   * @param sessionId The session ID
   * @param error Error details
   * @param recoverable Whether the error is recoverable
   * @param component Optional component name
   * @param context Optional error context
   */
  async handleSessionError(
    sessionId: string,
    error: Error,
    recoverable: boolean = false,
    component: string = 'WebCallService',
    context?: any
  ): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      logger.error(`Error in non-existent session ${sessionId}: ${error.message}`);
      return;
    }

    // Update session state
    await this.updateSessionState(sessionId, 'error', {
      error: error.message,
      recoverable
    });

    // Report error to debug service
    webCallDebugService.reportError(
      sessionId,
      component,
      error,
      context,
      recoverable
    );

    // Emit error event
    this.emit('session:error', {
      sessionId,
      error: error.message,
      recoverable,
      timestamp: new Date()
    });

    logger.error(`Error in web call session ${sessionId}: ${error.message}`);

    // If error is not recoverable, end the session after a short delay
    if (!recoverable) {
      setTimeout(() => {
        this.endSession(sessionId).catch(err => {
          logger.error(`Failed to end session ${sessionId} after error: ${err.message}`);
        });
      }, 5000);
    }
  }

  /**
   * Set up inactivity timer for a session
   * @param sessionId The session ID
   */
  private setupInactivityTimer(sessionId: string): void {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return;
    }

    // Clear any existing timer
    if (session.resources.inactivityTimer) {
      clearTimeout(session.resources.inactivityTimer);
    }

    // Set up new timer
    session.resources.inactivityTimer = setTimeout(() => {
      this.handleInactiveSession(sessionId);
    }, session.config.inactivityTimeout);
  }

  /**
   * Reset inactivity timer for a session
   * @param sessionId The session ID
   */
  private resetInactivityTimer(sessionId: string): void {
    // Clear and set up a new timer
    this.setupInactivityTimer(sessionId);
  }

  /**
   * Handle inactive session
   * @param sessionId The session ID
   */
  private async handleInactiveSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return;
    }

    // Only handle if session is not already ended or in error state
    if (session.status !== 'ended' && session.status !== 'error') {
      logger.info(`Session ${sessionId} inactive for ${session.config.inactivityTimeout / 1000} seconds, ending`);

      try {
        await this.endSession(sessionId);
      } catch (error) {
        logger.error(`Failed to end inactive session ${sessionId}: ${error.message}`);
      }
    }
  }

  /**
   * Set up max duration timer for a session
   * @param sessionId The session ID
   */
  private setupMaxDurationTimer(sessionId: string): void {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return;
    }

    // Set up timer to end session after max duration
    setTimeout(() => {
      this.handleMaxDurationSession(sessionId);
    }, session.config.maxSessionDuration);
  }

  /**
   * Handle session that reached max duration
   * @param sessionId The session ID
   */
  private async handleMaxDurationSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return;
    }

    // Only handle if session is not already ended or in error state
    if (session.status !== 'ended' && session.status !== 'error') {
      logger.info(`Session ${sessionId} reached max duration of ${session.config.maxSessionDuration / 1000} seconds, ending`);

      try {
        await this.endSession(sessionId);
      } catch (error) {
        logger.error(`Failed to end max duration session ${sessionId}: ${error.message}`);
      }
    }
  }

  /**
   * Clean up session resources
   * @param sessionId The session ID
   */
  private cleanupSessionResources(sessionId: string): void {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return;
    }

    // Clear inactivity timer
    if (session.resources.inactivityTimer) {
      clearTimeout(session.resources.inactivityTimer);
      session.resources.inactivityTimer = undefined;
    }

    // Clear audio buffers to free memory
    session.resources.audioBuffers.clear();

    logger.info(`Cleaned up resources for session ${sessionId}`);
  }

  /**
   * Clean up old sessions
   * Removes sessions that have ended more than 1 hour ago
   */
  cleanupOldSessions(): void {
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    let cleanedCount = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      // Clean up sessions that have ended or errored more than 1 hour ago
      if ((session.status === 'ended' || session.status === 'error') &&
        session.lastActivityTime < oneHourAgo) {
        this.sessions.delete(sessionId);
        cleanedCount++;
      }

      // Also clean up any session that has been inactive for more than 2 hours
      // This is a safety measure for sessions that weren't properly ended
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      if (session.lastActivityTime < twoHoursAgo) {
        this.sessions.delete(sessionId);
        cleanedCount++;
        logger.warn(`Cleaned up abandoned session ${sessionId} due to inactivity`);
      }
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} old web call sessions`);
    }
  }

  /**
   * Get statistics about web call sessions
   * @returns Session statistics
   */
  async getStatistics(): Promise<SessionStatistics> {
    let totalSessions = 0;
    let activeSessions = 0;
    let completedSessions = 0;
    let errorSessions = 0;
    let totalDuration = 0;
    let totalResponseTime = 0;
    let responseTimeCount = 0;

    for (const session of this.sessions.values()) {
      totalSessions++;

      if (session.status !== 'ended' && session.status !== 'error') {
        activeSessions++;
      } else if (session.status === 'ended') {
        completedSessions++;

        // Calculate duration for completed sessions
        if (session.endTime) {
          totalDuration += session.endTime.getTime() - session.startTime.getTime();
        }
      } else if (session.status === 'error') {
        errorSessions++;
      }

      // Calculate response times
      if (session.metrics.responseTime.length > 0) {
        totalResponseTime += session.metrics.responseTime.reduce((sum, time) => sum + time, 0);
        responseTimeCount += session.metrics.responseTime.length;
      }
    }

    return {
      totalSessions,
      activeSessions,
      completedSessions,
      errorSessions,
      averageSessionDuration: completedSessions > 0 ? totalDuration / completedSessions : 0,
      averageResponseTime: responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0
    };
  }

  /**
   * Configure session settings
   * @param sessionId The session ID
   * @param config Configuration options
   */
  async configureSession(sessionId: string, config: Partial<WebCallSession['config']>): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Update configuration
    Object.assign(session.config, config);

    // If inactivity timeout was updated, reset the timer
    if (config.inactivityTimeout !== undefined) {
      this.resetInactivityTimer(sessionId);
    }

    logger.info(`Updated configuration for session ${sessionId}`);
  }

  /**
   * Set voice settings for a session
   * @param sessionId The session ID
   * @param voiceSettings Voice configuration
   */
  async setVoiceSettings(sessionId: string, voiceSettings: WebCallSession['config']['voiceSettings']): Promise<void> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Update voice settings
    session.config.voiceSettings = voiceSettings;

    logger.info(`Updated voice settings for session ${sessionId}`);
  }
}

// Create singleton instance
const webCallService = new WebCallService();

export default webCallService;
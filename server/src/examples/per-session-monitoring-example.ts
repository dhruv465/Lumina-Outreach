/**
 * Example demonstrating per-session connection monitoring functionality
 * 
 * This example shows how to use the enhanced SessionAwareSocketHandler
 * with per-session health tracking, error handling, and state restoration.
 */

import { SessionAwareSocketHandler } from '../utils/SessionAwareSocketHandler';
import { TwilioWebSocketManager } from '../utils/TwilioWebSocketManager';
import * as WebSocket from 'ws';
import logger from '../utils/logger';

/**
 * Example usage of per-session connection monitoring
 */
export class PerSessionMonitoringExample {
  private sessionHandler: SessionAwareSocketHandler;

  constructor() {
    this.sessionHandler = new SessionAwareSocketHandler();
    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for session monitoring
   */
  private setupEventHandlers(): void {
    // Listen for session events
    this.sessionHandler.on('sessionEvent', (event) => {
      logger.info('Session event received:', {
        type: event.type,
        sessionId: event.sessionId,
        timestamp: event.timestamp,
        data: event.data
      });
    });

    // Listen for session health degradation
    this.sessionHandler.on('session_error', (event) => {
      if (event.data?.degradationEvent) {
        logger.warn('Session health degradation detected:', {
          sessionId: event.sessionId,
          degradationType: event.data.degradationEvent.type,
          severity: event.data.degradationEvent.severity,
          recoveryAction: event.data.recoveryAction
        });
      }
    });

    // Listen for session recovery
    this.sessionHandler.on('session_recovered', (event) => {
      logger.info('Session successfully recovered:', {
        sessionId: event.sessionId,
        recoveryStrategy: event.data?.recoveryStrategy,
        healthScore: event.data?.healthScore
      });
    });
  }

  /**
   * Example: Create a session with monitoring
   */
  public async createMonitoredSession(
    sessionId: string,
    callId: string,
    conversationId: string,
    userId?: string
  ): Promise<void> {
    try {
      // Create the session
      const session = this.sessionHandler.createSession(
        sessionId,
        callId,
        conversationId,
        {
          userId,
          preferences: {
            language: 'en',
            audioFormat: 'mp3',
            maxMessageHistory: 50,
            enablePersistence: true,
            adaptiveEnabled: true
          },
          isPersistent: true
        }
      );

      logger.info(`Created session ${sessionId}`, {
        sessionId,
        callId,
        conversationId,
        userId
      });

      // Start connection monitoring
      const monitoringStarted = this.sessionHandler.startConnectionMonitoring(sessionId);
      if (monitoringStarted) {
        logger.info(`Started connection monitoring for session ${sessionId}`);
      } else {
        logger.error(`Failed to start monitoring for session ${sessionId}`);
      }

    } catch (error) {
      logger.error(`Failed to create monitored session ${sessionId}:`, error);
      throw error;
    }
  }

  /**
   * Example: Bind a WebSocket to a session with monitoring
   */
  public async bindSocketWithMonitoring(
    socket: WebSocket,
    sessionId: string
  ): Promise<boolean> {
    try {
      // Create Twilio WebSocket manager
      const twilioManager = new TwilioWebSocketManager(socket, `${sessionId}-connection`);

      // Bind the socket to the session
      const bindResult = this.sessionHandler.bindSession(socket, twilioManager, sessionId);
      
      if (bindResult) {
        logger.info(`Successfully bound socket to session ${sessionId}`);
        
        // Start monitoring if not already started
        this.sessionHandler.startConnectionMonitoring(sessionId);
        
        return true;
      } else {
        logger.error(`Failed to bind socket to session ${sessionId}`);
        return false;
      }

    } catch (error) {
      logger.error(`Error binding socket to session ${sessionId}:`, error);
      return false;
    }
  }

  /**
   * Example: Simulate connection health metrics
   */
  public simulateHealthMetrics(sessionId: string): void {
    // Simulate various health metrics
    const metrics = [
      { type: 'latency' as const, value: 120 },
      { type: 'message' as const, value: 1 },
      { type: 'bytes' as const, value: 1024 },
      { type: 'latency' as const, value: 200 },
      { type: 'message' as const, value: 1 },
      { type: 'bytes' as const, value: 2048 }
    ];

    metrics.forEach((metric, index) => {
      setTimeout(() => {
        const result = this.sessionHandler.recordSessionHealthMetric(sessionId, metric);
        if (result) {
          logger.debug(`Recorded ${metric.type} metric for session ${sessionId}:`, metric);
        }
      }, index * 1000); // Spread over 6 seconds
    });

    // Simulate an error after 3 seconds
    setTimeout(() => {
      this.sessionHandler.recordSessionHealthMetric(sessionId, {
        type: 'error',
        value: 1,
        context: { type: 'network', message: 'Connection timeout' }
      });
      logger.warn(`Simulated network error for session ${sessionId}`);
    }, 3000);
  }

  /**
   * Example: Handle connection degradation
   */
  public simulateConnectionDegradation(sessionId: string): void {
    // Simulate different types of degradation
    const degradationTypes = [
      'latency_spike',
      'error_burst',
      'protocol_violation'
    ] as const;

    degradationTypes.forEach((type, index) => {
      setTimeout(() => {
        const result = this.sessionHandler.handleConnectionDegradation(sessionId, type);
        if (result) {
          logger.warn(`Simulated ${type} degradation for session ${sessionId}`);
        }
      }, (index + 1) * 2000); // Every 2 seconds
    });
  }

  /**
   * Example: Get comprehensive health report
   */
  public getSessionHealthReport(sessionId: string): void {
    const report = this.sessionHandler.getSessionHealthReport(sessionId);
    
    if (report) {
      logger.info(`Health report for session ${sessionId}:`, {
        sessionId: report.sessionId,
        overallHealth: report.overallHealth,
        healthScore: report.connectionHealth.healthScore,
        latency: report.connectionHealth.currentLatency,
        errorRate: report.connectionHealth.errorRate,
        recommendations: report.recommendations,
        alerts: report.alerts.length,
        predictedIssues: report.predictedIssues,
        recoveryCapability: report.recoveryCapability
      });
    } else {
      logger.error(`No health report available for session ${sessionId}`);
    }
  }

  /**
   * Example: Test session recovery
   */
  public async testSessionRecovery(sessionId: string): Promise<void> {
    try {
      // Prepare session for recovery
      const prepareResult = this.sessionHandler.prepareSessionRecovery(sessionId);
      if (prepareResult) {
        logger.info(`Prepared session ${sessionId} for recovery`);
      }

      // Simulate some delay (connection loss)
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Restore session state
      const restoreResult = this.sessionHandler.restoreSessionState(sessionId);
      if (restoreResult) {
        logger.info(`Successfully restored session ${sessionId}`);
      } else {
        logger.error(`Failed to restore session ${sessionId}`);
      }

    } catch (error) {
      logger.error(`Error during session recovery for ${sessionId}:`, error);
    }
  }

  /**
   * Example: Get error handling strategy
   */
  public demonstrateErrorStrategies(sessionId: string): void {
    const errorTypes = ['network', 'protocol', 'session', 'resource'];
    
    errorTypes.forEach(errorType => {
      const strategy = this.sessionHandler.getSessionErrorStrategy(sessionId, errorType);
      logger.info(`Error strategy for ${errorType} errors in session ${sessionId}:`, {
        strategy: strategy.strategy,
        delay: strategy.delay,
        maxAttempts: strategy.maxAttempts,
        fallbackAction: strategy.fallbackAction
      });
    });
  }

  /**
   * Example: Clean up session
   */
  public cleanupSession(sessionId: string): void {
    // Stop monitoring
    this.sessionHandler.stopConnectionMonitoring(sessionId);
    
    // Remove session
    const removeResult = this.sessionHandler.removeSession(sessionId);
    if (removeResult) {
      logger.info(`Successfully cleaned up session ${sessionId}`);
    } else {
      logger.warn(`Session ${sessionId} was not found for cleanup`);
    }
  }

  /**
   * Run a complete example
   */
  public async runCompleteExample(): Promise<void> {
    const sessionId = 'example-session-1';
    const callId = 'example-call-1';
    const conversationId = 'example-conv-1';
    const userId = 'example-user-1';

    try {
      logger.info('Starting per-session monitoring example...');

      // 1. Create monitored session
      await this.createMonitoredSession(sessionId, callId, conversationId, userId);

      // 2. Simulate health metrics
      this.simulateHealthMetrics(sessionId);

      // 3. Wait a bit for metrics to be recorded
      await new Promise(resolve => setTimeout(resolve, 4000));

      // 4. Get health report
      this.getSessionHealthReport(sessionId);

      // 5. Simulate degradation
      this.simulateConnectionDegradation(sessionId);

      // 6. Wait for degradation events
      await new Promise(resolve => setTimeout(resolve, 7000));

      // 7. Get updated health report
      this.getSessionHealthReport(sessionId);

      // 8. Demonstrate error strategies
      this.demonstrateErrorStrategies(sessionId);

      // 9. Test session recovery
      await this.testSessionRecovery(sessionId);

      // 10. Final health report
      this.getSessionHealthReport(sessionId);

      // 11. Clean up
      await new Promise(resolve => setTimeout(resolve, 2000));
      this.cleanupSession(sessionId);

      logger.info('Per-session monitoring example completed successfully');

    } catch (error) {
      logger.error('Error running per-session monitoring example:', error);
    }
  }

  /**
   * Stop the session handler
   */
  public stop(): void {
    this.sessionHandler.stop();
    logger.info('Per-session monitoring example stopped');
  }
}

// Export for use in other modules
export default PerSessionMonitoringExample;

// Example usage (uncomment to run)
/*
async function runExample() {
  const example = new PerSessionMonitoringExample();
  
  try {
    await example.runCompleteExample();
  } catch (error) {
    console.error('Example failed:', error);
  } finally {
    example.stop();
  }
}

// Uncomment to run the example
// runExample();
*/
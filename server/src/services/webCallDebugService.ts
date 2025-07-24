import { EventEmitter } from 'events';
import logger from '../utils/logger';
import WebCallTest from '../models/WebCallTest';
import mongoose from 'mongoose';

/**
 * Interface for debug log entry
 */
export interface DebugLogEntry {
  timestamp: Date;
  level: 'info' | 'warn' | 'error' | 'debug';
  component: string;
  message: string;
  details?: any;
  sessionId: string;
}

/**
 * Interface for error report
 */
export interface ErrorReport {
  timestamp: Date;
  component: string;
  message: string;
  stack?: string;
  context?: any;
  sessionId: string;
  recoverable: boolean;
}

/**
 * Service for debugging web call testing sessions
 */
export class WebCallDebugService extends EventEmitter {
  private logs: Map<string, DebugLogEntry[]>;
  private errors: Map<string, ErrorReport[]>;
  private readonly MAX_LOGS_PER_SESSION = 1000;
  private readonly LOG_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour
  
  constructor() {
    super();
    this.logs = new Map();
    this.errors = new Map();
    
    // Set up periodic cleanup
    setInterval(() => {
      this.cleanupOldLogs();
    }, this.LOG_CLEANUP_INTERVAL);
    
    logger.info('WebCallDebugService initialized');
  }
  
  /**
   * Initialize debug logs for a new session
   * @param sessionId The session ID
   */
  initializeDebugLogs(sessionId: string): void {
    this.logs.set(sessionId, []);
    this.errors.set(sessionId, []);
    
    // Add initial log entry
    this.addLogEntry(sessionId, 'info', 'system', 'Debug logging initialized');
    
    logger.debug(`Initialized debug logs for session ${sessionId}`);
  }
  
  /**
   * Add a log entry
   * @param sessionId The session ID
   * @param level Log level
   * @param component Component name
   * @param message Log message
   * @param details Optional details
   */
  addLogEntry(
    sessionId: string,
    level: DebugLogEntry['level'],
    component: string,
    message: string,
    details?: any
  ): void {
    // Create session logs array if it doesn't exist
    if (!this.logs.has(sessionId)) {
      this.logs.set(sessionId, []);
    }
    
    const sessionLogs = this.logs.get(sessionId)!;
    
    // Add log entry
    const logEntry: DebugLogEntry = {
      timestamp: new Date(),
      level,
      component,
      message,
      details,
      sessionId
    };
    
    // Add to logs array, limiting size
    if (sessionLogs.length >= this.MAX_LOGS_PER_SESSION) {
      sessionLogs.shift(); // Remove oldest log
    }
    sessionLogs.push(logEntry);
    
    // Emit log event
    this.emit('debug:log', logEntry);
    
    // Also log to system logger
    switch (level) {
      case 'info':
        logger.info(`[WebCall:${sessionId}] ${component}: ${message}`);
        break;
      case 'warn':
        logger.warn(`[WebCall:${sessionId}] ${component}: ${message}`);
        break;
      case 'error':
        logger.error(`[WebCall:${sessionId}] ${component}: ${message}`);
        break;
      case 'debug':
        logger.debug(`[WebCall:${sessionId}] ${component}: ${message}`);
        break;
    }
  }
  
  /**
   * Report an error
   * @param sessionId The session ID
   * @param component Component name
   * @param error Error object or message
   * @param context Optional context information
   * @param recoverable Whether the error is recoverable
   */
  reportError(
    sessionId: string,
    component: string,
    error: Error | string,
    context?: any,
    recoverable: boolean = false
  ): void {
    // Create session errors array if it doesn't exist
    if (!this.errors.has(sessionId)) {
      this.errors.set(sessionId, []);
    }
    
    const sessionErrors = this.errors.get(sessionId)!;
    
    // Create error report
    const errorReport: ErrorReport = {
      timestamp: new Date(),
      component,
      message: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      context,
      sessionId,
      recoverable
    };
    
    // Add to errors array
    sessionErrors.push(errorReport);
    
    // Add log entry
    this.addLogEntry(
      sessionId,
      'error',
      component,
      errorReport.message,
      { stack: errorReport.stack, context, recoverable }
    );
    
    // Emit error event
    this.emit('debug:error', errorReport);
    
    // Log to system logger
    logger.error(`[WebCall:${sessionId}] ${component} error: ${errorReport.message}`);
    if (errorReport.stack) {
      logger.error(`[WebCall:${sessionId}] Stack: ${errorReport.stack}`);
    }
  }
  
  /**
   * Get logs for a session
   * @param sessionId The session ID
   * @returns Array of log entries
   */
  getSessionLogs(sessionId: string): DebugLogEntry[] {
    return this.logs.get(sessionId) || [];
  }
  
  /**
   * Get errors for a session
   * @param sessionId The session ID
   * @returns Array of error reports
   */
  getSessionErrors(sessionId: string): ErrorReport[] {
    return this.errors.get(sessionId) || [];
  }
  
  /**
   * Get logs filtered by level
   * @param sessionId The session ID
   * @param level Log level
   * @returns Filtered log entries
   */
  getLogsByLevel(sessionId: string, level: DebugLogEntry['level']): DebugLogEntry[] {
    const logs = this.getSessionLogs(sessionId);
    return logs.filter(log => log.level === level);
  }
  
  /**
   * Get logs filtered by component
   * @param sessionId The session ID
   * @param component Component name
   * @returns Filtered log entries
   */
  getLogsByComponent(sessionId: string, component: string): DebugLogEntry[] {
    const logs = this.getSessionLogs(sessionId);
    return logs.filter(log => log.component === component);
  }
  
  /**
   * Save debug logs to database
   * @param sessionId The session ID
   * @param testId The test ID
   */
  async saveLogsToDatabase(sessionId: string, testId: string): Promise<void> {
    try {
      // Get errors
      const errors = this.getSessionErrors(sessionId);
      
      // If there are errors, update the test record
      if (errors.length > 0) {
        const errorDetails = errors.map(err => ({
          component: err.component,
          message: err.message,
          timestamp: err.timestamp,
          recoverable: err.recoverable
        }));
        
        await WebCallTest.findByIdAndUpdate(testId, {
          $set: {
            status: 'error',
            errorDetails: JSON.stringify(errorDetails)
          }
        });
        
        logger.info(`Saved error logs for session ${sessionId} to test record ${testId}`);
      }
    } catch (error) {
      logger.error(`Failed to save logs for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  
  /**
   * Generate diagnostic information for a session
   * @param sessionId The session ID
   * @returns Diagnostic information
   */
  generateDiagnosticInfo(sessionId: string): Record<string, any> {
    const logs = this.getSessionLogs(sessionId);
    const errors = this.getSessionErrors(sessionId);
    
    // Count logs by level
    const logCounts = {
      info: logs.filter(log => log.level === 'info').length,
      warn: logs.filter(log => log.level === 'warn').length,
      error: logs.filter(log => log.level === 'error').length,
      debug: logs.filter(log => log.level === 'debug').length
    };
    
    // Count logs by component
    const componentCounts: Record<string, number> = {};
    logs.forEach(log => {
      componentCounts[log.component] = (componentCounts[log.component] || 0) + 1;
    });
    
    // Get most recent logs
    const recentLogs = logs.slice(-10);
    
    // Get most recent errors
    const recentErrors = errors.slice(-5);
    
    return {
      sessionId,
      totalLogs: logs.length,
      logCounts,
      componentCounts,
      totalErrors: errors.length,
      recoverableErrors: errors.filter(err => err.recoverable).length,
      criticalErrors: errors.filter(err => !err.recoverable).length,
      recentLogs,
      recentErrors,
      timestamp: new Date()
    };
  }
  
  /**
   * Clean up logs for a session
   * @param sessionId The session ID
   */
  cleanupSessionLogs(sessionId: string): void {
    this.logs.delete(sessionId);
    this.errors.delete(sessionId);
    logger.debug(`Cleaned up logs for session ${sessionId}`);
  }
  
  /**
   * Clean up old logs
   * Removes logs for sessions that haven't been updated in more than 2 hours
   */
  cleanupOldLogs(): void {
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    let cleanedCount = 0;
    
    // Find sessions with old logs
    for (const [sessionId, logs] of this.logs.entries()) {
      if (logs.length > 0) {
        const lastLog = logs[logs.length - 1];
        if (lastLog.timestamp < twoHoursAgo) {
          this.cleanupSessionLogs(sessionId);
          cleanedCount++;
        }
      }
    }
    
    if (cleanedCount > 0) {
      logger.info(`Cleaned up logs for ${cleanedCount} old sessions`);
    }
  }
}

// Create singleton instance
const webCallDebugService = new WebCallDebugService();

export default webCallDebugService;
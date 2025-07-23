/**
 * initializeMetrics.ts
 * Initializes and starts the metrics collection systems
 */

import logger from '../utils/logger';
import { DeepgramModelMetrics } from './deepgramModelMetrics';
import { performanceMonitor } from './performance_metrics';
import { alertSystem } from './alert_system';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Initialize and start all monitoring systems
 */
export function initializeMonitoringSystems(): void {
  try {
    logger.info('Initializing monitoring systems...');
    
    // Ensure metrics directories exist
    ensureMetricsDirectories();
    
    // Start Deepgram model metrics collection
    const deepgramMetrics = DeepgramModelMetrics.getInstance();
    deepgramMetrics.start();
    logger.info('Deepgram model metrics collection started');
    
    // Start performance monitoring
    performanceMonitor.start();
    logger.info('Performance monitoring started');
    
    // Set up cross-system monitoring integrations
    setupMonitoringIntegrations();
    
    logger.info('All monitoring systems initialized successfully');
  } catch (error) {
    logger.error('Failed to initialize monitoring systems:', error);
  }
}

/**
 * Set up integrations between different monitoring systems
 */
function setupMonitoringIntegrations(): void {
  const deepgramMetrics = DeepgramModelMetrics.getInstance();
  
  // Forward Deepgram model metrics reports to performance monitoring
  deepgramMetrics.onReportGenerated((event) => {
    logger.debug('Deepgram metrics report generated', {
      fileName: event.fileName,
      modelCount: event.summary.modelUsage.length,
      fallbackCount: event.summary.fallbacks.length
    });
  });
  
  // Log model fallback events
  deepgramMetrics.onModelFallback((event) => {
    logger.info(`Model fallback: ${event.originalModel} → ${event.fallbackModel}`, {
      originalModel: event.originalModel,
      fallbackModel: event.fallbackModel,
      fallbackSuccess: event.fallbackSuccess,
      errorType: event.errorType,
      timestamp: event.timestamp
    });
  });
  
  // Log account tier detection events
  deepgramMetrics.onAccountTierDetection((event) => {
    logger.info(`Account tier detected: ${event.tier}`, {
      tier: event.tier,
      modelCount: event.availableModels.length,
      capabilityChanged: event.capabilityChanged,
      timestamp: event.timestamp
    });
  });
}

/**
 * Ensure all required metrics directories exist
 */
function ensureMetricsDirectories(): void {
  const directories = [
    './metrics',
    './metrics/deepgram',
    './metrics/deepgram/reports',
    './metrics/performance',
    './logs/alerts'
  ];
  
  for (const dir of directories) {
    if (!fs.existsSync(dir)) {
      try {
        fs.mkdirSync(dir, { recursive: true });
        logger.debug(`Created metrics directory: ${dir}`);
      } catch (error) {
        logger.error(`Failed to create metrics directory ${dir}:`, error);
      }
    }
  }
}

/**
 * Stop all monitoring systems
 */
export function stopMonitoringSystems(): void {
  try {
    // Stop Deepgram model metrics collection
    const deepgramMetrics = DeepgramModelMetrics.getInstance();
    deepgramMetrics.stop();
    logger.info('Deepgram model metrics collection stopped');
    
    // Stop performance monitoring
    performanceMonitor.stop();
    logger.info('Performance monitoring stopped');
    
    logger.info('All monitoring systems stopped successfully');
  } catch (error) {
    logger.error('Failed to stop monitoring systems:', error);
  }
}
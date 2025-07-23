/**
 * deepgramMetricsController.ts
 * Controller for Deepgram model metrics API endpoints
 */

import { Request, Response } from 'express';
import { DeepgramModelMetrics } from '../monitoring/deepgramModelMetrics';
import logger from '../utils/logger';

/**
 * Get Deepgram model metrics summary
 */
export const getMetricsSummary = async (req: Request, res: Response) => {
  try {
    const metrics = DeepgramModelMetrics.getInstance();
    const summary = metrics.getMetricsSummary();
    
    res.status(200).json({
      success: true,
      data: summary
    });
  } catch (error) {
    logger.error('Error retrieving Deepgram metrics summary:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve metrics summary'
    });
  }
};

/**
 * Get model usage metrics
 */
export const getModelUsageMetrics = async (req: Request, res: Response) => {
  try {
    const metrics = DeepgramModelMetrics.getInstance();
    const summary = metrics.getMetricsSummary();
    
    res.status(200).json({
      success: true,
      data: summary.modelUsage
    });
  } catch (error) {
    logger.error('Error retrieving model usage metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve model usage metrics'
    });
  }
};

/**
 * Get model validation metrics
 */
export const getModelValidationMetrics = async (req: Request, res: Response) => {
  try {
    const metrics = DeepgramModelMetrics.getInstance();
    const summary = metrics.getMetricsSummary();
    
    res.status(200).json({
      success: true,
      data: summary.modelValidation
    });
  } catch (error) {
    logger.error('Error retrieving model validation metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve model validation metrics'
    });
  }
};

/**
 * Get fallback metrics
 */
export const getFallbackMetrics = async (req: Request, res: Response) => {
  try {
    const metrics = DeepgramModelMetrics.getInstance();
    const summary = metrics.getMetricsSummary();
    
    res.status(200).json({
      success: true,
      data: summary.fallbacks
    });
  } catch (error) {
    logger.error('Error retrieving fallback metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve fallback metrics'
    });
  }
};

/**
 * Get account tier metrics
 */
export const getAccountTierMetrics = async (req: Request, res: Response) => {
  try {
    const metrics = DeepgramModelMetrics.getInstance();
    const summary = metrics.getMetricsSummary();
    
    res.status(200).json({
      success: true,
      data: summary.accountTier
    });
  } catch (error) {
    logger.error('Error retrieving account tier metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve account tier metrics'
    });
  }
};

/**
 * Get recent alerts
 */
export const getRecentAlerts = async (req: Request, res: Response) => {
  try {
    const metrics = DeepgramModelMetrics.getInstance();
    const summary = metrics.getMetricsSummary();
    
    res.status(200).json({
      success: true,
      data: summary.alerts
    });
  } catch (error) {
    logger.error('Error retrieving recent alerts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve recent alerts'
    });
  }
};

/**
 * Reset metrics (admin only)
 */
export const resetMetrics = async (req: Request, res: Response) => {
  try {
    const metrics = DeepgramModelMetrics.getInstance();
    metrics.resetMetrics();
    
    logger.info('Deepgram metrics reset by admin', {
      userId: req.body.userId || 'unknown',
      reason: req.body.reason || 'manual reset'
    });
    
    res.status(200).json({
      success: true,
      message: 'Metrics reset successfully'
    });
  } catch (error) {
    logger.error('Error resetting Deepgram metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reset metrics'
    });
  }
};

/**
 * Get alert metrics (stub implementation)
 */
export const getAlertMetrics = async (req: Request, res: Response) => {
  try {
    // Stub implementation
    res.status(200).json({
      success: true,
      data: {
        totalAlerts: 0,
        activeAlerts: 0,
        criticalAlerts: 0,
        recentAlerts: []
      }
    });
  } catch (error) {
    logger.error('Error getting alert metrics:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get alert metrics'
    });
  }
};

/**
 * Get performance stats (stub implementation)
 */
export const getPerformanceStats = async (req: Request, res: Response) => {
  try {
    // Stub implementation
    res.status(200).json({
      success: true,
      data: {
        cpuUsage: 25.5,
        memoryUsage: 50.2,
        uptime: 3600,
        requestRate: 100
      }
    });
  } catch (error) {
    logger.error('Error getting performance stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get performance stats'
    });
  }
};

/**
 * Get metrics health (stub implementation)
 */
export const getMetricsHealth = async (req: Request, res: Response) => {
  try {
    // Stub implementation
    res.status(200).json({
      success: true,
      data: {
        status: 'healthy',
        lastUpdate: new Date().toISOString(),
        services: {
          deepgram: 'operational',
          database: 'operational',
          alerts: 'operational'
        }
      }
    });
  } catch (error) {
    logger.error('Error getting metrics health:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get metrics health'
    });
  }
};
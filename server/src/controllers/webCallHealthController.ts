/**
 * WebCallHealthController
 * 
 * Provides health check endpoints for web call services and components
 */

import { Request, Response } from 'express';
import webCallCircuitBreaker from '../services/webCallCircuitBreaker';
import webCallResponsePipeline from '../services/webCallResponsePipeline';
import webCallService from '../services/webCallService';
import logger from '../utils/logger';

/**
 * Get health status of web call services
 */
export const getWebCallHealth = async (req: Request, res: Response): Promise<Response> => {
  try {
    // Get circuit breaker health
    const circuitHealth = webCallCircuitBreaker.getAllCircuitHealth();
    
    // Get pipeline health
    const pipelineHealth = webCallResponsePipeline.getPipelineHealth();
    
    // Get service statistics
    const serviceStats = await webCallService.getStatistics();
    
    // Determine overall health status
    const hasOpenCircuits = circuitHealth.some(circuit => circuit.state === 'open');
    const hasErrors = serviceStats.errorSessions > 0;
    
    const healthStatus = {
      status: hasOpenCircuits ? 'degraded' : (hasErrors ? 'warning' : 'healthy'),
      timestamp: new Date(),
      components: {
        circuits: circuitHealth,
        pipeline: pipelineHealth,
        service: serviceStats
      },
      recommendations: []
    };
    
    // Add recommendations based on health status
    if (hasOpenCircuits) {
      const openCircuits = circuitHealth.filter(circuit => circuit.state === 'open');
      openCircuits.forEach(circuit => {
        healthStatus.recommendations.push({
          component: circuit.serviceType,
          action: 'Check service availability and credentials',
          priority: 'high'
        });
      });
    }
    
    if (hasErrors) {
      healthStatus.recommendations.push({
        component: 'webCallService',
        action: 'Review error logs for failed sessions',
        priority: 'medium'
      });
    }
    
    return res.status(200).json(healthStatus);
  } catch (error) {
    logger.error(`Error getting web call health: ${error.message}`);
    return res.status(500).json({ 
      error: 'Failed to get web call health',
      details: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Reset circuit breaker for a specific service
 */
export const resetCircuitBreaker = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { serviceId } = req.params;
    
    if (!serviceId) {
      return res.status(400).json({ error: 'Service ID is required' });
    }
    
    // Get user ID from authenticated request
    const userId = (req as any).user?._id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Reset the circuit breaker
    webCallCircuitBreaker.forceReset(serviceId, 'admin-reset');
    
    logger.info(`Circuit breaker for ${serviceId} reset by user ${userId}`);
    
    return res.status(200).json({
      success: true,
      message: `Circuit breaker for ${serviceId} reset successfully`,
      currentState: webCallCircuitBreaker.getCircuitState(serviceId)
    });
  } catch (error) {
    logger.error(`Error resetting circuit breaker: ${error.message}`);
    return res.status(500).json({ 
      error: 'Failed to reset circuit breaker',
      details: error instanceof Error ? error.message : String(error)
    });
  }
};

/**
 * Get detailed health status for a specific service
 */
export const getServiceHealth = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { serviceId } = req.params;
    
    if (!serviceId) {
      return res.status(400).json({ error: 'Service ID is required' });
    }
    
    // Get circuit health
    const circuitHealth = webCallCircuitBreaker.getCircuitHealth(serviceId);
    
    if (!circuitHealth) {
      return res.status(404).json({ error: `Service ${serviceId} not found` });
    }
    
    return res.status(200).json(circuitHealth);
  } catch (error) {
    logger.error(`Error getting service health: ${error.message}`);
    return res.status(500).json({ 
      error: 'Failed to get service health',
      details: error instanceof Error ? error.message : String(error)
    });
  }
};
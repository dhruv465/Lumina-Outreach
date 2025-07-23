import { Request, Response } from 'express';
import logger from '../utils/logger';
import webCallDebugService from '../services/webCallDebugService';
import webCallService from '../services/webCallService';
import { EnhancedErrorHandlingService } from '../services/enhancedErrorHandling';
import WebCallTest from '../models/WebCallTest';

const enhancedErrorHandling = new EnhancedErrorHandlingService();

/**
 * Get debug logs for a web call session
 */
export const getSessionLogs = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { sessionId } = req.params;
    const { level, component } = req.query;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    // Get user ID from authenticated request
    const userId = (req as any).user?._id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Get the session
    const session = await webCallService.getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Verify the user owns this session
    if (session.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to access this session' });
    }
    
    // Get logs based on filters
    let logs;
    if (level && typeof level === 'string') {
      logs = webCallDebugService.getLogsByLevel(sessionId, level as any);
    } else if (component && typeof component === 'string') {
      logs = webCallDebugService.getLogsByComponent(sessionId, component);
    } else {
      logs = webCallDebugService.getSessionLogs(sessionId);
    }
    
    return res.status(200).json({
      success: true,
      sessionId,
      logs
    });
  } catch (error) {
    logger.error(`Error getting session logs: ${error.message}`);
    return res.status(500).json({ 
      error: 'Failed to get session logs',
      details: enhancedErrorHandling.generateDetailedErrorMessage(error, '', undefined)
    });
  }
};

/**
 * Get errors for a web call session
 */
export const getSessionErrors = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    // Get user ID from authenticated request
    const userId = (req as any).user?._id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Get the session
    const session = await webCallService.getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Verify the user owns this session
    if (session.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to access this session' });
    }
    
    // Get errors
    const errors = webCallDebugService.getSessionErrors(sessionId);
    
    return res.status(200).json({
      success: true,
      sessionId,
      errors
    });
  } catch (error) {
    logger.error(`Error getting session errors: ${error.message}`);
    return res.status(500).json({ 
      error: 'Failed to get session errors',
      details: enhancedErrorHandling.generateDetailedErrorMessage(error, '', undefined)
    });
  }
};

/**
 * Get diagnostic information for a web call session
 */
export const getDiagnosticInfo = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { sessionId } = req.params;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    // Get user ID from authenticated request
    const userId = (req as any).user?._id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Get the session
    const session = await webCallService.getSession(sessionId);
    
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Verify the user owns this session
    if (session.userId !== userId) {
      return res.status(403).json({ error: 'Not authorized to access this session' });
    }
    
    // Generate diagnostic information
    const diagnosticInfo = webCallDebugService.generateDiagnosticInfo(sessionId);
    
    return res.status(200).json({
      success: true,
      sessionId,
      diagnosticInfo
    });
  } catch (error) {
    logger.error(`Error getting diagnostic info: ${error.message}`);
    return res.status(500).json({ 
      error: 'Failed to get diagnostic info',
      details: enhancedErrorHandling.generateDetailedErrorMessage(error, '', undefined)
    });
  }
};

/**
 * Get debug information for a completed test
 */
export const getTestDebugInfo = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { testId } = req.params;
    
    if (!testId) {
      return res.status(400).json({ error: 'Test ID is required' });
    }
    
    // Get user ID from authenticated request
    const userId = (req as any).user?._id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Get the test
    const test = await WebCallTest.findById(testId);
    
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }
    
    // Verify the user owns this test
    if (test.userId.toString() !== userId) {
      return res.status(403).json({ error: 'Not authorized to access this test' });
    }
    
    // Get error details if available
    let errorDetails = [];
    if (test.errorDetails) {
      try {
        errorDetails = JSON.parse(test.errorDetails);
      } catch (parseError) {
        logger.error(`Error parsing test error details: ${parseError.message}`);
      }
    }
    
    return res.status(200).json({
      success: true,
      testId,
      status: test.status,
      errorDetails,
      metrics: test.metrics
    });
  } catch (error) {
    logger.error(`Error getting test debug info: ${error.message}`);
    return res.status(500).json({ 
      error: 'Failed to get test debug info',
      details: enhancedErrorHandling.generateDetailedErrorMessage(error, '', undefined)
    });
  }
};

export default {
  getSessionLogs,
  getSessionErrors,
  getDiagnosticInfo,
  getTestDebugInfo
};
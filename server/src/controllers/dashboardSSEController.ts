import { FastifyRequest, FastifyReply } from 'fastify';
import { logger } from '../index';
import Call from '../models/Call';
import EventEmitter from 'events';

// Global event emitter for real-time call monitoring
export const dashboardEventEmitter = new EventEmitter();

// Set high limit for event listeners
dashboardEventEmitter.setMaxListeners(100);

/**
 * Sets up server-sent events for real-time dashboard updates
 * Uses EventSource on the client side to maintain persistent connection
 * Transmits metrics, states, and updates in near real-time (sub-second)
 */
export const setupDashboardSSE = (req: FastifyRequest, res: FastifyReply): void => {
  const clientId = (req.query as any).clientId as string;
  
  if (!clientId) {
    logger.error('Missing clientId for dashboard SSE connection');
    res.status(400).send({ error: 'Missing clientId parameter' });
    return;
  }
  
  // Set headers for SSE
  res.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Important for Nginx proxy setups
  });
  
  // Send initial connection message
  res.raw.write(`data: ${JSON.stringify({ event: 'connected', clientId })}\n\n`);
  
  // Helper function to send SSE events
  const sendEvent = (event: string, data: any) => {
    if (res.raw.closed) return;
    res.raw.write(`event: ${event}\n`);
    res.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  // Send system status every 5 seconds
  const systemStatusInterval = setInterval(() => {
    sendEvent('system_status', {
      timestamp: new Date().toISOString(),
      activeCalls: 0, // Replace with actual count
      cpuUsage: 0, // Replace with actual metrics
      memoryUsage: 0, // Replace with actual metrics
      apiLatency: 0 // Replace with actual metrics
    });
  }, 5000);
  
  // Listen for real-time call events
  const handleCallUpdate = (data: any) => {
    sendEvent('call_update', data);
  };
  
  const handleCallMetrics = (data: any) => {
    sendEvent('call_metrics', data);
  };
  
  const handleTranscript = (data: any) => {
    sendEvent('transcript', data);
  };
  
  const handleEmotion = (data: any) => {
    sendEvent('emotion', data);
  };
  
  const handleAlert = (data: any) => {
    sendEvent('alert', data);
  };
  
  // Register event listeners
  dashboardEventEmitter.on('call_update', handleCallUpdate);
  dashboardEventEmitter.on('call_metrics', handleCallMetrics);
  dashboardEventEmitter.on('transcript', handleTranscript);
  dashboardEventEmitter.on('emotion', handleEmotion);
  dashboardEventEmitter.on('alert', handleAlert);
  
  // Handle client disconnect
  req.raw.on('close', () => {
    logger.info(`Dashboard SSE connection closed for client ${clientId}`);
    clearInterval(systemStatusInterval);
    
    // Remove event listeners
    dashboardEventEmitter.off('call_update', handleCallUpdate);
    dashboardEventEmitter.off('call_metrics', handleCallMetrics);
    dashboardEventEmitter.off('transcript', handleTranscript);
    dashboardEventEmitter.off('emotion', handleEmotion);
    dashboardEventEmitter.off('alert', handleAlert);
  });
};

/**
 * Emit a call update event to all connected dashboard clients
 */
export const emitCallUpdate = (callId: string, data: any): void => {
  dashboardEventEmitter.emit('call_update', {
    callId,
    timestamp: new Date().toISOString(),
    ...data
  });
};

/**
 * Emit call metrics to all connected dashboard clients
 */
export const emitCallMetrics = (callId: string, metrics: any): void => {
  dashboardEventEmitter.emit('call_metrics', {
    callId,
    timestamp: new Date().toISOString(),
    metrics
  });
};

/**
 * Emit transcript updates to all connected dashboard clients
 */
export const emitTranscript = (callId: string, transcript: any): void => {
  dashboardEventEmitter.emit('transcript', {
    callId,
    timestamp: new Date().toISOString(),
    transcript
  });
};

/**
 * Emit emotion detection to all connected dashboard clients
 */
export const emitEmotion = (callId: string, emotion: any): void => {
  dashboardEventEmitter.emit('emotion', {
    callId,
    timestamp: new Date().toISOString(),
    emotion
  });
};

/**
 * Emit alert events to all connected dashboard clients
 */
export const emitAlert = (type: string, message: string, data: any = {}): void => {
  dashboardEventEmitter.emit('alert', {
    type,
    message,
    timestamp: new Date().toISOString(),
    ...data
  });
};

/**
 * Get active calls for the dashboard
 */
export const getActiveCalls = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const calls = await Call.find({
      status: { $in: ['dialing', 'in-progress'] }
    })
    .populate('leadId', 'firstName lastName phone email')
    .populate('campaignId', 'name')
    .sort({ startTime: -1 })
    .limit(10);
    
    res.send({
      success: true,
      activeCalls: calls.map(call => ({
        id: call._id,
        status: call.status,
        phoneNumber: call.phoneNumber,
        startTime: call.startTime,
        duration: call.duration || 0,
        leadName: (call.leadId as any) ? `${(call.leadId as any).firstName} ${(call.leadId as any).lastName}` : 'Unknown',
        campaignName: (call.campaignId as any) ? (call.campaignId as any).name : 'Unknown',
        metrics: call.metrics || {}
      }))
    });
  } catch (error) {
    logger.error(`Error getting active calls: ${error}`);
    res.status(500).send({ success: false, error: 'Failed to retrieve active calls' });
  }
};

/**
 * Get detailed call monitoring data
 */
export const getCallMonitoringData = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const { callId } = req.params as any;
    
    const call = await Call.findById(callId)
      .populate('leadId', 'firstName lastName phone email')
      .populate('campaignId', 'name objective script');
    
    if (!call) {
      res.status(404).send({ success: false, error: 'Call not found' });
      return;
    }
    
    res.send({
      success: true,
      call: {
        id: call._id,
        status: call.status,
        phoneNumber: call.phoneNumber,
        startTime: call.startTime,
        endTime: call.endTime,
        duration: call.duration || 0,
        leadInfo: call.leadId,
        campaignInfo: call.campaignId,
        conversationLog: call.conversationLog || [],
        metrics: call.metrics || {},
        customerInteraction: call.customerInteraction || {}
      }
    });
  } catch (error) {
    logger.error(`Error getting call monitoring data: ${error}`);
    res.status(500).send({ success: false, error: 'Failed to retrieve call monitoring data' });
  }
};

/**
 * Get real-time analytics dashboard data for a client
 */
export const getRealTimeAnalytics = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Get calls for today
    const todaysCalls = await Call.find({
      startTime: { $gte: today }
    }).lean();
    
    // Calculate metrics
    const totalCalls = todaysCalls.length;
    const completedCalls = todaysCalls.filter(call => call.status === 'completed').length;
    const failedCalls = todaysCalls.filter(call => call.status === 'failed').length;
    const inProgressCalls = todaysCalls.filter(call => call.status === 'in-progress').length;
    
    const avgDuration = todaysCalls.length > 0 
      ? todaysCalls.reduce((sum, call) => sum + (call.duration || 0), 0) / todaysCalls.length 
      : 0;
      
    // Calculate conversion metrics  
    const convertedCalls = todaysCalls.filter(call => 
      call.status === 'completed' && 
      ['positive', 'interested', 'converted'].includes(call.outcome || '')
    ).length;
    
    const conversionRate = completedCalls > 0 ? (convertedCalls / completedCalls) * 100 : 0;
    
    // Get quality metrics
    const qualityScores = todaysCalls
      .filter(call => call.metrics?.qualityScore !== undefined)
      .map(call => call.metrics!.qualityScore);
      
    const avgQualityScore = qualityScores.length > 0
      ? qualityScores.reduce((sum, score) => sum + score, 0) / qualityScores.length
      : 0;
      
    // Calculate hourly breakdown  
    const hourlyBreakdown = Array(24).fill(0).map(() => ({ hour: 0, count: 0 }));
    
    todaysCalls.forEach(call => {
      const hour = new Date(call.startTime).getHours();
      hourlyBreakdown[hour].hour = hour;
      hourlyBreakdown[hour].count++;
    });
    
    // Get emotion distribution
    const emotionDistribution: Record<string, number> = {
      positive: 0,
      negative: 0,
      neutral: 0,
      confused: 0,
      interested: 0
    };
    
    todaysCalls.forEach(call => {
      if (call.customerInteraction?.primaryEmotion) {
        const emotion = call.customerInteraction.primaryEmotion;
        emotionDistribution[emotion] = (emotionDistribution[emotion] || 0) + 1;
      }
    });
    
    res.send({
      success: true,
      timestamp: new Date().toISOString(),
      metrics: {
        totalCalls,
        completedCalls,
        failedCalls,
        inProgressCalls,
        avgDuration: Math.round(avgDuration),
        conversionRate: parseFloat(conversionRate.toFixed(2)),
        avgQualityScore: parseFloat(avgQualityScore.toFixed(2))
      },
      hourlyBreakdown,
      emotionDistribution,
      activeCalls: inProgressCalls
    });
  } catch (error) {
    logger.error(`Error getting real-time analytics: ${error}`);
    res.status(500).send({ success: false, error: 'Failed to retrieve real-time analytics' });
  }
};

/**
 * Sets up server-sent events for predictive analytics updates
 */
export const setupPredictiveAnalyticsSSE = (req: FastifyRequest, res: FastifyReply): void => {
  const clientId = (req.query as any).clientId as string;
  
  if (!clientId) {
    logger.error('Missing clientId for predictive analytics SSE connection');
    res.status(400).send({ error: 'Missing clientId parameter' });
    return;
  }
  
  // Set headers for SSE
  res.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  
  // Send initial connection message
  res.raw.write(`data: ${JSON.stringify({ event: 'connected', clientId })}\n\n`);
  
  // Helper function to send SSE events
  const sendEvent = (event: string, data: any) => {
    if (res.raw.closed) return;
    res.raw.write(`event: ${event}\n`);
    res.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  
  // Send prediction updates every 30 seconds
  const predictionInterval = setInterval(async () => {
    try {
      // Get active calls
      const activeCalls = await Call.find({
        status: 'in-progress'
      }).lean();
      
      // Calculate predictions for each call
      const predictions = await Promise.all(activeCalls.map(async (call) => {
        // Simple prediction model
        // In a real implementation, this would use a trained ML model
        const conversationDuration = call.duration || 0;
        const emotionIndicator = call.customerInteraction?.primaryEmotion || 'neutral';
        const interruptionsCount = call.metrics?.interruptions || 0;
        const scriptAdherence = call.metrics?.scriptAdherence || 80;
        
        // Simplified logistic model
        let conversionProbability = 0.5; // Base probability
        
        // Adjust based on duration (longer calls up to a point are better)
        if (conversationDuration > 120 && conversationDuration < 600) {
          conversionProbability += 0.1;
        } else if (conversationDuration > 600) {
          conversionProbability -= 0.05;
        }
        
        // Adjust based on emotion
        if (emotionIndicator === 'positive' || emotionIndicator === 'interested') {
          conversionProbability += 0.15;
        } else if (emotionIndicator === 'negative') {
          conversionProbability -= 0.2;
        }
        
        // Adjust based on interruptions
        if (interruptionsCount > 5) {
          conversionProbability -= 0.1;
        }
        
        // Adjust based on script adherence
        conversionProbability += (scriptAdherence - 80) * 0.005;
        
        // Ensure probability is between 0 and 1
        conversionProbability = Math.max(0, Math.min(1, conversionProbability));
        
        return {
          callId: call._id,
          timestamp: new Date().toISOString(),
          conversionProbability: parseFloat(conversionProbability.toFixed(2)),
          estimatedDuration: Math.round(conversationDuration * 1.2), // Simple projection
          riskFactors: [
            interruptionsCount > 5 ? 'high_interruptions' : null,
            emotionIndicator === 'negative' ? 'negative_sentiment' : null,
            scriptAdherence < 70 ? 'low_script_adherence' : null
          ].filter(Boolean)
        };
      }));
      
      sendEvent('predictions', { predictions });
    } catch (error) {
      logger.error(`Error generating predictions: ${error}`);
    }
  }, 30000);
  
  // Handle client disconnect
  req.raw.on('close', () => {
    logger.info(`Predictive analytics SSE connection closed for client ${clientId}`);
    clearInterval(predictionInterval);
  });
};

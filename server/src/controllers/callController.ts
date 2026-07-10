import { FastifyRequest, FastifyReply } from 'fastify';
import callService from '../services/callService';
import { handleError } from '../utils/errorHandling';


import logger from '../utils/logger';

export const initiateCall = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const { leadId, campaignId, scheduleTime, notes } = req.body as any;
    const call = await callService.initiateCall(leadId, campaignId, scheduleTime, notes);
    res.status(201).send({ message: 'Call initiated successfully', call });
  } catch (error) {
    res.status(500).send({ message: 'Failed to initiate call', error: handleError(error) });
  }
};

// Rest of the controller methods remain the same...
export const getCallHistory = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const result = await callService.getCallHistory(req.query);
    return res.status(200).send(result);
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: handleError(error) });
  }
};

export const getCallById = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const call = await callService.getCallById((req.params as any).id);
    if (!call) {
      return res.status(404).send({ message: 'Call not found' });
    }
    return res.status(200).send({ call });
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: (error as Error).message });
  }
};

export const getCallRecording = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const callId = (req.params as any).id;
    logger.info(`[Recording] Request for call ${callId}, user=${(req as any).user?.email || 'unknown'}`);
    
    const recordingUrl = await callService.getCallRecording(callId);
    
    if (!recordingUrl) {
      logger.info(`[Recording] No recording URL found for call ${callId}`);
      return res.status(404).send({ message: 'No recording available for this call' });
    }
    
    logger.info(`[Recording] Found recording URL for call ${callId}: ${recordingUrl.substring(0, 50)}...`);
    
    // Default behavior: return JSON with recording URL
    logger.info(`[Recording] Returning JSON response with URL for call ${callId}`);
    return res.status(200).send({ recordingUrl });
  } catch (error) {
    logger.error(`[Recording] Server error:`, error);
    return res.status(500).send({ message: 'Server error', error: (error as Error).message });
  }
};

export const getCallTranscript = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const transcript = await callService.getCallTranscript((req.params as any).id);
    if (!transcript) {
      return res.status(404).send({ message: 'No transcript available for this call' });
    }
    return res.status(200).send(transcript);
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: (error as Error).message });
  }
};

export const scheduleCallback = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const { dateTime, notes } = req.body as any;
    const callback = await callService.scheduleCallback((req.params as any).id, new Date(dateTime), notes);
    return res.status(200).send({ message: 'Callback scheduled successfully', callback });
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: (error as Error).message });
  }
};

export const getCallAnalytics = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const { campaignId, startDate, endDate } = req.query as any;
    const analytics = await callService.getCallAnalytics(campaignId, startDate, endDate);
    return res.status(200).send(analytics);
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: (error as Error).message });
  }
};

export const exportCalls = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const result = await callService.exportCalls(req.query);
    if (result.format === 'csv') {
      res.header('Content-Type', 'text/csv');
      res.header('Content-Disposition', 'attachment; filename=calls-export.csv');
      return res.status(200).send(result.data);
    } else {
      return res.status(200).send({ calls: result.data });
    }
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: (error as Error).message });
  }
};
export const getCallRecordingDetails = async (req: FastifyRequest, res: FastifyReply): Promise<any> => {
  try {
    const details = await callService.getCallRecordingDetails((req.params as any).id);
    if (!details) {
      return res.status(404).send({ message: 'No recording details found for this call' });
    }
    return res.status(200).send({ success: true, recording: details });
  } catch (error) {
    return res.status(500).send({ message: 'Server error', error: (error as Error).message });
  }
};

import { FastifyRequest, FastifyReply } from 'fastify';
import callService from '../services/callService';
import { handleError } from '../utils/errorHandling';


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
    const { stream } = req.query as any;
    
    console.log(`[Recording] Request for call ${callId}, stream=${stream}, user=${(req as any).user?.email || 'unknown'}`);
    
    const recordingUrl = await callService.getCallRecording(callId);
    
    if (!recordingUrl) {
      console.log(`[Recording] No recording URL found for call ${callId}`);
      return res.status(404).send({ message: 'No recording available for this call' });
    }
    
    console.log(`[Recording] Found recording URL for call ${callId}: ${recordingUrl.substring(0, 50)}...`);
    
    // If stream=true, fetch and stream the audio from Twilio
    if (stream === 'true') {
      try {
        console.log(`[Recording] Streaming audio from Twilio for call ${callId}`);
        
        // Get Twilio credentials from configuration
        const Configuration = require('../models/Configuration').default;
        const config = await Configuration.findOne();
        
        if (!config || !config.twilioConfig || !config.twilioConfig.accountSid || !config.twilioConfig.authToken) {
          console.error(`[Recording] Twilio credentials not configured`);
          return res.status(500).send({ 
            message: 'Twilio credentials not configured' 
          });
        }
        
        const { accountSid, authToken } = config.twilioConfig;
        
        // Create Basic Auth header for Twilio
        const authString = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
        
        // Import fetch if not available globally
        const fetch = globalThis.fetch || (await import('node-fetch')).default;
        
        // Modify the URL to request MP3 format instead of WAV
        // Twilio allows format conversion by appending .mp3 to the URL
        let fetchUrl = recordingUrl;
        if (!recordingUrl.endsWith('.mp3') && !recordingUrl.includes('.mp3?')) {
          // Add .mp3 extension to get MP3 format from Twilio
          fetchUrl = recordingUrl.replace(/(\?|$)/, '.mp3$1');
        }
        
        // Fetch the recording from Twilio with authentication
        console.log(`[Recording] Fetching from Twilio with authentication (format: MP3)`);
        const response = await fetch(fetchUrl, {
          headers: {
            'Authorization': `Basic ${authString}`
          }
        });
        
        if (!response.ok) {
          console.error(`[Recording] Twilio returned ${response.status} for call ${callId}`);
          return res.status(response.status).send({ 
            message: 'Failed to fetch recording from Twilio',
            status: response.status,
            statusText: response.statusText
          });
        }
        
        // Get the content type from Twilio's response
        const contentType = response.headers.get('content-type') || 'audio/mpeg';
        console.log(`[Recording] Twilio content-type: ${contentType}, streaming to client`);
        
        // Stream the audio back to the client with proper headers for WaveSurfer
        res.header('Content-Type', 'audio/mpeg'); // Force MP3 content type for better compatibility
        res.header('Accept-Ranges', 'bytes');
        res.header('Cache-Control', 'public, max-age=3600');
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
        res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        
        // Convert the response to a buffer and send it
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        console.log(`[Recording] Sending ${buffer.length} bytes to client for call ${callId}`);
        return res.send(buffer);
      } catch (streamError) {
        console.error(`[Recording] Error streaming for call ${callId}:`, streamError);
        return res.status(500).send({ 
          message: 'Failed to stream recording', 
          error: (streamError as Error).message 
        });
      }
    }
    
    // Default behavior: return JSON with recording URL
    console.log(`[Recording] Returning JSON response with URL for call ${callId}`);
    return res.status(200).send({ recordingUrl });
  } catch (error) {
    console.error(`[Recording] Server error:`, error);
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
export const syncTwilioRecordings = async (req: FastifyRequest & { user?: any }, res: FastifyReply): Promise<any> => {
  try {
    const { days } = req.body as any;
    const result = await callService.syncTwilioRecordings(days);
    return res.status(200).send({ success: true, message: `Successfully synced ${result.matchedRecordings} recordings`, data: result });
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
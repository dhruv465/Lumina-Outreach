import { FastifyInstance } from 'fastify';
import {
  handleTwilioVoiceWebhook,
  handleTwilioStatusWebhook,
  handleTwilioGatherWebhook,
  handleTwilioStreamWebhook
} from '../services/webhookHandlers';
import {
  handleVoiceWebhook,
  handleStatusWebhook,
  handleRecordingWebhook
} from '../controllers/telephonyController';

const rootWebhookRoutes = async (fastify, opts: Record<string, any>) => {
  // Root webhook handler - will process incoming Twilio webhooks at the root path
  fastify.post('/', async (request, reply) => {
    const webhookType = (request.query as any).webhookType as string || '';
    
    // Log incoming webhook for debugging - sanitized to avoid PII exposure
    const sanitizedLogData = {
      webhookType,
      path: request.url,
      url: request.url,
      query: request.query,
      // Include only non-sensitive metadata from body
      metadata: {
        CallSid: (request.body as any).CallSid,
        CallStatus: (request.body as any).CallStatus,
        AnsweredBy: (request.body as any).AnsweredBy,
        Direction: (request.body as any).Direction,
        // Mask phone numbers for privacy
        From: (request.body as any).From ? (request.body as any).From.replace(/(\+1)(\d{3})(\d{3})(\d{4})/, '$1$2***$4') : undefined,
        To: (request.body as any).To ? (request.body as any).To.replace(/(\+1)(\d{3})(\d{3})(\d{4})/, '$1$2***$4') : undefined,
        Level: (request.body as any).Level,
        AccountSid: (request.body as any).AccountSid
      }
    };
    
    console.log(`Received webhook at root path with type: ${webhookType}`, sanitizedLogData);

    // Check for Twilio system notifications first
    if ((request.body as any).Level && (request.body as any).Payload && (request.body as any).AccountSid) {
      // This is a Twilio system notification (error/warning)
      const payload = JSON.parse((request.body as any).Payload || '{}');
      const level = (request.body as any).Level;
      const errorCode = payload.error_code;
      
      console.log(`Twilio system notification received:`, {
        level,
        errorCode,
        resourceSid: payload.resource_sid,
        serviceSid: payload.service_sid
      });
      
      // Log the notification with appropriate handling for specific error codes
      if (level === 'ERROR') {
        // Handle specific error codes
        if (errorCode === '31924') {
          console.error(`Twilio Error 31924: WebSocket connection failed for resource ${payload.resource_sid}`);
          console.error('This error is typically caused by:');
          console.error('1. Malformed WebSocket messages or protocol violations');
          console.error('2. Fragmented WebSocket control frames');
          console.error('3. Duplicated .websocket paths in the URL');
          console.error('4. Non-compliant message formatting');
          
          // Log additional diagnostic information
          console.error('Diagnostic info:', {
            resourceSid: payload.resource_sid,
            serviceSid: payload.service_sid,
            timestamp: new Date().toISOString(),
            possibleCause: 'WebSocket URL duplication or protocol violation'
          });
        } else {
          console.error(`Twilio error notification: ${errorCode} for resource ${payload.resource_sid}`);
        }
      } else if (level === 'WARNING') {
        // Handle specific warning codes
        if (errorCode === '31951') {
          console.warn(`Twilio warning 31951: WebSocket connection issue for resource ${payload.resource_sid} - this is usually not critical`);
        } else {
          console.warn(`Twilio warning notification: ${errorCode} for resource ${payload.resource_sid}`);
        }
      }
      
      // Return success for system notifications
      return reply.code(200).send({ message: 'System notification received' });
    }

    // Route to appropriate handler based on webhookType query parameter
    switch (webhookType) {
      case 'voice':
        return handleTwilioVoiceWebhook(request, reply);
      case 'status':
        return handleTwilioStatusWebhook(request, reply);
      case 'gather':
        return handleTwilioGatherWebhook(request, reply);
      
      case 'recording':
        return handleTwilioStatusWebhook(request, reply);
      case 'telephony-voice':
        return handleVoiceWebhook(request, reply);
      case 'telephony-status':
        return handleStatusWebhook(request, reply);
      case 'telephony-recording':
        return handleRecordingWebhook(request, reply);
      default:
        // If no webhook type is specified, try to determine from body
        if ((request.body as any).CallSid) {
          // This is likely a Twilio webhook
          // Default to voice webhook if we can't determine type
          return handleTwilioVoiceWebhook(request, reply);
        }
        
        // If we can't determine the type, return a 404
        console.error('Unknown webhook type received at root path', {
          body: request.body,
          query: request.query
        });
        return reply.code(400).send({ error: 'Unknown webhook type. Please specify webhookType in query parameters.' });
    }
  });
};

export default rootWebhookRoutes;
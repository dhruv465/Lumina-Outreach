import { FastifyRequest, FastifyReply } from 'fastify';
import { WebSocket } from 'ws';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import { synthesizeVoiceWithStreaming, synthesizeVoiceWebSocket, getStreamingStats } from '../utils/streamingVoiceSynthesis';
import { StreamingVoiceOptions } from '../utils/streamingVoiceSynthesis';

/**
 * Handle voice webhook with streaming TTS for ultra-low latency
 * This replaces the standard voice synthesis with streaming audio
 */
export async function handleStreamingVoiceWebhook(
  req: FastifyRequest,
  res: FastifyReply,
  callId: string,
  conversationId: string,
  text: string,
  voiceId?: string,
  language?: string,
  campaignId?: string
): Promise<void> {
  try {
    logger.info(`Starting streaming voice webhook for call ${callId}`, {
      textLength: text.length,
      voiceId,
      language,
      campaignId
    });

    // Create a mock sendAudioToTwilio function for now
    // In a real implementation, this would send audio chunks to Twilio
    const sendAudioToTwilio = (audioChunk: Buffer) => {
      logger.debug(`Sending audio chunk to Twilio: ${audioChunk.length} bytes`);
      // TODO: Implement actual Twilio audio streaming
      // This would typically involve sending the chunk via WebSocket or HTTP
    };

    // Use streaming voice synthesis
    const result = await synthesizeVoiceWithStreaming(
      {
        callId,
        conversationId,
        text,
        voiceId,
        language,
        campaignId,
        enableStreaming: true,
        chunkSize: 1024,
        maxChunkSize: 30 * 1024
      },
      sendAudioToTwilio
    );

    if (result.success) {
      logger.info(`Streaming voice synthesis completed for call ${callId}`, {
        method: result.method,
        totalSize: result.totalSize,
        chunkCount: result.chunkCount,
        latency: result.latency
      });

      // Return success response
      res.status(200).send({
        success: true,
        method: result.method,
        totalSize: result.totalSize,
        chunkCount: result.chunkCount,
        latency: result.latency
      });
    } else {
      logger.error(`Streaming voice synthesis failed for call ${callId}`, {
        error: result.error,
        method: result.method,
        latency: result.latency
      });

      // Return error response
      res.status(500).send({
        success: false,
        error: result.error,
        method: result.method,
        latency: result.latency
      });
    }

  } catch (error) {
    logger.error(`Streaming voice webhook failed for call ${callId}`, {
      error: getErrorMessage(error),
      textLength: text.length
    });

    res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
}

/**
 * Handle WebSocket streaming for real-time audio
 * This provides the lowest latency for voice calls
 */
export async function handleWebSocketStreaming(
  ws: WebSocket,
  req: FastifyRequest,
  callId: string,
  conversationId: string,
  text: string,
  voiceId?: string,
  language?: string,
  campaignId?: string
): Promise<void> {
  try {
    logger.info(`Starting WebSocket streaming for call ${callId}`, {
      textLength: text.length,
      voiceId,
      language,
      campaignId
    });

    // Create WebSocket streaming
    const streaming = await synthesizeVoiceWebSocket(
      {
        callId,
        conversationId,
        text,
        voiceId,
        language,
        campaignId
      },
      (audioChunk: Buffer) => {
        // Send audio chunk via WebSocket
        try {
          ws.send(JSON.stringify({
            type: 'audio_chunk',
            data: audioChunk.toString('base64'),
            callId,
            conversationId
          }));
        } catch (error) {
          logger.error(`Error sending audio chunk via WebSocket for call ${callId}`, {
            error: getErrorMessage(error),
            chunkSize: audioChunk.length
          });
        }
      }
    );

    // Set up progress monitoring
    streaming.onProgress((progress) => {
      try {
        ws.send(JSON.stringify({
          type: 'progress',
          data: progress,
          callId,
          conversationId
        }));
      } catch (error) {
        logger.error(`Error sending progress via WebSocket for call ${callId}`, {
          error: getErrorMessage(error),
          progress
        });
      }
    });

    // Start streaming
    streaming.start();

    // Handle WebSocket close
    ws.on('close', () => {
      logger.info(`WebSocket closed for call ${callId}, stopping streaming`);
      streaming.stop();
    });

    // Handle WebSocket error
    ws.on('error', (error) => {
      logger.error(`WebSocket error for call ${callId}`, {
        error: getErrorMessage(error)
      });
      streaming.stop();
    });

  } catch (error) {
    logger.error(`WebSocket streaming setup failed for call ${callId}`, {
      error: getErrorMessage(error),
      textLength: text.length
    });

    try {
      ws.send(JSON.stringify({
        type: 'error',
        data: { error: getErrorMessage(error) },
        callId,
        conversationId
      }));
    } catch (wsError) {
      logger.error(`Error sending error via WebSocket for call ${callId}`, {
        error: getErrorMessage(wsError)
      });
    }
  }
}

/**
 * Get streaming statistics for monitoring
 */
export async function getStreamingStatistics(req: FastifyRequest, res: FastifyReply): Promise<void> {
  try {
    const stats = getStreamingStats();
    
    res.status(200).send({
      success: true,
      stats: {
        ...stats,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error getting streaming statistics', {
      error: getErrorMessage(error)
    });

    res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
}

/**
 * Clean up streaming resources
 */
export async function cleanupStreamingResources(req: FastifyRequest, res: FastifyReply): Promise<void> {
  try {
    const { cleanupStreaming } = await import('../utils/streamingVoiceSynthesis');
    cleanupStreaming();
    
    res.status(200).send({
      success: true,
      message: 'Streaming resources cleaned up'
    });
  } catch (error) {
    logger.error('Error cleaning up streaming resources', {
      error: getErrorMessage(error)
    });

    res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
}

/**
 * Test streaming TTS with a sample text
 */
export async function testStreamingTTS(req: FastifyRequest, res: FastifyReply): Promise<void> {
  try {
    const { text = 'Hello, this is a test of streaming TTS', voiceId = 'aura-asteria-en' } = req.body as any;
    
    const callId = `test-${Date.now()}`;
    const conversationId = `conv-${Date.now()}`;
    
    const audioChunks: Buffer[] = [];
    let totalSize = 0;
    let chunkCount = 0;
    
    const sendAudioToTwilio = (audioChunk: Buffer) => {
      audioChunks.push(audioChunk);
      totalSize += audioChunk.length;
      chunkCount++;
    };

    const result = await synthesizeVoiceWithStreaming(
      {
        callId,
        conversationId,
        text,
        voiceId,
        enableStreaming: true,
        chunkSize: 1024
      },
      sendAudioToTwilio
    );

    res.status(200).send({
      success: true,
      result: {
        ...result,
        audioChunks: audioChunks.length,
        averageChunkSize: chunkCount > 0 ? Math.round(totalSize / chunkCount) : 0
      }
    });
  } catch (error) {
    logger.error('Error testing streaming TTS', {
      error: getErrorMessage(error)
    });

    res.status(500).send({
      success: false,
      error: getErrorMessage(error)
    });
  }
}
import http from 'http';
import { RawData } from 'ws';
import SocketStream from '@fastify/websocket';
import { getDeepgramService, DeepgramEvent, TranscriptResult } from './deepgramService';
import { decodeTwilioAudio, convertPCMToMuLaw } from '../utils/audioUtils';

const logger = {
  info: (msg: string, meta?: any) => console.log(`info: ${msg}`, meta ?? ""),
  error: (msg: string, meta?: any) => console.error(`error: ${msg}`, meta ?? ""),
  debug: (msg: string, meta?: any) => console.debug(`debug: ${msg}`, meta ?? ""),
};

export class TwilioStreamHandler {
  private streamSid?: string;
  private hasLoggedMedia: boolean = false;
  private deepgramService = getDeepgramService();
  private deepgramConnectionId?: string;
  private callId?: string;
  private isDeepgramReady: boolean = false;
  private audioQueue: Buffer[] = [];
  private isUserSpeaking: boolean = false;

  constructor(private readonly connection: any, private readonly request: http.IncomingMessage) {
    logger.info('TwilioStreamHandler initialized using SocketStream.');

    this.connection.on('message', this.handleMessage.bind(this));
    this.connection.on('close', this.handleClose.bind(this));
    this.connection.on('error', this.handleError.bind(this));

    if (this.deepgramService) {
      this.deepgramService.on(DeepgramEvent.AGENT_AUDIO_RECEIVED, this.handleAgentAudio.bind(this));
    }
  }

  private async handleAgentResponse(text: string): Promise<void> {
    try {
      logger.info(`Agent response text: ${text.substring(0, 100)}...`);
      
      // Generate high-quality TTS audio
      const { synthesizeSpeechWithProvider } = await import('../utils/ttsServiceFactory');
      const Configuration = (await import('../models/Configuration')).default;
      const config = await Configuration.findOne();
      
      if (!config) {
        logger.error('No configuration found for TTS');
        return;
      }
      
      // Get voice ID from configuration
      const voiceId = config.ttsConfig?.selectedVoicesByProvider?.[config.ttsConfig?.provider || 'elevenlabs'] ||
                     config.elevenLabsConfig?.selectedVoiceId ||
                     'aura-asteria-en';
      
      // Synthesize speech with high quality
      const speechResponse = await synthesizeSpeechWithProvider(
        config,
        text,
        voiceId,
        'en',
        { encoding: 'mp3' }
      );
      
      if (!speechResponse.audioContent) {
        logger.error('Failed to generate TTS audio');
        return;
      }
      
      // Upload to Cloudinary for playback
      const cloudinaryService = (await import('../utils/cloudinaryService')).default;
      const fs = await import('fs');
      const path = await import('path');
      const os = await import('os');
      
      const tempFilePath = path.join(os.tmpdir(), `agent-response-${Date.now()}.mp3`);
      fs.writeFileSync(tempFilePath, speechResponse.audioContent);
      
      const audioUrl = await cloudinaryService.uploadAudioFile(tempFilePath, 'agent-responses', true);
      logger.info(`Agent audio uploaded to Cloudinary: ${audioUrl}`);
      
      // Use Twilio REST API to play the audio on the active call
      await this.playAudioOnCall(audioUrl);
      
    } catch (error) {
      logger.error('Error handling agent response:', error);
    }
  }
  
  private async playAudioOnCall(audioUrl: string): Promise<void> {
    try {
      const twilio = require('twilio');
      const Configuration = (await import('../models/Configuration')).default;
      const config = await Configuration.findOne();
      
      if (!config || !config.twilioConfig) {
        logger.error('Twilio configuration not found');
        return;
      }
      
      const client = twilio(
        config.twilioConfig.accountSid,
        config.twilioConfig.authToken
      );
      
      // Get the call SID from the stream
      const Call = (await import('../models/Call')).default;
      const call = await Call.findById(this.callId);
      
      if (!call || !call.twilioSid) {
        logger.error('Call not found or no Twilio SID');
        return;
      }
      
      // Update the call to play the audio
      // We'll use TwiML to play the audio and then reconnect to the stream
      const baseUrl = process.env.WEBHOOK_BASE_URL;
      const twiml = new twilio.twiml.VoiceResponse();
      
      // Play the high-quality audio
      twiml.play(audioUrl);
      
      // Reconnect to the WebSocket stream after playing
      const connect = twiml.connect();
      connect.stream({
        url: `${baseUrl.replace(/^http/, 'ws')}/voice/stream/${this.callId}/${this.deepgramConnectionId}`,
        name: 'project-call-stream'
      });
      
      // Update the call with new TwiML
      await client.calls(call.twilioSid).update({
        twiml: twiml.toString()
      });
      
      logger.info(`Playing high-quality audio on call ${call.twilioSid}`);
      
    } catch (error) {
      logger.error('Error playing audio on call:', error);
    }
  }

  private async processUserInputAndRespond(userText: string): Promise<void> {
    // When using Deepgram Agent API, the agent handles responses internally
    // We just need to capture the agent's transcript and play it with high-quality TTS
    // This is handled by listening to Agent Transcript events
    logger.info(`User input received: ${userText} - Agent will respond via Deepgram Agent API`);
  }

  private handleAgentAudio(data: { connectionId: string, callId: string, audio: Buffer }): void {
    if (data.connectionId === this.deepgramConnectionId) {
        if (this.isUserSpeaking) {
          // Do not send audio to Twilio if the user is speaking
          return;
        }
        
        // Deepgram Agent outputs at 24kHz, we need to send it to Twilio
        // The audio quality issue is inherent to Twilio's 8kHz μ-law limitation
        // Best we can do is proper downsampling
        const muLawBuffer = convertPCMToMuLaw(data.audio, 24000);
        const mediaMessage = {
            event: 'media',
            streamSid: this.streamSid,
            media: {
                payload: muLawBuffer.toString('base64'),
            },
        };
        this.connection.send(JSON.stringify(mediaMessage));
    }
  }

  private async handleMessage(data: RawData): Promise<void> {
    try {
      const message = JSON.parse(data.toString());

      switch (message.event) {
        case 'connected':
          logger.info('Twilio stream is connected.');
          break;

        case 'start':
          this.streamSid = message.start.streamSid;
          this.callId = message.start.callSid;
          logger.info(`Twilio stream has started with streamSid: ${this.streamSid}`);

          if (this.deepgramService) {
            try {
              const isKeyValid = await this.deepgramService.validateApiKey();
              logger.info(`Deepgram API Key validation result: ${isKeyValid}`);
              if (!isKeyValid) {
                logger.error('Deepgram API Key is invalid. Cannot create transcription stream.');
                return;
              }

              this.deepgramConnectionId = await this.deepgramService.createTranscriptionStream(this.callId);
              logger.info(`Deepgram transcription stream created with ID: ${this.deepgramConnectionId}`);

              if (this.deepgramService.isStreamOpen(this.deepgramConnectionId)) {
                logger.info('Deepgram stream was already open. Sending buffered audio.');
                this.isDeepgramReady = true;
                this.audioQueue.forEach(chunk => {
                    this.deepgramService.sendAudioToStream(this.deepgramConnectionId, chunk);
                });
                this.audioQueue = [];
              } else {
                this.deepgramService.on(DeepgramEvent.AGENT_READY, (status) => {
                    if (status.connectionId === this.deepgramConnectionId) {
                        if (!this.isDeepgramReady) {
                          logger.info('Deepgram agent is ready. Sending buffered audio.');
                          this.isDeepgramReady = true;
                          this.audioQueue.forEach(chunk => {
                              this.deepgramService.sendAudioToStream(this.deepgramConnectionId, chunk);
                          });
                          this.audioQueue = [];
                        }
                    }
                });
              }

              this.deepgramService.on(DeepgramEvent.TRANSCRIPT_RECEIVED, async (transcript: TranscriptResult) => {
                if (transcript.callId === this.callId && transcript.text.trim().length > 0 && transcript.isFinal) {
                  logger.info(`USER SAID: ${transcript.text}`);
                  
                  // Set user speaking flag
                  this.isUserSpeaking = false;
                  
                  // Process the user input and get agent response
                  await this.processUserInputAndRespond(transcript.text);
                }
              });
            } catch (err) {
                logger.error('Failed to create Deepgram transcription stream.', { error: err });
                logger.error('This might be due to an invalid/inactive API key, billing issues, or a network firewall blocking outbound WSS connections to api.deepgram.com.');
            }
          }
          break;

        case 'media':
          if (!this.hasLoggedMedia) {
            logger.debug('Received first media payload.');
            this.hasLoggedMedia = true;
          }
          if (this.deepgramService && this.deepgramConnectionId) {
            const audioBuffer = Buffer.from(message.media.payload, 'base64');
            const pcmBuffer = decodeTwilioAudio(audioBuffer);

            if (this.isDeepgramReady) {
                this.deepgramService.sendAudioToStream(this.deepgramConnectionId, pcmBuffer);
            } else {
                this.audioQueue.push(pcmBuffer);
            }
          }
          break;

        case 'stop':
          logger.info('Twilio stream has stopped.');
          this.handleClose();
          break;

        default:
          logger.debug(`Received unhandled event: ${message.event}`);
          break;
      }
    } catch (err) {
      logger.error('Failed to parse message from Twilio', { error: err });
    }
  }

  private handleClose(): void {
    logger.info(`Twilio stream closed.`);
    if (this.deepgramService && this.deepgramConnectionId) {
      this.deepgramService.closeTranscriptionStream(this.deepgramConnectionId);
      logger.info(`Deepgram transcription stream ${this.deepgramConnectionId} closed.`);
    }
    if (!this.connection.destroyed) {
        this.connection.close();
    }
  }

  private handleError(error: Error): void {
    logger.error('An error occurred on the Twilio stream', { error });
    this.handleClose();
  }
}


import http from 'http';
import { RawData } from 'ws';
import SocketStream from '@fastify/websocket';
import { getDeepgramService, DeepgramEvent, TranscriptResult } from './deepgramService';
import { convertMuLawToPCM, convertPCMToMuLaw } from '../utils/audioUtils';

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
      this.deepgramService.on(DeepgramEvent.USER_STARTED_SPEAKING, this.handleUserStartedSpeaking.bind(this));
      this.deepgramService.on(DeepgramEvent.USER_ENDED_SPEAKING, this.handleUserEndedSpeaking.bind(this));
    }
  }

  private handleAgentAudio(data: { connectionId: string, callId: string, audio: Buffer }): void {
    if (data.connectionId === this.deepgramConnectionId) {
        if (this.isUserSpeaking) {
          // Do not send audio to Twilio if the user is speaking
          return;
        }
        // Deepgram Agent outputs at 24kHz, downsample to 8kHz for Twilio
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

  private handleUserStartedSpeaking(data: { connectionId: string, callId: string }): void {
    if (data.connectionId === this.deepgramConnectionId) {
      logger.info('User started speaking, interrupting agent.');
      this.isUserSpeaking = true;
    }
  }

  private handleUserEndedSpeaking(data: { connectionId: string, callId: string }): void {
    if (data.connectionId === this.deepgramConnectionId) {
      logger.info('User stopped speaking.');
      this.isUserSpeaking = false;
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
                              if (this.deepgramService.isStreamOpen(this.deepgramConnectionId)) {
                                logger.info('Deepgram stream was already open. Sending buffered audio.');
                                this.isDeepgramReady = true;
                                this.audioQueue.forEach(chunk => {
                                    this.deepgramService.sendAudioToStream(this.deepgramConnectionId, chunk);
                                });
                                this.audioQueue = [];
                              }
                
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
              });              }

              this.deepgramService.on(DeepgramEvent.TRANSCRIPT_RECEIVED, (transcript: TranscriptResult) => {
                if (transcript.callId === this.callId && transcript.text.trim().length > 0) {
                  logger.info(`TRANSCRIPT: ${transcript.text}`);
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
            const pcmBuffer = convertMuLawToPCM(audioBuffer);

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

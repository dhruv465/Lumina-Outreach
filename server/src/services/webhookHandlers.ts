import { FastifyRequest, FastifyReply } from 'fastify';
import WebSocket from 'ws';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';
import Call, { ICall } from '../models/Call';
import Campaign from '../models/Campaign';
import Configuration from '../models/Configuration';
import { getVoiceAIService } from '.';
import { conversationEngine } from './index';
import { RealTelephonyService } from './realTelephonyService';
import { EnhancedVoiceAIService } from './enhancedVoiceAIService';
import { synthesizeVoiceResponse, processAudioForTwiML, prepareUrlForTwilioPlay } from '../utils/voiceSynthesis';
import { getPreferredVoiceId } from '../utils/voiceUtils';
import { synthesizeWithTTSChain, splitTextIntoChunks } from '../utils/ttsChainHandler';
import fs from 'fs';
import path from 'path';
import os from 'os';
import cloudinaryService from '../utils/cloudinaryService';
import { URL } from 'url';
// Import Twilio
const twilio = require('twilio');

/**
 * Handles Twilio voice webhook
 * This is where we set up the TwiML response and initiate the conversation
 */
export async function handleTwilioVoiceWebhook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
      const callId = (req.query as any).callId as string;
      const twilioSid = (req.body as any).CallSid;
      const callStatus = (req.body as any).CallStatus;
      const machineDetection = (req.body as any).AnsweredBy;
      try {
            logger.info(`Voice webhook called for call ${callId} with status ${callStatus}`, {
                  twilioSid,
                  machineDetection,
                  body: req.body,
                  query: req.query
            });
            // Find the call in the database
            const call = await Call.findById(callId);
            if (!call) {
                  logger.error(`No call found with ID ${callId}`);

                  // Get configuration for ElevenLabs
                  const config = await Configuration.findOne();
                  const errorMessage = config?.errorMessages?.noCallFound || 'We apologize, but we cannot find your call record.';

                  // Generate error response with ElevenLabs if available
                  const twiml = new twilio.twiml.VoiceResponse();

                  if (config?.elevenLabsConfig?.isEnabled && config?.elevenLabsConfig?.apiKey) {
                        try {
                              // Check for ANY enabled LLM provider, not just OpenAI
                              const enabledProvider = config.llmConfig.providers.find(p => p.isEnabled && p.apiKey);
                              if (enabledProvider) {
                                    // Use the TTS service factory to get the appropriate service
                                    const { synthesizeSpeechWithProvider } = await import('../utils/ttsServiceFactory');

                                    const defaultVoiceId = config.voiceAIConfig?.conversationalAI?.defaultVoiceId ||
                                          (config.ttsConfig?.provider === 'deepgram' ? 'aura-2-thalia-en' : 'XvRdSQXvmv5jHPGBw0XU');

                                    // Process audio safely using the TTS service factory
                                    const speechResponse = await synthesizeSpeechWithProvider(
                                          config,
                                          errorMessage,
                                          defaultVoiceId,
                                          'en'
                                    );

                                    if (speechResponse.audioContent) {
                                          // Process audio safely using helper function
                                          const audioResult = await processAudioForTwiML(
                                                speechResponse.audioContent,
                                                errorMessage,
                                                'en'
                                          );

                                          if (audioResult.method === 'tts') {
                                                // Check if this is a chunked audio request
                                                if (!(await handleChunkedAudioForTwiML(twiml, audioResult.url, 'en', { callId }))) {
                                                      // Use regular TTS fallback
                                                      twiml.say({ voice: 'alice', language: 'en-US' }, errorMessage);
                                                }
                                          } else {
                                                // Use Cloudinary URL or small base64 data
                                                twiml.play(prepareUrlForTwilioPlay(audioResult.url));
                                          }
                                    } else {
                                          // Use TTS fallback instead of empty audio
                                          twiml.say({ voice: 'alice', language: 'en-US' }, errorMessage);
                                    }
                              } else {
                                    // Use TTS fallback instead of empty audio
                                    twiml.say({ voice: 'alice', language: 'en-US' }, errorMessage);
                              }
                        } catch (error) {
                              // Use TTS fallback instead of empty audio
                              twiml.say({ voice: 'alice', language: 'en-US' }, errorMessage);
                        }
                  } else {
                        // Use TTS fallback instead of empty audio
                        twiml.say({ voice: 'alice', language: 'en-US' }, errorMessage);
                  }

                  twiml.hangup();
                  reply.type('text/xml');
                  reply.send(twiml.toString());
                  return;
            }
            // Update call with Twilio SID
            await Call.findByIdAndUpdate(callId, {
                  twilioSid,
                  status: 'in-progress',
                  startTime: new Date(),
                  updatedAt: new Date()
            });
            // Handle answering machine detection if enabled
            if (machineDetection === 'machine_end_beep' || machineDetection === 'machine_end_silence') {
                  logger.info(`Answering machine detected for call ${callId}, continuing with message`);
                  // Continue with the call even for answering machines
            }
            // Start the conversation with the AI
            const conversationId = await conversationEngine.startConversation(
                  callId,
                  call.leadId.toString(),
                  call.campaignId.toString()
            );

            // Get campaign and configuration for voice synthesis
            const campaign = await Campaign.findById(call.campaignId);
            const configuration = await Configuration.findOne();

            // Log the current configuration state for debugging
            logger.info(`📋 Current configuration state for call ${callId}:`, {
                  configExists: !!configuration,
                  deepgramConfig: {
                        isEnabled: configuration?.deepgramConfig?.isEnabled,
                        hasApiKey: !!configuration?.deepgramConfig?.apiKey,
                        primaryModel: configuration?.deepgramConfig?.primaryModel,
                        fallbackModels: configuration?.deepgramConfig?.fallbackModels,
                        autoFallback: configuration?.deepgramConfig?.autoFallback
                  },
                  elevenLabsConfig: {
                        isEnabled: configuration?.elevenLabsConfig?.isEnabled,
                        useFlashModel: configuration?.elevenLabsConfig?.useFlashModel,
                        hasApiKey: !!configuration?.elevenLabsConfig?.apiKey
                  },
                  llmConfig: {
                        defaultProvider: configuration?.llmConfig?.defaultProvider,
                        providers: configuration?.llmConfig?.providers?.map(p => ({
                              name: p.name,
                              isEnabled: p.isEnabled,
                              useRealtimeAPI: p.useRealtimeAPI,
                              hasApiKey: !!p.apiKey
                        }))
                  }
            });

            if (!campaign || !configuration) {
                  logger.error('Campaign or configuration not found');

                  // Get error message
                  const errorMessage = 'We apologize, but there was a configuration error.';

                  // Generate error response with TwiML
                  const twiml = new twilio.twiml.VoiceResponse();

                  // Try to use ElevenLabs if possible
                  if (configuration?.elevenLabsConfig?.isEnabled && configuration?.elevenLabsConfig?.apiKey) {
                        try {
                              // Check for ANY enabled LLM provider, not just OpenAI
                              const enabledProvider = configuration.llmConfig.providers.find(p => p.isEnabled && p.apiKey);
                              if (enabledProvider) {
                                    // Use the TTS service factory to get the appropriate service
                                    const { synthesizeSpeechWithProvider } = await import('../utils/ttsServiceFactory');

                                    const defaultVoiceId = configuration.voiceAIConfig?.conversationalAI?.defaultVoiceId ||
                                          (configuration.ttsConfig?.provider === 'deepgram' ? 'aura-2-thalia-en' : 'XvRdSQXvmv5jHPGBw0XU');

                                    // Process audio safely using the TTS service factory
                                    const speechResponse = await synthesizeSpeechWithProvider(
                                          configuration,
                                          errorMessage,
                                          defaultVoiceId,
                                          'en'
                                    );

                                    if (speechResponse.audioContent) {
                                          // Process audio safely using helper function
                                          const audioResult = await processAudioForTwiML(
                                                speechResponse.audioContent,
                                                errorMessage,
                                                'en'
                                          );

                                          if (audioResult.method === 'tts') {
                                                // Check if this is a chunked audio request
                                                if (!(await handleChunkedAudioForTwiML(twiml, audioResult.url, 'en', { callId }))) {
                                                      // Use regular TTS fallback
                                                      twiml.say({ voice: 'alice', language: 'en-US' }, errorMessage);
                                                }
                                          } else {
                                                // Use Cloudinary URL or small base64 data
                                                twiml.play(prepareUrlForTwilioPlay(audioResult.url));
                                          }
                                    } else {
                                          // Use TTS fallback instead of empty audio
                                          twiml.say({ voice: 'alice', language: 'en-US' }, errorMessage);
                                    }
                              } else {
                                    // Use TTS fallback instead of empty audio
                                    twiml.say({ voice: 'alice', language: 'en-US' }, errorMessage);
                              }
                        } catch (error) {
                              // Use TTS fallback instead of empty audio
                              twiml.say({ voice: 'alice', language: 'en-US' }, errorMessage);
                        }
                  } else {
                        // Use TTS fallback instead of empty audio
                        twiml.say({ voice: 'alice', language: 'en-US' }, errorMessage);
                  }
                  twiml.hangup();
                  reply.type('text/xml');
                  reply.send(twiml.toString());
                  return;
            }

            // Try to use ElevenLabs for initial greeting if available
            let useElevenLabs = false;

            // Create the TwiML response
            const twiml = new twilio.twiml.VoiceResponse();

            if (configuration.elevenLabsConfig?.isEnabled && configuration.elevenLabsConfig?.apiKey) {
                  try {
                        // Check for ANY enabled LLM provider, not just OpenAI
                        const enabledProvider = configuration.llmConfig.providers.find(p => p.isEnabled && p.apiKey);
                        if (enabledProvider) {
                              logger.info(`🔧 TTS configuration status: using LLM provider: ${enabledProvider.name}`);

                              // Debug campaign voice configuration for initial greeting
                              logger.info(`🔍 Initial Greeting Voice Config Debug for call ${callId}:`, {
                                    campaignId: call.campaignId,
                                    campaignFound: !!campaign,
                                    voiceConfig: campaign.voiceConfiguration,
                                    requestedVoiceId: campaign.voiceConfiguration?.voiceId,
                                    voiceProvider: campaign.voiceConfiguration?.provider,
                                    primaryLanguage: campaign.primaryLanguage,
                                    providerName: enabledProvider.name,
                                    hasApiKey: !!enabledProvider.apiKey
                              });

                              // Get the preferred voice ID from configuration or campaign
                              const preferredVoiceId = await getPreferredVoiceId();
                              const requestedVoiceId = campaign.voiceConfiguration?.voiceId || preferredVoiceId;
                              logger.info(`🎤 Resolving initial greeting voice ID for call ${callId}: "${requestedVoiceId}"`);

                              // Get greeting text from campaign - prioritize openingMessage over initialPrompt
                              const formattedGreeting = campaign.openingMessage?.trim() || campaign.initialPrompt?.trim();

                              if (!formattedGreeting) {
                                    throw new Error(`Campaign ${call.campaignId} has no greeting message configured. Please set either openingMessage or initialPrompt in the campaign.`);
                              }

                              logger.info(`🗣️ Synthesizing greeting: "${formattedGreeting.substring(0, 50)}${formattedGreeting.length > 50 ? '...' : ''}"`);

                              // Try TTS synthesis using auto-detected provider based on voice ID
                              try {
                                    // Use the TTS service factory for synthesis with auto-detection
                                    const { synthesizeSpeechWithProvider } = await import('../utils/ttsServiceFactory');
                                    const speechResponse = await synthesizeSpeechWithProvider(
                                          configuration,
                                          formattedGreeting,
                                          requestedVoiceId,
                                          campaign.primaryLanguage === 'hi' ? 'hi' : 'en',
                                          {
                                                provider: campaign.voiceConfiguration?.provider // Pass the campaign's selected provider
                                          }
                                    );

                                    // Check if synthesis was successful
                                    if (speechResponse.audioContent && speechResponse.method === 'tts') {
                                          // Process audio safely using helper function
                                          const audioResult = await processAudioForTwiML(
                                                speechResponse.audioContent,
                                                formattedGreeting,
                                                campaign.primaryLanguage
                                          );

                                          if (audioResult.method === 'tts') {
                                                // Check if this is a chunked audio request
                                                if (!(await handleChunkedAudioForTwiML(twiml, audioResult.url, campaign.primaryLanguage, { callId, campaignId: campaign._id?.toString() }))) {
                                                      // Use regular TTS fallback
                                                      twiml.say({ voice: 'alice', language: campaign.primaryLanguage === 'hi' ? 'hi-IN' : 'en-US' }, formattedGreeting);
                                                }
                                          } else {
                                                // Use Cloudinary URL or small base64 data
                                                twiml.play(prepareUrlForTwilioPlay(audioResult.url));
                                                useElevenLabs = true;
                                          }

                                          // Clean up temp file if it exists (speechResponse may have filePath in some implementations)
                                          if ('filePath' in speechResponse && speechResponse.filePath && typeof speechResponse.filePath === 'string') {
                                                try {
                                                      fs.unlinkSync(speechResponse.filePath);
                                                } catch (cleanupError) {
                                                      logger.warn(`Failed to clean up temp file ${speechResponse.filePath}: ${getErrorMessage(cleanupError)}`);
                                                }
                                          }
                                    } else {
                                          throw new Error(`Speech synthesis failed or returned empty content`);
                                    }
                              } catch (fileMethodError) {
                                    logger.warn(`File synthesis method failed, trying adaptive method: ${fileMethodError}`);

                                    const voiceAIService = getVoiceAIService();
                                    const speechResponse = await voiceAIService.synthesizeAdaptiveVoice({
                                          text: formattedGreeting,
                                          personalityId: requestedVoiceId,
                                          language: campaign.primaryLanguage === 'hi' ? 'hi' : 'en'
                                    });

                                    if (speechResponse && speechResponse.audioContent) {
                                          const audioResult = await processAudioForTwiML(
                                                speechResponse.audioContent,
                                                formattedGreeting,
                                                campaign.primaryLanguage
                                          );

                                          if (audioResult.method === 'tts') {
                                                if (!(await handleChunkedAudioForTwiML(twiml, audioResult.url, campaign.primaryLanguage, { callId, campaignId: campaign._id?.toString() }))) {
                                                      twiml.say({ voice: 'alice', language: campaign.primaryLanguage === 'hi' ? 'hi-IN' : 'en-US' }, formattedGreeting);
                                                }
                                          } else {
                                                twiml.play(prepareUrlForTwilioPlay(audioResult.url));
                                                useElevenLabs = true;
                                          }
                                    } else {
                                          logger.error(`⚠️ No audio content in speechResponse: ${JSON.stringify(speechResponse || {})}`);
                                          twiml.say({
                                                voice: 'alice',
                                                language: campaign.primaryLanguage === 'hi' ? 'hi-IN' : 'en-US'
                                          }, formattedGreeting);
                                    }
                              }
                        } else {
                              logger.error(`No enabled LLM provider with API key found. ElevenLabs may not be used for the initial greeting or might use a default/fallback voice if it can operate independently for basic synthesis.`);
                        }
                  } catch (error) {
                        logger.error(`Error using ElevenLabs for greeting: ${error}`);
                  }
            } else {
                  logger.warn(`ElevenLabs not configured properly - enabled: ${!!configuration.elevenLabsConfig?.isEnabled}, apiKey exists: ${!!configuration.elevenLabsConfig?.apiKey}`);
            }

            if (!useElevenLabs) {
                  logger.info(`ElevenLabs failed for call ${callId}, using TTS fallback`);
                  const greetingText = campaign.openingMessage?.trim() || campaign.initialPrompt?.trim();

                  if (!greetingText) {
                        throw new Error(`Campaign ${call.campaignId} has no greeting message configured. Please set either openingMessage or initialPrompt in the campaign.`);
                  }

                  twiml.say({
                        voice: 'alice',
                        language: campaign.primaryLanguage === 'hi' ? 'hi-IN' : 'en-US'
                  }, greetingText);
            }

            const deepgramEnabled = configuration?.deepgramConfig?.isEnabled;
            const flashModelEnabled = configuration?.elevenLabsConfig?.useFlashModel;
            const realtimeAPIEnabled = configuration?.llmConfig?.providers?.some(p => p.useRealtimeAPI);

            logger.info(`Configuration check for call ${callId}: Deepgram enabled=${deepgramEnabled}, Flash model=${flashModelEnabled}, Realtime API=${realtimeAPIEnabled}`, {
                  deepgramConfig: configuration?.deepgramConfig,
                  elevenLabsUseFlash: configuration?.elevenLabsConfig?.useFlashModel,
                  llmProviders: configuration?.llmConfig?.providers?.map(p => ({ name: p.name, useRealtimeAPI: p.useRealtimeAPI, isEnabled: p.isEnabled }))
            });

            const useAdvancedStreaming = deepgramEnabled || flashModelEnabled || realtimeAPIEnabled;

            if (useAdvancedStreaming) {
                  logger.info(`Using advanced WebSocket streaming for call ${callId} with features: Deepgram=${!!configuration?.deepgramConfig?.isEnabled}, Flash=${!!configuration?.elevenLabsConfig?.useFlashModel}, Realtime=${!!configuration?.llmConfig?.providers?.some(p => p.useRealtimeAPI)}`);

                  const host = req.headers.host;
                  const webhookBaseUrl = process.env.WEBHOOK_BASE_URL || `http${req.raw.protocol === 'https' ? 's' : ''}://${host}`;

                  const baseUrl = webhookBaseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:');
                  const streamPath = `/voice/stream/${callId}/${conversationId}`;
                  const wsUrl = `${baseUrl}${streamPath}`;

                  logger.info(`Generated websocket URL for Twilio Media Stream: ${wsUrl}`);

                  logger.info(`WebSocket URL for call ${callId}: ${wsUrl}`, {
                        host,
                        callId,
                        conversationId,
                        fullUrl: wsUrl,
                        secure: req.raw.protocol === 'https',
                        forwardedProto: req.headers['x-forwarded-proto']
                  });

                  const connect = twiml.connect();
                  const stream = connect.stream({
                        url: wsUrl,
                        name: 'project-call-stream'
                  });
                  stream.parameter({
                        name: 'campaignId',
                        value: call.campaignId.toString()
                  });
                  stream.parameter({
                        name: 'leadId',
                        value: call.leadId.toString()
                  });
                  if (configuration?.deepgramConfig?.isEnabled) {
                        stream.parameter({
                              name: 'useDeepgram',
                              value: 'true'
                        });
                  }
                  if (configuration?.elevenLabsConfig?.useFlashModel) {
                        stream.parameter({
                              name: 'useFlashModel',
                              value: 'true'
                        });
                  }
                  if (configuration?.llmConfig?.providers?.some(p => p.useRealtimeAPI)) {
                        stream.parameter({
                              name: 'useRealtimeAPI',
                              value: 'true'
                        });
                  }
            } else {
                  logger.info(`Using traditional gather method for call ${callId}`);

                  const gather = twiml.gather({
                        input: 'speech',
                        action: `${process.env.WEBHOOK_BASE_URL}/api/calls/gather?callId=${callId}&conversationId=${conversationId}`,
                        method: 'POST',
                        speechTimeout: 5,
                        speechModel: 'phone_call',
                        timeout: 20,
                  });
            }

            const twimlString = twiml.toString();
            const twimlLength = twimlString.length;
            const twimlSizeKB = Math.round(twimlLength / 1024 * 100) / 100;

            if (twimlLength > 61440) {
                  logger.error(`⚠️ CRITICAL: TwiML response for call ${callId} is dangerously close to Twilio's 64KB limit at ${twimlSizeKB}KB!`);
            } else if (twimlLength > 51200) {
                  logger.warn(`⚠️ WARNING: TwiML response for call ${callId} is large (${twimlSizeKB}KB) - approaching Twilio's 64KB limit`);
            } else if (twimlLength > 30720) {
                  logger.info(`ℹ️ NOTE: TwiML response for call ${callId} is moderately large (${twimlSizeKB}KB)`);
            }

            logger.info(`Voice webhook TwiML generated for call ${callId}`, {
                  useElevenLabs,
                  conversationId,
                  twimlLength,
                  twimlSizeKB,
                  hasCampaign: !!campaign,
                  hasConfig: !!configuration,
                  elevenLabsEnabled: configuration?.elevenLabsConfig?.isEnabled,
                  elevenLabsStatus: configuration?.elevenLabsConfig?.status,
                  unusualActivityDetected: configuration?.elevenLabsConfig?.unusualActivityDetected || false
            });

            reply.type('text/xml');
            reply.send(twimlString);

      } catch (error) {
            logger.error(`Error in voice webhook for call ${callId}:`, error);

            const twiml = new twilio.twiml.VoiceResponse();

            const config = await Configuration.findOne();
            const errorMessage = config?.errorMessages?.technicalIssue || 'We apologize, but there was a technical issue. Please try again later.';

            await synthesizeVoiceResponse(twiml, errorMessage, {});
            twiml.hangup();

            reply.type('text/xml');
            reply.send(twiml.toString());
      }
}
/**
 * Handles Twilio status callback webhook
 * This is used to track call progress and completion
 */
export async function handleTwilioStatusWebhook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
      const callId = (req.query as any).callId as string;
      const callStatus = (req.body as any).CallStatus;
      const callDuration = (req.body as any).CallDuration;
      const recordingUrl = (req.body as any).RecordingUrl;
      try {
            logger.info(`Status webhook called for call ${callId} with status ${callStatus}`, {
                  body: req.body,
                  query: req.query
            });
            // Handle different call statuses
            switch (callStatus) {
                  case 'completed':
                        await Call.findByIdAndUpdate(callId, {
                              status: 'completed',
                              endTime: new Date(),
                              duration: parseInt(callDuration) || 0,
                              recordingUrl: recordingUrl || '',
                              updatedAt: new Date()
                        });

                        // Generate call metrics
                        await generateCallMetrics(callId);
                        break;

                  case 'busy':
                        await Call.findByIdAndUpdate(callId, {
                              status: 'busy',
                              endTime: new Date(),
                              updatedAt: new Date()
                        });
                        break;

                  case 'no-answer':
                        await Call.findByIdAndUpdate(callId, {
                              status: 'no-answer',
                              endTime: new Date(),
                              updatedAt: new Date()
                        });
                        break;

                  case 'failed':
                        await Call.findByIdAndUpdate(callId, {
                              status: 'failed',
                              failureCode: (req.body as any).ErrorCode || '',
                              endTime: new Date(),
                              updatedAt: new Date()
                        });
                        break;
            }

            reply.code(200).send('OK');
      } catch (error) {
            logger.error(`Error in status webhook for call ${callId}:`, error);
            reply.code(500).send('Error processing status update');
      }
}
/**
 * Handles Twilio gather action webhook
 * This processes speech input from the caller
 */
export async function handleTwilioGatherWebhook(req: FastifyRequest, reply: FastifyReply): Promise<void> {
      const callId = (req.query as any).callId as string;
      const conversationId = (req.query as any).conversationId as string;
      const speechResult = (req.body as any).SpeechResult;
      let useElevenLabs = false;
      // Get webhook base URL from environment variable only
      const baseUrl = process.env.WEBHOOK_BASE_URL;

      // Ensure webhook base URL is set
      if (!baseUrl) {
            logger.error('WEBHOOK_BASE_URL environment variable is not set');
            const twiml = new twilio.twiml.VoiceResponse();

            // Get message from configuration
            const config = await Configuration.findOne();
            const errorMessage = config?.errorMessages?.serverError || 'We apologize, but there was a server configuration error.';

            // Use ElevenLabs for error message
            await synthesizeVoiceResponse(twiml, errorMessage, {});
            twiml.hangup();
            reply.type('text/xml');
            reply.send(twiml.toString());
            return;
      }
      try {
            logger.info(`Gather webhook called for call ${callId}`, {
                  speechResult,
                  conversationId,
                  body: req.body,
                  query: req.query
            });
            // Create TwiML response
            const twiml = new twilio.twiml.VoiceResponse();
            if (speechResult) {
                  // Process the speech with the conversation engine
                  const aiResponse = await conversationEngine.processUserInput(conversationId, speechResult);

                  logger.info(`AI response for call ${callId}:`, {
                        text: aiResponse.text,
                        intent: aiResponse.intent
                  });

                  // Get configuration for TTS
                  const config = await Configuration.findOne();
                  let useTTS = false;

                  // Try to use configured TTS provider
                  const { isTTSProviderConfigured } = await import('../utils/ttsServiceFactory');
                  if (config && isTTSProviderConfigured(config)) {
                        // Get the call to retrieve voice settings
                        const call = await Call.findById(callId);
                        if (call) {
                              try {
                                    // Get the configured default LLM provider
                                    const defaultProviderName = config.llmConfig.defaultProvider;
                                    const configuredProvider = config.llmConfig.providers.find(p => p.name === defaultProviderName);
                                    if (configuredProvider?.isEnabled && configuredProvider?.apiKey) {
                                          logger.info(`Using LLM provider '${configuredProvider.name}' in gather webhook.`);

                                          // Get voice configuration with detailed debugging
                                          const campaign = await Campaign.findById(call.campaignId);
                                          logger.info(`🔍 Campaign Voice Config Debug for call ${callId}:`, {
                                                campaignId: call.campaignId,
                                                campaignFound: !!campaign,
                                                voiceConfig: campaign?.voiceConfiguration,
                                                requestedVoiceId: campaign?.voiceConfiguration?.voiceId,
                                                voiceProvider: campaign?.voiceConfiguration?.provider
                                          });

                                          // Get the preferred voice ID from configuration or campaign
                                          const preferredVoiceId = await getPreferredVoiceId();
                                          const requestedVoiceId = campaign?.voiceConfiguration?.voiceId || preferredVoiceId;
                                          logger.info(`🎤 Resolving voice ID for call ${callId}: "${requestedVoiceId}"`);

                                          // Synthesize speech using auto-detected provider based on voice ID
                                          const { synthesizeSpeechWithProvider } = await import('../utils/ttsServiceFactory');
                                          const speechResponse = await synthesizeSpeechWithProvider(
                                                config,
                                                aiResponse.text,
                                                requestedVoiceId,
                                                campaign?.primaryLanguage === 'hi' ? 'hi' : 'en',
                                                {
                                                      provider: campaign?.voiceConfiguration?.provider // Pass the campaign's selected provider
                                                }
                                          );

                                          // Use TTS synthesized audio in the response
                                          if (speechResponse.audioContent && speechResponse.method === 'tts') {
                                                // Process audio safely using helper function
                                                const audioResult = await processAudioForTwiML(
                                                      speechResponse.audioContent,
                                                      aiResponse.text,
                                                      campaign?.primaryLanguage === 'hi' ? 'hi' : 'en'
                                                );

                                                if (audioResult.method === 'tts') {
                                                      // Check if this is a chunked audio request
                                                      if (!(await handleChunkedAudioForTwiML(twiml, audioResult.url, 'en', { callId, campaignId: call.campaignId?.toString() }))) {
                                                            // Use regular TTS fallback
                                                            twiml.say({ voice: 'alice', language: campaign?.primaryLanguage === 'hi' ? 'hi-IN' : 'en-US' }, aiResponse.text);
                                                      }
                                                } else {
                                                      // Use Cloudinary URL or small base64 data
                                                      twiml.play(prepareUrlForTwilioPlay(audioResult.url));
                                                      useTTS = true;
                                                }
                                          }
                                    } else {
                                          logger.warn(`Configured LLM provider '${defaultProviderName || 'Unknown'}' not enabled or missing API key. TTS synthesis for AI response might be skipped or use fallback.`);
                                          // useTTS will remain false, leading to fallback.
                                    }
                              } catch (error) {
                                    logger.error(`Error using TTS in gather webhook: ${error}`);
                                    useTTS = false;
                              }
                        }
                  }

                  // Fallback if TTS is not available or fails
                  if (!useTTS) {
                        logger.info(`Using TTS fallback chain for call ${callId} response`);

                        // Try TTS provider chain before using Twilio voices
                        const call = await Call.findById(callId);
                        const ttsResult = await synthesizeWithTTSChain(aiResponse.text, {
                              callId,
                              campaignId: call?.campaignId?.toString(),
                              language: 'en'
                        });

                        if (ttsResult.success && ttsResult.audioContent) {
                              try {
                                    const audioResult = await processAudioForTwiML(
                                          ttsResult.audioContent,
                                          aiResponse.text,
                                          'en'
                                    );
                                    twiml.play(prepareUrlForTwilioPlay(audioResult.url));
                                    useTTS = true;
                              } catch (audioError) {
                                    logger.warn(`Failed to process fallback TTS audio: ${audioError}`);
                                    // Final fallback to Twilio voice
                                    const voiceConfig = ttsResult.twilioVoiceConfig || { voice: 'alice', language: 'en-US' };
                                    twiml.say(voiceConfig, aiResponse.text);
                              }
                        } else if (ttsResult.shouldUseTwilioFallback) {
                              // Use Twilio voice as final fallback
                              const voiceConfig = ttsResult.twilioVoiceConfig || { voice: 'alice', language: 'en-US' };
                              twiml.say(voiceConfig, aiResponse.text);
                        }
                  }

                  // Check if conversation should continue based on intent
                  const shouldContinue = aiResponse.intent !== 'goodbye' &&
                        aiResponse.intent !== 'end_call' &&
                        !aiResponse.text.toLowerCase().includes('goodbye') &&
                        !aiResponse.text.toLowerCase().includes('thank you for your time');

                  if (shouldContinue) {
                        // Continue the conversation with another gather - use longer timeouts
                        twiml.gather({
                              input: 'speech',
                              action: `${baseUrl}/api/calls/gather?callId=${callId}&conversationId=${conversationId}`,
                              method: 'POST',
                              speechTimeout: 5,  // Increased from 3 to 5
                              speechModel: 'phone_call',
                              timeout: 20  // Increased from 15 to 20 for better user experience
                        });

                        // Handle no-speech fallback with reasonable behavior
                        const noSpeechMessage = config?.errorMessages?.noSpeechDetected || "I'm sorry, I didn't hear anything. Please speak again.";

                        // Get call and campaign information for voice synthesis
                        const currentCall = await Call.findById(callId);
                        const currentCampaign = currentCall ? await Campaign.findById(currentCall.campaignId) : null;

                        // Use ElevenLabs for speech error message
                        await synthesizeVoiceResponse(
                              twiml,
                              noSpeechMessage,
                              {
                                    campaignId: currentCall?.campaignId?.toString(),
                                    language: currentCampaign?.primaryLanguage === 'hi' ? 'hi' : 'en'
                              }
                        );

                        // Give another chance with even longer timeout
                        twiml.gather({
                              input: 'speech',
                              action: `${baseUrl}/api/calls/gather?callId=${callId}&conversationId=${conversationId}`,
                              method: 'POST',
                              speechTimeout: 5,
                              speechModel: 'phone_call',
                              timeout: 25  // Even longer timeout for final attempt
                        });
                  } else {
                        // End the call gracefully
                        const thankYouMessage = config?.callResponses?.thankYou || "Thank you for your time. Have a great day!";

                        // Get call and campaign information
                        const currentCall = await Call.findById(callId);
                        const currentCampaign = currentCall ? await Campaign.findById(currentCall.campaignId) : null;

                        // Use ElevenLabs for thank you message
                        await synthesizeVoiceResponse(
                              twiml,
                              thankYouMessage,
                              {
                                    campaignId: currentCall?.campaignId?.toString(),
                                    language: currentCampaign?.primaryLanguage === 'hi' ? 'hi' : 'en'
                              }
                        );

                        twiml.hangup();
                  }

                  // Log TwiML for debugging
                  const twimlString = twiml.toString();
                  logger.info(`Gather webhook TwiML generated for call ${callId}`, {
                        useElevenLabs,
                        shouldContinue,
                        twimlLength: twimlString.length
                  });

                  // Send the TwiML response
                  reply.type('text/xml');
                  reply.send(twimlString);

            } else {
                  // No speech detected, try again with more patience
                  logger.info(`No speech detected for call ${callId}, prompting again`);

                  // Get message from configuration
                  const config = await Configuration.findOne();
                  const noSpeechMessage = config?.errorMessages?.noSpeechDetected || "I'm sorry, we didn't hear anything. Could you please speak?";

                  // Use ElevenLabs for no speech message
                  const call = await Call.findById(callId);
                  const campaign = call ? await Campaign.findById(call.campaignId) : null;

                  await synthesizeVoiceResponse(
                        twiml,
                        noSpeechMessage,
                        {
                              campaignId: call?.campaignId?.toString(),
                              language: campaign?.primaryLanguage === 'hi' ? 'hi' : 'en'
                        }
                  );

                  // Give the user another chance to speak with better timeouts
                  twiml.gather({
                        input: 'speech',
                        action: `${baseUrl}/api/calls/gather?callId=${callId}&conversationId=${conversationId}`,
                        method: 'POST',
                        speechTimeout: 5,  // Increased from 3 to 5
                        speechModel: 'phone_call',
                        timeout: 20  // Increased from 15 to 20 for better patience
                  });

                  // End the call if they still don't speak
                  const disconnectMessage = config?.errorMessages?.callDisconnected || "I'm sorry, we seem to be having difficulty. Thank you for your time. Goodbye.";

                  // Use ElevenLabs for disconnect message
                  await synthesizeVoiceResponse(
                        twiml,
                        disconnectMessage,
                        {
                              campaignId: call?.campaignId?.toString(),
                              language: campaign?.primaryLanguage === 'hi' ? 'hi' : 'en'
                        }
                  );

                  twiml.hangup();
            }
      } catch (error) {
            logger.error(`Error in gather webhook for call ${callId}:`, error);

            // Send error fallback TwiML
            const twiml = new twilio.twiml.VoiceResponse();

            // Get message from configuration
            const config = await Configuration.findOne();
            const errorMessage = config?.errorMessages?.technicalIssue || 'We apologize, but there was a technical issue. Please try again later.';

            // Use ElevenLabs for error message
            await synthesizeVoiceResponse(twiml, errorMessage, {});
            twiml.hangup();

            reply.type('text/xml');
            reply.send(twiml.toString());
      }
}
/**
 * Handles Twilio stream webhook via WebSocket
 * Processes real-time audio streams from the call
 */
export function handleTwilioStreamWebhook(ws: WebSocket, req: FastifyRequest) {
      // Log warning about legacy route usage
      logger.info('Legacy Twilio /stream route in use; dedicated TwilioWebSocketServer is recommended', {
            url: req.raw.url,
            userAgent: req.headers['user-agent']
      });

      let callId: string | undefined;
      let conversationId: string | undefined;
      let streamSid: string | undefined;
      let audioBuffer: Buffer[] = [];
      let sequenceNumber = 0;
      let isProcessingAudio = false;

      // Helper function to send audio back to Twilio
      const sendAudioToTwilio = (audioData: Buffer) => {
            if (!streamSid || ws.readyState !== WebSocket.OPEN) {
                  return;
            }

            const message = {
                  event: 'media',
                  streamSid: streamSid,
                  media: {
                        track: 'outbound',
                        chunk: (++sequenceNumber).toString(),
                        timestamp: Date.now().toString(),
                        payload: audioData.toString('base64')
                  }
            };

            ws.send(JSON.stringify(message));
      };

      ws.on('message', async (data) => {
            let msg;
            try {
                  msg = JSON.parse(data.toString());
            } catch (error) {
                  logger.error('Failed to parse WebSocket message:', error);
                  // Send proper error response to Twilio
                  if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({
                              event: 'error',
                              error: 'Invalid JSON message format'
                        }));
                  }
                  return;
            }

            if (msg.event === 'start') {
                  streamSid = msg.streamSid || msg.start?.streamSid;

                  // Extract callId and conversationId from URL path or custom parameters
                  const urlPath = req.raw.url || '';
                  // Support legacy paths and the new simplified path
                  const pathMatch = urlPath.match(/\/voice\/(?:optimized-stream|low-latency|stream)\/([^\/]+)\/([^\/\?]+)/);
                  if (pathMatch) {
                        callId = pathMatch[1];
                        conversationId = pathMatch[2];
                  } else {
                        // Try to extract from query parameters: /voice/stream?callId=...&conversationId=...
                        try {
                              const parsed = new URL(urlPath, 'ws://placeholder');
                              const qCallId = parsed.searchParams.get('callId');
                              const qConversationId = parsed.searchParams.get('conversationId');
                              if (qCallId) callId = qCallId;
                              if (qConversationId) conversationId = qConversationId;
                        } catch { } // Ignore URL parsing errors
                        // Fall back to Twilio customParameters sent in the start event
                        if (msg.start?.customParameters) {
                              callId = callId || msg.start.customParameters.callId;
                              conversationId = conversationId || msg.start.customParameters.conversationId;
                        }
                  }

                  logger.info(`Media stream started for call ${callId}, conv ${conversationId}, streamSid: ${streamSid}`);

                  // Note: This is a legacy handler. The main implementation in TwilioWebSocketServer
                  // now correctly sends the required "connected" acknowledgment after the start event.
                  // This legacy handler maintains old behavior for compatibility.
                  return;
            }

            if (!callId || !conversationId || !streamSid) {
                  // still waiting for start event with proper parameters
                  return;
            }

            if (msg.event === 'media' && msg.media?.payload) {
                  // Process inbound audio chunk
                  const payload = msg.media.payload; // base64-encoded audio
                  const audioChunk = Buffer.from(payload, 'base64');
                  audioBuffer.push(audioChunk);

                  // Process accumulated audio when we have enough data (ultra-low latency)
                  const totalBufferSize = audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
                  if (totalBufferSize >= 1024 && !isProcessingAudio) { // 1KB threshold for faster processing
                        isProcessingAudio = true;
                        const completeAudio = Buffer.concat(audioBuffer);
                        audioBuffer = []; // Reset buffer

                        try {
                              // Process audio immediately without setImmediate for lower latency
                              processAudioChunk(completeAudio, callId!, conversationId!, sendAudioToTwilio)
                                    .catch(error => {
                                          logger.error(`Error processing audio for call ${callId}:`, error);
                                    })
                                    .finally(() => {
                                          isProcessingAudio = false;
                                    });
                        } catch (error) {
                              logger.error(`Error setting up audio processing for call ${callId}:`, error);
                              isProcessingAudio = false;
                        }
                  }
            } else if (msg.event === 'stop') {
                  logger.info(`Media stream stopped for call ${callId}`);
                  streamSid = undefined;
                  audioBuffer = [];
            }
            // Handle other events if needed...
      });

      ws.on('close', () => {
            logger.info(`Media stream closed for call ${callId}`);
            audioBuffer = [];
      });
}

/**
 * Process an audio chunk and generate AI response
 */
async function processAudioChunk(
      audioData: Buffer,
      callId: string,
      conversationId: string,
      sendAudioToTwilio: (audio: Buffer) => void
): Promise<void> {
      try {
            logger.info(`Processing audio chunk for call ${callId}, size: ${audioData.length} bytes`);

            // Get configuration for speech services
            const config = await Configuration.findOne();
            if (!config) {
                  logger.error('No configuration found for audio processing');
                  return;
            }

            // Get conversation session
            let session = conversationEngine.getSession(conversationId);
            if (!session) {
                  logger.warn(`No session found for conversation ${conversationId}, creating new one`);
                  const call = await Call.findById(callId);
                  if (!call) {
                        logger.error(`No call found with ID ${callId}`);
                        return;
                  }

                  const newConversationId = await conversationEngine.startConversation(
                        callId,
                        call.leadId.toString(),
                        call.campaignId.toString(),
                        call.personalityId
                  );
                  session = conversationEngine.getSession(newConversationId);
                  if (!session) {
                        logger.error('Failed to create conversation session');
                        return;
                  }
            }

            // Transcribe audio using available speech recognition service
            let transcribedText = '';

            // Try to use Deepgram if configured
            if (config.deepgramConfig?.isEnabled && config.deepgramConfig?.apiKey) {
                  try {
                        const speechAnalysisService = conversationEngine.getSpeechAnalysisService();
                        const transcriptionResult = await speechAnalysisService.transcribeAudio(audioData);
                        transcribedText = transcriptionResult.transcript || '';

                        logger.info(`Deepgram transcription for call ${callId}: "${transcribedText.substring(0, 100)}"...`);
                  } catch (deepgramError) {
                        logger.error(`Deepgram transcription failed for call ${callId}:`, deepgramError);
                  }
            }

            // Skip processing if no meaningful speech detected
            if (!transcribedText || transcribedText.trim().length < 3) {
                  logger.debug(`No meaningful speech detected for call ${callId}`);
                  return;
            }

            // Process the transcribed text with conversation engine
            const aiResponse = await conversationEngine.processUserInput(conversationId, transcribedText);

            logger.info(`AI response for call ${callId}: "${aiResponse.text.substring(0, 100)}"...`);

            // Generate speech from AI response
            await generateAndSendAudioResponse(aiResponse.text, callId, session, config, sendAudioToTwilio);

      } catch (error) {
            logger.error(`Error in processAudioChunk for call ${callId}:`, error);
      }
}

/**
 * Generate audio from AI response and send to Twilio
 */
async function generateAndSendAudioResponse(
      responseText: string,
      callId: string,
      session: any,
      config: any,
      sendAudioToTwilio: (audio: Buffer) => void
): Promise<void> {
      try {
            // Get voice configuration
            const call = await Call.findById(callId);
            const campaign = call ? await Campaign.findById(call.campaignId) : null;

            // Determine voice ID
            const voiceId = call?.personalityId ||
                  session.currentPersonality?.voiceId ||
                  campaign?.voiceConfiguration?.voiceId ||
                  config?.voiceAIConfig?.conversationalAI?.defaultVoiceId ||
                  'default';

            // Get TTS provider configuration
            const selectedTTSProvider = config.ttsConfig?.provider || 'elevenlabs';

            if (selectedTTSProvider === 'elevenlabs' && config.elevenLabsConfig?.isEnabled) {
                  // Use ElevenLabs for synthesis
                  const voiceAI = getVoiceAIService();
                  const speechResponse = await voiceAI.synthesizeAdaptiveVoice({
                        text: responseText,
                        personalityId: voiceId,
                        language: session.language === 'Hindi' ? 'hi' : 'en'
                  });

                  if (speechResponse?.audioContent) {
                        sendAudioToTwilio(speechResponse.audioContent);
                        logger.info(`Sent ElevenLabs audio response for call ${callId}`);
                  }
            } else if (selectedTTSProvider === 'deepgram' && config.deepgramConfig?.isEnabled) {
                  // Use Deepgram TTS
                  const { synthesizeSpeechWithProvider } = await import('../utils/ttsServiceFactory');
                  const speechResponse = await synthesizeSpeechWithProvider(
                        config,
                        responseText,
                        voiceId,
                        session.language === 'Hindi' ? 'hi' : 'en'
                  );

                  if (speechResponse?.audioContent) {
                        sendAudioToTwilio(speechResponse.audioContent);
                        logger.info(`Sent Deepgram audio response for call ${callId}`);
                  }
            } else {
                  logger.warn(`TTS provider ${selectedTTSProvider} not configured or available for call ${callId}`);
            }

      } catch (error) {
            logger.error(`Error generating audio response for call ${callId}:`, error);
      }
}
/**
 * Update a call with outcome and notes
 */
export async function updateCallWithOutcome(callId: string, outcome: string, notes?: string): Promise<ICall | null> {
      try {
            logger.debug(`Updating call ${callId} with outcome: ${outcome}`);

            const updatedCall = await Call.findByIdAndUpdate(
                  callId,
                  {
                        $set: {
                              outcome,
                              notes,
                              updatedAt: new Date()
                        }
                  },
                  { new: true }
            );

            if (!updatedCall) {
                  logger.warn(`Call not found for outcome update: ${callId}`);
                  return null;
            }

            // Add outcome to metrics if it doesn't already exist
            if (!updatedCall.metrics?.outcome) {
                  await Call.findByIdAndUpdate(
                        callId,
                        {
                              $set: {
                                    'metrics.outcome': outcome
                              }
                        }
                  );
            }

            return updatedCall;
      } catch (error) {
            logger.error(`Error updating call outcome for ${callId}:`, error);
            throw error;
      }
}
/**
 * Generate comprehensive call metrics after a call is completed
 */
async function generateCallMetrics(callId: string): Promise<void> {
      try {
            const call = await Call.findById(callId);
            if (!call) {
                  logger.error(`No call found with ID ${callId} for metrics generation`);
                  return;
            }

            // Calculate base metrics
            const outcome = call.status === 'completed' ? 'connected' : call.status;

            // Get conversation log if available
            const conversationLog = call.conversationLog || [];

            // Calculate advanced metrics
            const metrics = {
                  duration: call.duration || 0,
                  outcome: outcome as 'connected' | 'no-answer' | 'busy' | 'failed' | 'voicemail',
                  conversationMetrics: {
                        customerEngagement: calculateEngagementScore(conversationLog),
                        emotionalTone: extractEmotionalTones(conversationLog),
                        objectionCount: await countObjections(conversationLog),
                        interruptionCount: countInterruptions(conversationLog),
                        conversionIndicators: identifyConversionIndicators(conversationLog)
                  },
                  qualityScore: calculateQualityScore(call),
                  complianceScore: calculateComplianceScore(call, conversationLog),
                  intentDetection: await detectIntent(conversationLog),
                  callRecordingUrl: call.recordingUrl,
                  transcriptionAnalysis: await analyzeTranscription(conversationLog)
            };

            // Save metrics to the call record
            await Call.findByIdAndUpdate(callId, {
                  metrics,
                  updatedAt: new Date()
            });

            logger.info(`Generated comprehensive metrics for call ${callId}`);
      } catch (error) {
            logger.error(`Error generating metrics for call ${callId}:`, error);
      }
}
// Helper functions for metrics calculation
function calculateEngagementScore(conversationLog: Array<{ role: string, content: string }>): number {
      // Calculate engagement based on conversation length, response times, etc.
      if (conversationLog.length === 0) return 0;

      // More interactions = higher engagement
      const interactionScore = Math.min(conversationLog.length / 20, 1); // Max at 20 interactions

      // Longer user responses = higher engagement
      const userMessages = conversationLog.filter(entry => entry.role === 'user');
      const avgUserLength = userMessages.reduce((sum, entry) => sum + entry.content.length, 0) / (userMessages.length || 1);
      const lengthScore = Math.min(avgUserLength / 100, 1); // Max at 100 chars average

      return (interactionScore * 0.6 + lengthScore * 0.4);
}
async function countObjections(conversationLog: Array<{ role: string, content: string, intent?: string }>): Promise<number> {
      // Use LLM-detected intents when available
      const explicitObjections = conversationLog.filter(entry =>
            entry.role === 'user' && entry.intent === 'objection'
      ).length;

      // If no explicit objections are tagged, analyze content
      if (explicitObjections === 0) {
            // Get configuration for dynamic objection phrases
            try {
                  const config = require('../models/Configuration').default;
                  const configDoc = await config.findOne();
                  const objectionPhrases = configDoc?.intentDetection?.objectionPhrases || [];

                  // Count objections based on configured phrases
                  return conversationLog.filter(entry =>
                        entry.role === 'user' &&
                        objectionPhrases.some(phrase =>
                              entry.content.toLowerCase().includes(phrase.toLowerCase())
                        )
                  ).length;
            } catch (error) {
                  return 0;
            }
      }

      return explicitObjections;
}
function countInterruptions(conversationLog: Array<{ role: string, content: string, timestamp?: Date }>): number {
      // Count interruptions based on timestamp overlaps and context
      // An interruption occurs when a user starts speaking before the AI has finished
      if (conversationLog.length < 3) {
            return 0; // Not enough entries to detect interruptions
      }

      let interruptionCount = 0;
      const interruptionThresholdMs = 500; // Threshold in milliseconds to consider it an interruption

      // Start from index 2 to check AI -> User -> AI pattern
      for (let i = 2; i < conversationLog.length; i += 2) {
            const previousAI = conversationLog[i - 2];
            const user = conversationLog[i - 1];
            const currentAI = conversationLog[i];

            // Skip if any of the entries are not the expected roles
            if (previousAI.role !== 'assistant' || user.role !== 'user' || currentAI.role !== 'assistant') {
                  continue;
            }

            // Check for interruption indicators in timestamps if available
            if (previousAI.timestamp && user.timestamp) {
                  // Calculate expected AI speaking time based on text length (roughly 100ms per character)
                  const expectedSpeakingTimeMs = previousAI.content.length * 100;

                  // If user started speaking too soon after AI started
                  const timeDiffMs = user.timestamp.getTime() - previousAI.timestamp.getTime();
                  if (timeDiffMs < expectedSpeakingTimeMs - interruptionThresholdMs) {
                        interruptionCount++;
                        continue;
                  }
            }

            // Check for interruption phrases
            const interruptionPhrases = [
                  "excuse me", "hold on", "wait", "let me stop you", "can I",
                  "I need to", "actually", "sorry to interrupt"
            ];

            // If user message starts with an interruption phrase
            const userLower = user.content.toLowerCase().trim();
            if (interruptionPhrases.some(phrase => userLower.startsWith(phrase))) {
                  interruptionCount++;
                  continue;
            }

            // If AI response acknowledges interruption
            const aiLower = currentAI.content.toLowerCase();
            if (
                  aiLower.includes("sorry for interrupting") ||
                  aiLower.includes("let me continue") ||
                  aiLower.includes("as I was saying") ||
                  aiLower.includes("to finish my thought")
            ) {
                  interruptionCount++;
            }
      }

      return interruptionCount;
}
function identifyConversionIndicators(conversationLog: Array<{ role: string, content: string }>): string[] {
      // Identify positive indicators of conversion
      const indicators: string[] = [];

      const userMessages = conversationLog
            .filter(entry => entry.role === 'user')
            .map(entry => entry.content.toLowerCase());

      // Check for positive responses
      if (userMessages.some(msg => /yes|interested|tell me more|sounds good|great/i.test(msg))) {
            indicators.push('expressed_interest');
      }

      // Check for questions asking for details
      if (userMessages.some(msg => /how much|when can|what is the|how does|pricing|cost/i.test(msg))) {
            indicators.push('asked_details');
      }

      // Check for commitment language
      if (userMessages.some(msg => /sign up|register|buy|purchase|get started/i.test(msg))) {
            indicators.push('commitment_language');
      }

      // Check for contact information sharing
      if (userMessages.some(msg => /@|email|phone|contact/i.test(msg))) {
            indicators.push('shared_contact_info');
      }

      return indicators;
}
function calculateQualityScore(call: ICall): number {
      // Calculate an overall quality score for the call
      if (call.status !== 'completed') return 0;

      // Base score on duration (longer calls typically = more engagement)
      const durationScore = Math.min((call.duration || 0) / 300, 1); // Normalize to 0-1, max at 5 minutes

      // Add bonus for positive outcomes
      const outcomeBonus = ['interested', 'callback-requested'].includes(call.outcome || '') ? 0.2 : 0;

      return Math.min(durationScore * 0.8 + 0.2 + outcomeBonus, 1);
}
function calculateComplianceScore(call: ICall, conversationLog: Array<{ role: string, content: string }>): number {
      // Calculate compliance score based on script adherence
      if (!call.complianceScriptId) return 1.0; // No compliance required

      let score = 1.0;

      // Check if AI properly introduced itself
      const aiIntroductions = conversationLog.filter(entry =>
            entry.role === 'assistant' &&
            (entry.content.includes('automated call') ||
                  entry.content.includes('AI assistant') ||
                  entry.content.includes('calling from'))
      );

      if (aiIntroductions.length === 0) score -= 0.3;

      // Check if consent was obtained when required
      const consentPhrases = conversationLog.filter(entry =>
            entry.role === 'assistant' &&
            (entry.content.includes('permission') ||
                  entry.content.includes('consent') ||
                  entry.content.includes('okay to continue'))
      );

      if (consentPhrases.length === 0) score -= 0.2;

      return Math.max(score, 0);
}
function extractEmotionalTones(conversationLog: Array<{ role: string, content: string, emotion?: string }>): string[] {
      // Extract emotional tones from conversation log
      if (conversationLog.length === 0) return [];

      // Collect emotions from explicitly tagged entries
      const explicitEmotions = conversationLog
            .filter(entry => entry.emotion)
            .map(entry => entry.emotion as string);

      if (explicitEmotions.length > 0) {
            // Return unique emotions
            return [...new Set(explicitEmotions)];
      }

      // Fall back to basic sentiment analysis if no explicit emotions
      const emotionalKeywords = {
            'positive': ['great', 'excellent', 'wonderful', 'amazing', 'fantastic', 'love', 'like', 'good', 'yes', 'interested'],
            'negative': ['bad', 'terrible', 'awful', 'hate', 'dislike', 'no', 'not interested', 'angry', 'frustrated'],
            'neutral': ['okay', 'maybe', 'think', 'consider', 'unsure'],
            'excited': ['excited', 'eager', 'can\'t wait', 'looking forward'],
            'concerned': ['worried', 'concerned', 'nervous', 'hesitant', 'unsure'],
            'confused': ['confused', 'don\'t understand', 'unclear', 'what do you mean']
      };

      const detectedEmotions = new Set<string>();

      conversationLog
            .filter(entry => entry.role === 'user')
            .forEach(entry => {
                  const content = entry.content.toLowerCase();

                  for (const [emotion, keywords] of Object.entries(emotionalKeywords)) {
                        if (keywords.some(keyword => content.includes(keyword))) {
                              detectedEmotions.add(emotion);
                        }
                  }
            });

      // Return detected emotions or default to neutral
      const result = Array.from(detectedEmotions);
      return result.length > 0 ? result : ['neutral'];
}
async function detectIntent(conversationLog: Array<{ role: string, content: string, intent?: string }>): Promise<{
      primaryIntent: string;
      confidence: number;
      secondaryIntents: Array<{ intent: string, confidence: number }>;
}> {
      // Simplified intent detection
      const userEntries = conversationLog.filter(entry => entry.role === 'user');

      if (userEntries.length === 0) {
            return {
                  primaryIntent: 'unknown',
                  confidence: 0,
                  secondaryIntents: []
            };
      }

      // Look for explicit intents first
      const intents = userEntries
            .filter(entry => entry.intent)
            .map(entry => entry.intent as string);

      if (intents.length > 0) {
            // Count intent frequencies
            const intentCounts = intents.reduce((acc, intent) => {
                  acc[intent] = (acc[intent] || 0) + 1;
                  return acc;
            }, {} as Record<string, number>);

            // Sort by frequency
            const sortedIntents = Object.entries(intentCounts)
                  .sort((a, b) => b[1] - a[1])
                  .map(([intent, count]) => ({
                        intent,
                        confidence: count / intents.length
                  }));

            return {
                  primaryIntent: sortedIntents[0].intent,
                  confidence: sortedIntents[0].confidence,
                  secondaryIntents: sortedIntents.slice(1)
            };
      }

      // No explicit intents available, use voiceAIService for detection
      try {
            const { voiceAIService } = require('../services');
            const userTexts = userEntries.map(entry => entry.content).join(' ');

            const result = await voiceAIService.detectIntent(userTexts);
            return {
                  primaryIntent: result.primaryIntent || 'general_conversation',
                  confidence: result.confidence || 0.5,
                  secondaryIntents: result.secondaryIntents || []
            };
      } catch (error) {
            // If import fails, return default intent
            return {
                  primaryIntent: 'general_conversation',
                  confidence: 0.5,
                  secondaryIntents: []
            };
      }
}
async function analyzeTranscription(conversationLog: Array<{ role: string, content: string }>): Promise<{
      keyPhrases: string[];
      sentimentBySegment: Array<{ segment: string, sentiment: number }>;
      followUpRecommendations: string[];
}> {
      // Extract user messages
      const userMessages = conversationLog
            .filter(entry => entry.role === 'user')
            .map(entry => entry.content);

      if (userMessages.length === 0) {
            return {
                  keyPhrases: [],
                  sentimentBySegment: [],
                  followUpRecommendations: ['No user input detected']
            };
      }

      try {
            // Use LLM service for real sentiment analysis
            const { llmService } = require('../services');

            const result = await llmService.analyzeConversation({
                  messages: userMessages,
                  analyzeFor: ['sentiment', 'keyPhrases', 'followUpRecommendations']
            });

            return {
                  keyPhrases: result.keyPhrases || [],
                  sentimentBySegment: result.sentimentBySegment || [],
                  followUpRecommendations: result.followUpRecommendations || []
            };
      } catch (error) {
            // Fall back to default response if LLM service fails
            return {
                  keyPhrases: ['Error processing conversation'],
                  sentimentBySegment: userMessages.map(msg => ({ segment: msg.substring(0, 50), sentiment: 0 })),
                  followUpRecommendations: ['Follow up with standard process']
            };
      }
}
// Helper function to handle chunked audio text in TwiML using proper TTS chain
async function handleChunkedAudioForTwiML(
      twiml: any,
      audioText: string,
      language: string = 'en',
      options: { callId?: string; campaignId?: string } = {}
) {
      try {
            // Check if this is a chunked audio request
            if (audioText && audioText.startsWith('USE_CHUNKED_AUDIO:')) {
                  // Extract the full text from the marker
                  const fullText = audioText.substring('USE_CHUNKED_AUDIO:'.length);

                  // Check for special error markers
                  const hasCloudinaryError = fullText.startsWith('[CLOUDINARY_ERROR]');
                  const cleanText = hasCloudinaryError
                        ? fullText.substring('[CLOUDINARY_ERROR]'.length).trim()
                        : fullText;

                  if (hasCloudinaryError) {
                        logger.warn('Detected Cloudinary error in chunked audio, using extra-small chunks');
                  }

                  // Use smaller chunks for Cloudinary errors, regular chunks otherwise
                  const chunkSize = hasCloudinaryError ? 150 : 300;
                  const chunks = splitTextIntoChunks(cleanText, chunkSize);
                  logger.info(`Split text into ${chunks.length} chunks (${chunkSize} chars max) for TTS`);

                  // Try to synthesize each chunk with the configured TTS provider
                  for (const chunk of chunks) {
                        if (!chunk.trim()) continue;

                        const ttsResult = await synthesizeWithTTSChain(chunk, {
                              callId: options.callId,
                              campaignId: options.campaignId,
                              language
                        });

                        if (ttsResult.success && ttsResult.audioContent) {
                              // Use the TTS provider synthesized audio
                              try {
                                    const { processAudioForTwiML } = await import('../utils/voiceSynthesis');
                                    const audioResult = await processAudioForTwiML(
                                          ttsResult.audioContent,
                                          chunk,
                                          language
                                    );
                                    twiml.play(prepareUrlForTwilioPlay(audioResult.url));
                              } catch (audioError) {
                                    logger.warn(`Failed to process TTS audio for chunk, using Twilio fallback: ${audioError}`);
                                    // Fallback to Twilio voice only if TTS audio processing fails
                                    if (ttsResult.twilioVoiceConfig) {
                                          twiml.say(ttsResult.twilioVoiceConfig, chunk);
                                    } else {
                                          twiml.say({
                                                voice: 'alice',
                                                language: language === 'hi' ? 'hi-IN' : 'en-US'
                                          }, chunk);
                                    }
                              }
                        } else if (ttsResult.shouldUseTwilioFallback) {
                              // Use Twilio voice as last resort
                              const voiceConfig = ttsResult.twilioVoiceConfig || {
                                    voice: 'alice',
                                    language: language === 'hi' ? 'hi-IN' : 'en-US'
                              };
                              twiml.say(voiceConfig, chunk);
                        }
                  }
                  return true; // Indicates we handled the chunked audio
            }
            return false; // Not a chunked audio request
      } catch (error) {
            logger.error(`Error in handleChunkedAudioForTwiML: ${error.message}`);
            // Graceful fallback - use Twilio voices if everything fails
            if (audioText?.startsWith('USE_CHUNKED_AUDIO:')) {
                  const fullText = audioText.substring('USE_CHUNKED_AUDIO:'.length);
                  const cleanText = fullText.startsWith('[CLOUDINARY_ERROR]')
                        ? fullText.substring('[CLOUDINARY_ERROR]'.length).trim()
                        : fullText;

                  const chunks = splitTextIntoChunks(cleanText, 200);
                  for (const chunk of chunks) {
                        if (chunk.trim()) {
                              twiml.say({
                                    voice: 'alice',
                                    language: language === 'hi' ? 'hi-IN' : 'en-US'
                              }, chunk);
                        }
                  }
                  return true;
            }
            return false;
      }
}

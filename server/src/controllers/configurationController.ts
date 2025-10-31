import { FastifyRequest, FastifyReply } from 'fastify';
import axios from 'axios';
import twilio from 'twilio';
import { getErrorMessage, logger } from '../index';
import Configuration from '../models/Configuration';
import {
  BaseLLMProvider, UpdatedConfig,
  UpdateLLMProvider
} from '../types/configuration';
import {
  handleApiKeyUpdate,
  handleObjectUpdate, maskSensitiveValues
} from '../utils/configHelpers';
import {
  validateDeepgramKey,
  validateElevenLabsKey,
  validateGeneralSettings,
  validateLLMParameters,
  validateVoiceParameters
} from '../utils/configValidation';
import {
  verifyAndUpdateElevenLabsApiStatus
} from '../utils/elevenLabsVerification';
import {
  verifyAndUpdateDeepgramTTSApiStatus
} from '../utils/deepgramTTSVerification';

// All interfaces moved to /types/configuration.ts

// Helper function to handle unknown errors
const handleError = (error: unknown): string => {
  return getErrorMessage(error);
};

/**
 * Update all services with new API keys from configuration
 * @param configuration The updated configuration object
 */
const updateServicesWithNewConfig = async (configuration: any): Promise<void> => {
  try {
    const { initializeSpeechService } = require('../services/realSpeechService');
    
    // Get the selected TTS provider
    const selectedTTSProvider = configuration.ttsConfig?.provider || 'elevenlabs';
    logger.info(`Updating services for selected TTS provider: ${selectedTTSProvider}`);
    
    // Get API keys from configuration
    let elevenLabsKey = '';
    let openAIKey = '';
    let anthropicKey = '';
    
    // Only initialize ElevenLabs services if it's the selected TTS provider
    if (selectedTTSProvider === 'elevenlabs' && configuration.elevenLabsConfig?.apiKey) {
      elevenLabsKey = configuration.elevenLabsConfig.apiKey;
      // Reinitialize speech service with new key
      initializeSpeechService(
        elevenLabsKey, 
        require('path').join(__dirname, '../../uploads/audio')
      );
      logger.info('ElevenLabs speech service updated with new API key');
    } else if (selectedTTSProvider !== 'elevenlabs') {
      logger.info(`Skipping ElevenLabs service initialization - selected TTS provider is ${selectedTTSProvider}`);
    }
    
    // Initialize TTS Provider Service with the selected provider
    try {
      const { initializeTTSProviderService } = await import('../services/ttsProviderService');
      await initializeTTSProviderService();
      logger.info(`TTS Provider Service initialized for provider: ${selectedTTSProvider}`);
    } catch (error) {
      logger.warn(`Failed to initialize TTS Provider Service: ${getErrorMessage(error)}`);
    }
    
    // Get LLM provider keys
    if (configuration.llmConfig?.providers) {
      const openAIProvider = configuration.llmConfig.providers.find((p: any) => p.name === 'openai');
      if (openAIProvider?.apiKey) {
        openAIKey = openAIProvider.apiKey;
      }
      
      const anthropicProvider = configuration.llmConfig.providers.find((p: any) => p.name === 'anthropic');
      if (anthropicProvider?.apiKey) {
        anthropicKey = anthropicProvider.apiKey;
      }
    }
    
    // Update global services - only pass ElevenLabs key if it's the selected provider
    const effectiveElevenLabsKey = selectedTTSProvider === 'elevenlabs' ? elevenLabsKey : '';
    
    if (global.conversationEngine && typeof global.conversationEngine.updateApiKeys === 'function') {
      global.conversationEngine.updateApiKeys(effectiveElevenLabsKey, openAIKey, anthropicKey);
      logger.info('Conversation engine updated with new API keys');
    }
    
    if (global.campaignService && typeof global.campaignService.updateApiKeys === 'function') {
      global.campaignService.updateApiKeys(effectiveElevenLabsKey, openAIKey, anthropicKey);
      logger.info('Campaign service updated with new API keys');
    }
    
    logger.info(`All services updated with new configuration for TTS provider: ${selectedTTSProvider}`);
  } catch (error) {
    logger.error(`Error updating services with new config: ${getErrorMessage(error)}`);
  }
};

// @desc    Get system configuration
// @route   GET /api/configuration
// @access  Private
export const getSystemConfiguration = async (_req: FastifyRequest, res: FastifyReply) => {
  try {
    logger.info('Fetching system configuration');
    
    // Get or create configuration
    let configuration = await Configuration.findOne();
    
    if (!configuration) {
      // Create default configuration if none exists
      configuration = await Configuration.create({
        twilioConfig: {
          accountSid: '',
          authToken: '',
          phoneNumbers: [],
          isEnabled: false
        },
        elevenLabsConfig: {
          apiKey: '',
          availableVoices: [],
          isEnabled: false,
          voiceSpeed: 1.0,
          voiceStability: 0.8,
          voiceClarity: 0.9
        },
        llmConfig: {
          providers: [
            {
              name: 'openai',
              apiKey: '',
              availableModels: ['gpt-3.5-turbo', 'gpt-4'],
              isEnabled: false
            }
          ],
          defaultProvider: 'openai',
          defaultModel: 'gpt-4o',
          temperature: 0.7,
          maxTokens: 150
        },
        generalSettings: {
          defaultLanguage: 'English',
          supportedLanguages: ['English', 'Hindi'],
          maxConcurrentCalls: 10,
          callRetryAttempts: 3,
          callRetryDelay: 30,
          maxCallDuration: 300, // 5 minutes
          retryAttempts: 3,
          retryDelay: 60, // in minutes
        },
        voiceAIConfig: {
          personalities: [],
          bilingualSupport: {
            enabled: false,
            primaryLanguage: 'English',
            secondaryLanguage: 'Hindi',
            autoLanguageDetection: true
          },
          conversationFlow: {
            personalityAdaptation: true,
            contextAwareness: true,
            naturalPauses: true
          },
          conversationalAI: {
            enabled: true,
            useSDK: true,
            interruptible: true,
            adaptiveTone: true,
            naturalConversationPacing: true,
            voiceSettings: {
              speed: 1.0,
              stability: 0.8,
              style: 0.3
            },
            defaultVoiceId: '',
            defaultModelId: 'eleven_multilingual_v2'
          }
        },
        complianceSettings: {
          recordCalls: true,
          maxCallsPerLeadPerDay: 1,
          callBlackoutPeriod: {
            start: '21:00',
            end: '08:00'
          }
        },
        webhookConfig: {
          secret: ''
        },
        errorMessages: {
          generalError: "I'm sorry, but I'm having a technical issue. Please try again later.",
          aiResponseError: "I apologize, I'm having trouble generating a response right now.",
          speechRecognitionError: "I'm sorry, I'm having trouble understanding. Could you please repeat that?",
          noCallFound: "I'm sorry, but I cannot find your call record.",
          configurationError: "We apologize, but there was a configuration error.",
          serverError: "We apologize, but there was a server configuration error.",
          technicalIssue: "We apologize, but there was a technical issue. Please try again later.",
          noSpeechDetected: "I'm sorry, I didn't hear anything. Please speak again.",
          callDisconnected: "I'm sorry, we seem to be having difficulty. Thank you for your time. Goodbye."
        },
        closingScripts: {
          default: "Thank you for your time. Have a great day!",
          consentReceived: "Thank you for your interest. I'll send you the information shortly.",
          withObjections: "I understand. Thank you for your feedback. Have a good day."
        },
        intentDetection: {
          closingPhrases: ["goodbye", "bye", "end call", "hang up", "that's all"],
          objectionPhrases: ["not interested", "don't need", "too expensive", "not right now"]
        },
        deepgramConfig: {
          apiKey: process.env.DEEPGRAM_API_KEY || '',
          isEnabled: !!process.env.DEEPGRAM_API_KEY,
          primaryModel: '',
          fallbackModels: [],
          autoFallback: true,
          tier: 'enhanced',
          retryAttempts: 3,
          timeoutMs: 30000,
          status: process.env.DEEPGRAM_API_KEY ? 'unverified' : 'unverified'
        }
      });
    }

    // Ensure deepgramConfig exists and has environment variable fallback
    if (!configuration.deepgramConfig) {
      configuration.deepgramConfig = {
        apiKey: process.env.DEEPGRAM_API_KEY || '',
        isEnabled: !!process.env.DEEPGRAM_API_KEY,
        primaryModel: '',
        fallbackModels: [],
        autoFallback: true,
        tier: 'enhanced',
        retryAttempts: 3,
        timeoutMs: 30000,
        status: process.env.DEEPGRAM_API_KEY ? 'unverified' : 'unverified'
      };
      await configuration.save();
    }

    // Remove sensitive information before sending to client
    const configToSend = configuration.toObject();
    
    // Note: We no longer mask API keys in responses since the frontend uses password inputs for security
    // The UI handles masking through password input components
    
    // Log what we're sending back to the client (sanitized)
    logger.info('Sending system configuration to client with fields:', {
      elevenLabsConfig: {
        voiceSpeed: configToSend.elevenLabsConfig.voiceSpeed,
        voiceStability: configToSend.elevenLabsConfig.voiceStability,
        voiceClarity: configToSend.elevenLabsConfig.voiceClarity,
        isEnabled: configToSend.elevenLabsConfig.isEnabled,
      },
      llmConfig: {
        defaultProvider: configToSend.llmConfig.defaultProvider,
        defaultModel: configToSend.llmConfig.defaultModel,
        temperature: configToSend.llmConfig.temperature,
        maxTokens: configToSend.llmConfig.maxTokens,
      },
      generalSettings: {
        maxCallDuration: configToSend.generalSettings.maxCallDuration,
        defaultSystemPrompt: configToSend.generalSettings.defaultSystemPrompt ? 'SET' : 'NOT SET',
        defaultTimeZone: configToSend.generalSettings.defaultTimeZone,
      },
      voiceAIConfig: {
        bilingualSupportEnabled: configToSend.voiceAIConfig?.bilingualSupport?.enabled ?? false,
        conversationalAIEnabled: configToSend.voiceAIConfig?.conversationalAI?.enabled ?? true
      },
      webhookConfig: {
        // Do not send URL to frontend - it's managed via environment variable
        secret: configToSend.webhookConfig.secret ? 'SET' : 'NOT SET',
        status: configToSend.webhookConfig.status || 'unverified'
      }
    });

    res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.header('Pragma', 'no-cache');
    res.header('Expires', '0');
    res.status(200).send(configToSend);
  } catch (error) {
    logger.error('Error in getSystemConfiguration:', error);
    res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
    return;
  }
};


// Helper functions
// Enhanced version of isMaskedApiKey with more logging
const enhancedIsMaskedApiKey = (value: string | undefined): boolean => {
  if (!value) {
    logger.debug('Empty or undefined value passed to isMaskedApiKey - returning false');
    return false;
  }
  
  if (value === '') {
    logger.debug('Empty string explicitly passed to isMaskedApiKey - returning false');
    logger.info('Empty API key detected - this will clear the key from database');
    return false;
  }
  
  const isMasked = value.includes('••••••••');
  if (isMasked) {
    logger.debug('Detected masked API key pattern');
  }
  
  return isMasked;
};

// Update an API key if changed and valid
const updateApiKeyIfChanged = (newKey: string | undefined, existingKey: string): string => {
  if (typeof newKey === 'undefined') return existingKey;
  
  // If masked (has '••••••••'), keep existing key
  if (enhancedIsMaskedApiKey(newKey)) {
    logger.debug('Received masked API key, keeping existing value');
    return existingKey;
  }
  
  // If empty string is provided, it's an intentional clear
  if (newKey === '') {
    logger.info('API key explicitly cleared by user');
    logger.debug('Empty string detected - API key will be cleared in database');
    return ''; // Return empty string to clear the key in the database
  }
  
  logger.info('New API key provided, updating');
  return newKey;
};

const handleFieldUpdate = <T>(newValue: T | undefined, existingValue: T): T => {
  return typeof newValue === 'undefined' ? existingValue : newValue;
};


const validateProviderUpdate = (
  updated: UpdateLLMProvider | undefined, 
  existing: BaseLLMProvider
): BaseLLMProvider => {
  if (!updated) {
    return existing;
  }
  
  const finalApiKey = updateApiKeyIfChanged(updated.apiKey, existing.apiKey);
  
  let finalStatus = existing.status;
  let finalLastVerified = existing.lastVerified;

  const apiKeyEffectivelyChanged = (finalApiKey !== existing.apiKey);

  // Add detailed logging of the state at the beginning
  logger.info(`Provider ${existing.name}: Starting update - API key changed: ${apiKeyEffectivelyChanged}, Current status: ${existing.status}, Has verification date: ${existing.lastVerified ? 'Yes' : 'No'}`);

  // If API key has changed, always reset verification status
  if (apiKeyEffectivelyChanged) {
    logger.info(`Provider ${existing.name}: API key changed - resetting status to unverified and clearing lastVerified date`);
    finalStatus = 'unverified';
    finalLastVerified = null; 
  } else {
    // API key not changed
    if (typeof updated.status !== 'undefined') {
      // Client sent a status update
      logger.info(`Provider ${existing.name}: Client sent status update: ${updated.status} (current: ${existing.status})`);
      
      // Special handling for 'verified' status
      if (updated.status === 'verified' && existing.status !== 'verified') {
        // Only allow verified status if there's a verification date
        if (existing.lastVerified) {
          finalStatus = 'verified';
          logger.info(`Provider ${existing.name}: Accepting client's 'verified' status because verification date exists: ${existing.lastVerified}`);
        } else {
          finalStatus = existing.status || 'unverified';
          logger.info(`Provider ${existing.name}: Rejecting client's 'verified' status - no verification date exists`);
        }
      } else {
        // For other status changes (failed/unverified), accept client value
        finalStatus = updated.status;
      }
      
      // Handle lastVerified date
      if (typeof updated.lastVerified !== 'undefined') {
        finalLastVerified = updated.lastVerified;
        logger.info(`Provider ${existing.name}: Client sent lastVerified date: ${finalLastVerified}`);
      } else if (finalStatus === 'verified' && existing.lastVerified) {
        // Keep existing verification date if status is verified
        finalLastVerified = existing.lastVerified;
        logger.info(`Provider ${existing.name}: Keeping existing lastVerified date: ${finalLastVerified}`);
      }
    } else {
      // Client did not send status - preserve existing status and date if verified
      if (existing.status === 'verified' && existing.lastVerified) {
        logger.info(`Provider ${existing.name}: Preserving verified status and existing verification date`);
        finalStatus = 'verified';
        finalLastVerified = existing.lastVerified;
      }
    }
  }
  
  // Final status consistency check
  if (finalStatus === 'verified' && !finalLastVerified) {
    logger.warn(`Provider ${existing.name}: Status is 'verified' but has no lastVerified date - this is inconsistent`);
    if (existing.lastVerified) {
      finalLastVerified = existing.lastVerified;
      logger.info(`Provider ${existing.name}: Restored lastVerified date from existing provider`);
    }
  }
  
  logger.info(`Provider ${existing.name}: Final status: ${finalStatus}, Has final verification date: ${finalLastVerified ? 'Yes' : 'No'}`);
  
  return {
    ...existing, 
    name: updated.name || existing.name,
    apiKey: finalApiKey,
    availableModels: updated.availableModels ?? existing.availableModels,
    isEnabled: updated.isEnabled ?? existing.isEnabled,
    status: finalStatus,
    lastVerified: finalLastVerified,
  };
};

// @desc    Update system configuration
// @route   PUT /api/configuration
// @access  Private
export const updateSystemConfiguration = async (req: FastifyRequest, res: FastifyReply) => {
  const updatedConfig: UpdatedConfig = req.body as any;
  
  try {
    const config = await Configuration.findOne();
    
    if (!config) {
      logger.warn('Configuration not found');
      res.status(404).send({ 
        message: 'Configuration not found',
        success: false
      });
      return;
    }
    
    const existingConfig = config.toObject();
    
    // Validate and update Twilio config
    if (updatedConfig.twilioConfig) {
      logger.info('Updating Twilio configuration...');
      
      if (updatedConfig.twilioConfig.authToken) {
        const keyUpdate = handleApiKeyUpdate(updatedConfig.twilioConfig.authToken, existingConfig.twilioConfig.authToken);
        if (keyUpdate.error) {
          return res.status(400).send({ 
            message: 'Invalid Twilio auth token',
            error: keyUpdate.error 
          });
        }
        updatedConfig.twilioConfig.authToken = keyUpdate.key;
        
        // If auth token changed, reset status to unverified
        if (keyUpdate.updated) {
          logger.info('Twilio auth token changed, resetting status to unverified');
          updatedConfig.twilioConfig.status = 'unverified';
        }
      }
      
      config.twilioConfig = handleObjectUpdate(updatedConfig.twilioConfig, existingConfig.twilioConfig);
    }
    
    // Validate and update ElevenLabs config
    if (updatedConfig.elevenLabsConfig) {
      logger.info('Updating ElevenLabs configuration...');
      
      // Validate API key if provided
      if (updatedConfig.elevenLabsConfig.apiKey) {
        const validation = validateElevenLabsKey(updatedConfig.elevenLabsConfig.apiKey);
        if (!validation.isValid) {
          return res.status(400).send({ 
            message: 'Invalid ElevenLabs API key',
            error: validation.error 
          });
        }
        
        // If API key changed, reset status to unverified
        const apiKeyUpdate = handleApiKeyUpdate(updatedConfig.elevenLabsConfig.apiKey, existingConfig.elevenLabsConfig.apiKey);
        if (apiKeyUpdate.updated) {
          logger.info('ElevenLabs API key changed, resetting status to unverified');
          updatedConfig.elevenLabsConfig.status = 'unverified';
          
          // Verify the new API key immediately to catch potential issues
          try {
            const verificationResult = await verifyAndUpdateElevenLabsApiStatus(apiKeyUpdate.key);
            
            // Only update if verification completed (don't override status set above)
            if (verificationResult.success) {
              logger.info(`ElevenLabs API key verified successfully: ${verificationResult.message}`);
            } else {
              logger.warn(`ElevenLabs API key verification failed: ${verificationResult.error}`);
              
              // Only show warning in response if there's an unusual activity error
              if (verificationResult.isUnusualActivity) {
                // req.flash is not available, use a different method to display warnings
                logger.warn(`ElevenLabs Account Warning: ${verificationResult.message}`);
              }
            }
          } catch (verifyError) {
            logger.error(`Error verifying ElevenLabs API key: ${getErrorMessage(verifyError)}`);
          }
        }
      }
      
      // Validate voice parameters if provided
      const voiceValidation = validateVoiceParameters({
        voiceSpeed: updatedConfig.elevenLabsConfig.voiceSpeed,
        voiceStability: updatedConfig.elevenLabsConfig.voiceStability,
        voiceClarity: updatedConfig.elevenLabsConfig.voiceClarity
      });
      
      if (!voiceValidation.isValid) {
        return res.status(400).send({ 
          message: 'Invalid voice parameters',
          error: voiceValidation.error 
        });
      }
      
      config.elevenLabsConfig = {
        ...existingConfig.elevenLabsConfig,
        apiKey: updateApiKeyIfChanged(updatedConfig.elevenLabsConfig.apiKey, existingConfig.elevenLabsConfig.apiKey),
        selectedVoiceId: handleFieldUpdate(updatedConfig.elevenLabsConfig.selectedVoiceId, existingConfig.elevenLabsConfig.selectedVoiceId),
        availableVoices: handleFieldUpdate(updatedConfig.elevenLabsConfig.availableVoices, existingConfig.elevenLabsConfig.availableVoices),
        isEnabled: handleFieldUpdate(updatedConfig.elevenLabsConfig.isEnabled, existingConfig.elevenLabsConfig.isEnabled),
        voiceSpeed: handleFieldUpdate(updatedConfig.elevenLabsConfig.voiceSpeed, existingConfig.elevenLabsConfig.voiceSpeed),
        voiceStability: handleFieldUpdate(updatedConfig.elevenLabsConfig.voiceStability, existingConfig.elevenLabsConfig.voiceStability),
        voiceClarity: handleFieldUpdate(updatedConfig.elevenLabsConfig.voiceClarity, existingConfig.elevenLabsConfig.voiceClarity)
      };
    }
    
    // Update LLM config if provided
    if (updatedConfig.llmConfig) {
      logger.info('Updating LLM configuration...');
      
      // Handle providers
      if (updatedConfig.llmConfig.providers) {
        logger.info('Updating LLM providers...');
        
        // Check for duplicate providers in the incoming update
        const providerNames = new Set();
        const uniqueProviders = [];
        const emptyKeyProviders = [];
        
        // Filter out duplicate providers from the update and track empty API keys
        for (const provider of updatedConfig.llmConfig.providers) {
          if (!providerNames.has(provider.name)) {
            providerNames.add(provider.name);
            uniqueProviders.push(provider);
            
            // Track providers with empty API keys
            if (provider.apiKey === '') {
              emptyKeyProviders.push(provider.name);
              logger.info(`Provider ${provider.name} has empty API key in update - will be removed`);
            }
          } else {
            logger.warn(`Duplicate provider ${provider.name} found in update, ignoring duplicates`);
          }
        }
        
        // Replace updatedConfig.llmConfig.providers with the unique providers
        updatedConfig.llmConfig.providers = uniqueProviders;
        
        // Process each provider and create a new array to assign
        const updatedProviders = [];
        
        // Process each existing provider and update it if there's a matching update
        for (const existingProvider of existingConfig.llmConfig.providers) {
          const updatedProvider = updatedConfig.llmConfig.providers.find(p => p.name === existingProvider.name);
          const processedProvider = validateProviderUpdate(updatedProvider, existingProvider);
          
          // Log the provider update, especially for API key changes
          if (updatedProvider && typeof updatedProvider.apiKey !== 'undefined') {
            if (updatedProvider.apiKey === '') {
              logger.info(`Provider ${existingProvider.name}: API key explicitly cleared`);
              logger.debug(`Provider ${existingProvider.name}: API key value will be set to empty string in database`);
            } else if (enhancedIsMaskedApiKey(updatedProvider.apiKey)) {
              logger.info(`Provider ${existingProvider.name}: Received masked API key, keeping existing`);
              
              // Important: When using the same masked API key, preserve the verification status
              if (existingProvider.status === 'verified' && processedProvider.status === 'unverified') {
                logger.info(`Provider ${existingProvider.name}: Preserving verified status since API key not changed`);
                processedProvider.status = 'verified';
                processedProvider.lastVerified = existingProvider.lastVerified;
              }
            } else {
              logger.info(`Provider ${existingProvider.name}: API key updated to new value`);
            }
          } else if (!updatedProvider || typeof updatedProvider.status === 'undefined') {
            // If client didn't send a status, preserve verified status
            if (existingProvider.status === 'verified' && processedProvider.status === 'unverified') {
              logger.info(`Provider ${existingProvider.name}: Client didn't send status, preserving verified status`);
              processedProvider.status = 'verified';
              processedProvider.lastVerified = existingProvider.lastVerified;
            }
          }
          
          updatedProviders.push(processedProvider);
        }          // Check for new providers that don't exist in the current configuration
        for (const newProvider of updatedConfig.llmConfig.providers) {
          const exists = existingConfig.llmConfig.providers.some(p => p.name === newProvider.name);
          
          if (!exists && newProvider.apiKey && newProvider.apiKey !== '') {
            logger.info(`Adding new provider: ${newProvider.name}`);
            
            // Create a new provider object
            updatedProviders.push({
              name: newProvider.name,
              apiKey: newProvider.apiKey,
              availableModels: newProvider.availableModels || [],
              isEnabled: newProvider.isEnabled !== undefined ? newProvider.isEnabled : true,
              status: 'unverified',
              lastVerified: null
            });
          }
        }
        
        // Clear the existing array and add the updated providers
        // This ensures Mongoose properly detects the changes
        config.llmConfig.providers = [];
        config.markModified('llmConfig.providers');
        
        // Now add each provider back one by one
        // Skip providers with empty API keys to remove them completely
        for (const provider of updatedProviders) {
          if (provider.apiKey !== '') {
            // Important: Add status tracking logs
            logger.debug(`Adding provider ${provider.name} with API key to configuration (status: ${provider.status})`);
            
            // Final verification status check - ensure we're not accidentally resetting a verified provider
            if (provider.status === 'unverified') {
              // Check if there was a verified provider with this name in the existing config
              const existingVerifiedProvider = existingConfig.llmConfig.providers.find(
                p => p.name === provider.name && p.status === 'verified' && p.apiKey === provider.apiKey
              );
              
              if (existingVerifiedProvider) {
                // If the API key hasn't changed and it was verified before, maintain the verified status
                logger.info(`Preserving verified status for ${provider.name} since API key is unchanged from a verified key`);
                provider.status = 'verified';
                provider.lastVerified = existingVerifiedProvider.lastVerified;
              }
            }
            
            // Add the provider to the configuration
            logger.info(`Adding provider ${provider.name} to configuration with status ${provider.status}`);

            // Add additional debug info about the provider status
            if (provider.status === 'verified') {
              logger.info(`Provider ${provider.name} is verified with lastVerified date: ${provider.lastVerified}`);
              
              // Make absolutely sure a verified provider has a lastVerified date
              if (!provider.lastVerified) {
                logger.warn(`Provider ${provider.name} has verified status but no lastVerified date - adding current date`);
                provider.lastVerified = new Date();
              }
            }

            // Now add the provider to the configuration
            config.llmConfig.providers.push(provider);
          } else {
            logger.info(`Provider ${provider.name} has empty API key - removing from configuration`);
          }
        }
        
        logger.info(`Updated to ${config.llmConfig.providers.length} LLM providers after cleanup`);
      }
      
      // Validate and update LLM settings
      if (updatedConfig.llmConfig.temperature || updatedConfig.llmConfig.maxTokens) {
        const llmValidation = validateLLMParameters({
          temperature: updatedConfig.llmConfig.temperature,
          maxTokens: updatedConfig.llmConfig.maxTokens
        });
        
        if (!llmValidation.isValid) {
          return res.status(400).send({
            message: 'Invalid LLM parameters',
            error: llmValidation.error
          });
        }
      }
      
      // Update other properties
      config.llmConfig.defaultProvider = handleFieldUpdate(
        updatedConfig.llmConfig.defaultProvider, 
        existingConfig.llmConfig.defaultProvider
      );
      
      config.llmConfig.defaultModel = handleFieldUpdate(
        updatedConfig.llmConfig.defaultModel, 
        existingConfig.llmConfig.defaultModel
      );
      
      config.llmConfig.temperature = handleFieldUpdate(
        updatedConfig.llmConfig.temperature, 
        existingConfig.llmConfig.temperature
      );
      
      config.llmConfig.maxTokens = handleFieldUpdate(
        updatedConfig.llmConfig.maxTokens, 
        existingConfig.llmConfig.maxTokens
      );
      
      // Mark the entire llmConfig as modified to ensure Mongoose saves all changes
      config.markModified('llmConfig');
    }
    
    // Validate and update general settings
    if (updatedConfig.generalSettings) {
      logger.info('Updating general settings...');
      
      const generalValidation = validateGeneralSettings({
        maxCallDuration: updatedConfig.generalSettings.maxCallDuration,
        callRetryAttempts: updatedConfig.generalSettings.callRetryAttempts,
        callRetryDelay: updatedConfig.generalSettings.callRetryDelay,
        maxConcurrentCalls: updatedConfig.generalSettings.maxConcurrentCalls
      });
      
      if (!generalValidation.isValid) {
        return res.status(400).send({
          message: 'Invalid general settings',
          error: generalValidation.error
        });
      }
      
      config.generalSettings = {
        ...existingConfig.generalSettings,
        defaultLanguage: handleFieldUpdate(updatedConfig.generalSettings.defaultLanguage, existingConfig.generalSettings.defaultLanguage),
        supportedLanguages: handleFieldUpdate(updatedConfig.generalSettings.supportedLanguages, existingConfig.generalSettings.supportedLanguages),
        maxConcurrentCalls: handleFieldUpdate(updatedConfig.generalSettings.maxConcurrentCalls, existingConfig.generalSettings.maxConcurrentCalls),
        callRetryAttempts: handleFieldUpdate(updatedConfig.generalSettings.callRetryAttempts, existingConfig.generalSettings.callRetryAttempts),
        callRetryDelay: handleFieldUpdate(updatedConfig.generalSettings.callRetryDelay, existingConfig.generalSettings.callRetryDelay),
        maxCallDuration: handleFieldUpdate(updatedConfig.generalSettings.maxCallDuration, existingConfig.generalSettings.maxCallDuration),
        defaultSystemPrompt: handleFieldUpdate(updatedConfig.generalSettings.defaultSystemPrompt, existingConfig.generalSettings.defaultSystemPrompt),
        defaultTimeZone: handleFieldUpdate(updatedConfig.generalSettings.defaultTimeZone, existingConfig.generalSettings.defaultTimeZone),
        workingHours: {
          ...existingConfig.generalSettings.workingHours,
          timeZone: handleFieldUpdate(updatedConfig.generalSettings.defaultTimeZone, existingConfig.generalSettings.workingHours.timeZone)
        }
      };
    }
    
    // Update webhook config if provided (only secret, URL is environment-only)
    if (updatedConfig.webhookConfig) {
      logger.info('Updating webhook configuration...');
      config.webhookConfig = {
        ...existingConfig.webhookConfig,
        // Only secret is managed via database, URL is environment variable only
        secret: updateApiKeyIfChanged(updatedConfig.webhookConfig.secret, existingConfig.webhookConfig.secret)
      };
    }

    // Update voiceAI config if provided
    if (updatedConfig.voiceAIConfig) {
      logger.info('Updating Voice AI configuration...');
      
      // Ensure voiceAIConfig exists in the config
      if (!config.voiceAIConfig) {
        config.voiceAIConfig = {
          personalities: [],
          bilingualSupport: {
            enabled: false,
            primaryLanguage: 'English',
            secondaryLanguage: 'Hindi',
            autoLanguageDetection: true
          },
          conversationFlow: {
            personalityAdaptation: true,
            contextAwareness: true,
            naturalPauses: true
          },
          conversationalAI: {
            enabled: true,
            useSDK: true,
            interruptible: true,
            adaptiveTone: true,
            naturalConversationPacing: true,
            voiceSettings: {
              speed: 1.0,
              stability: 0.8,
              style: 0.3
            },
            defaultVoiceId: '',
            defaultModelId: 'eleven_multilingual_v2'
          }
        };
      }
      
      // Update other voiceAI configuration sections if provided
      if (updatedConfig.voiceAIConfig.bilingualSupport) {
        config.voiceAIConfig.bilingualSupport = {
          ...existingConfig.voiceAIConfig?.bilingualSupport,
          ...updatedConfig.voiceAIConfig.bilingualSupport
        };
      }
      
      if (updatedConfig.voiceAIConfig.conversationFlow) {
        config.voiceAIConfig.conversationFlow = {
          ...existingConfig.voiceAIConfig?.conversationFlow,
          ...updatedConfig.voiceAIConfig.conversationFlow
        };
      }
      
      if (updatedConfig.voiceAIConfig.conversationalAI) {
        config.voiceAIConfig.conversationalAI = {
          ...existingConfig.voiceAIConfig?.conversationalAI,
          ...updatedConfig.voiceAIConfig.conversationalAI
        };
      }
      
      // Mark voiceAIConfig as modified
      config.markModified('voiceAIConfig');
      
      logger.info('Voice AI configuration updated:', {
        bilingualSupport: config.voiceAIConfig.bilingualSupport?.enabled,
        conversationalAI: config.voiceAIConfig.conversationalAI?.enabled
      });
    }

    // Update Deepgram config if provided
    if (updatedConfig.deepgramConfig) {
      logger.info('Updating Deepgram configuration...');
      
      // Initialize deepgramConfig if it doesn't exist
      if (!config.deepgramConfig) {
        config.deepgramConfig = {
          apiKey: '',
          isEnabled: false,
          primaryModel: '',
          fallbackModels: [],
          autoFallback: true,
          tier: 'enhanced',
          retryAttempts: 3,
          timeoutMs: 30000,
          status: 'unverified'
        };
      }
      
      // Validate Deepgram API key if provided and not empty
      if (updatedConfig.deepgramConfig.apiKey && updatedConfig.deepgramConfig.apiKey.trim() !== '') {
        // Check if it's not a masked key first
        if (enhancedIsMaskedApiKey(updatedConfig.deepgramConfig.apiKey)) {
          logger.info('Deepgram API key is masked, will keep existing key');
        } else {
          // Validate the API key format
          const validation = validateDeepgramKey(updatedConfig.deepgramConfig.apiKey);
          if (!validation.isValid) {
            return res.status(400).send({ 
              message: 'Invalid Deepgram API key format',
              error: validation.error 
            });
          }

          // Enhanced validation using model compatibility service
          try {
            const { initializeModelCompatibilityService } = await import('../services/modelCompatibilityService');
            const compatibilityService = initializeModelCompatibilityService(updatedConfig.deepgramConfig.apiKey);
            
            // Test basic API access with a simple model validation
            const testModel = updatedConfig.deepgramConfig.primaryModel || 'base';
            const modelValidation = await compatibilityService.validateModelAccess(
              updatedConfig.deepgramConfig.apiKey, 
              testModel
            );
            
            if (!modelValidation.isValid) {
              logger.warn(`Primary model ${testModel} validation failed: ${modelValidation.error}`);
              
              // Try to find a compatible model automatically
              const compatibleModels = await compatibilityService.getCompatibleModels(updatedConfig.deepgramConfig.apiKey);
              
              if (compatibleModels.length === 0) {
                return res.status(400).send({
                  message: 'Deepgram API key is valid but no compatible models found',
                  error: 'No accessible models for this account'
                });
              }
              
              // Auto-suggest the best available model
              logger.info(`Auto-selecting compatible model: ${compatibleModels[0]}`);
              updatedConfig.deepgramConfig.primaryModel = compatibleModels[0];
              updatedConfig.deepgramConfig.fallbackModels = compatibleModels.slice(1, 4); // Up to 3 fallbacks
            }
            
            // Get account capabilities for enhanced configuration
            const capabilities = await compatibilityService.getAccountCapabilities(updatedConfig.deepgramConfig.apiKey);
            updatedConfig.deepgramConfig.tier = capabilities.tier;
            updatedConfig.deepgramConfig.availableModels = capabilities.availableModels;
            
            logger.info(`Deepgram account validated: ${capabilities.tier} tier with ${capabilities.availableModels.length} models`);
            
          } catch (validationError) {
            logger.warn(`Enhanced Deepgram validation failed: ${getErrorMessage(validationError)}`);
            // Continue with basic validation - don't block configuration update
          }
          
          logger.info('Deepgram API key provided and validated, will update configuration');
        }
      }
      
      config.deepgramConfig = {
        ...existingConfig.deepgramConfig,
        apiKey: updateApiKeyIfChanged(updatedConfig.deepgramConfig.apiKey, existingConfig.deepgramConfig?.apiKey || ''),
        isEnabled: handleFieldUpdate(updatedConfig.deepgramConfig.isEnabled, existingConfig.deepgramConfig?.isEnabled || false),
        primaryModel: handleFieldUpdate(updatedConfig.deepgramConfig.primaryModel, existingConfig.deepgramConfig?.primaryModel || ''),
        fallbackModels: handleFieldUpdate(updatedConfig.deepgramConfig.fallbackModels, existingConfig.deepgramConfig?.fallbackModels || []),
        autoFallback: handleFieldUpdate(updatedConfig.deepgramConfig.autoFallback, existingConfig.deepgramConfig?.autoFallback ?? true),
        tier: handleFieldUpdate(updatedConfig.deepgramConfig.tier, existingConfig.deepgramConfig?.tier || 'enhanced'),
        availableModels: handleFieldUpdate(updatedConfig.deepgramConfig.availableModels, existingConfig.deepgramConfig?.availableModels || []),
        retryAttempts: handleFieldUpdate(updatedConfig.deepgramConfig.retryAttempts, existingConfig.deepgramConfig?.retryAttempts || 3),
        timeoutMs: handleFieldUpdate(updatedConfig.deepgramConfig.timeoutMs, existingConfig.deepgramConfig?.timeoutMs || 30000),
        status: updatedConfig.deepgramConfig.apiKey && updatedConfig.deepgramConfig.apiKey.trim() !== '' 
          && !enhancedIsMaskedApiKey(updatedConfig.deepgramConfig.apiKey)
          ? 'verified'  // Set to verified if API key is provided and validated
          : existingConfig.deepgramConfig?.status || 'unverified',
        lastModelValidation: updatedConfig.deepgramConfig.apiKey && updatedConfig.deepgramConfig.apiKey.trim() !== '' 
          && !enhancedIsMaskedApiKey(updatedConfig.deepgramConfig.apiKey)
          ? new Date()
          : existingConfig.deepgramConfig?.lastModelValidation
      };
      
      // Mark deepgramConfig as modified
      config.markModified('deepgramConfig');
      
      logger.info('Deepgram configuration updated:', {
        isEnabled: config.deepgramConfig.isEnabled,
        hasApiKey: !!config.deepgramConfig.apiKey,
        primaryModel: config.deepgramConfig.primaryModel,
        fallbackModels: config.deepgramConfig.fallbackModels,
        availableModels: config.deepgramConfig.availableModels?.length || 0,
        autoFallback: config.deepgramConfig.autoFallback,
        tier: config.deepgramConfig.tier,
        status: config.deepgramConfig.status
      });
    }

    // Update TTS config if provided
    if (updatedConfig.ttsConfig) {
      logger.info('Updating TTS configuration...');
      
      // Initialize ttsConfig if it doesn't exist
      if (!config.ttsConfig) {
        config.ttsConfig = {
          provider: 'elevenlabs',
          primaryProvider: 'elevenlabs',
          fallbackProviders: ['deepgram'],
          autoFallback: true,
          deepgramTTS: {
            apiKey: '',
            isEnabled: false,
            defaultModel: 'aura-2-thalia-en',
            availableModels: ['aura-2-thalia-en', 'aura-2-luna-en', 'aura-2-stella-en'],
            voiceSettings: {
              encoding: 'mp3',
              sampleRate: 24000
            },
            status: 'unverified'
          }
        };
      }
      
      // Update TTS provider settings
      config.ttsConfig = {
        ...existingConfig.ttsConfig,
        provider: handleFieldUpdate(updatedConfig.ttsConfig.provider, existingConfig.ttsConfig?.provider || 'elevenlabs'),
        primaryProvider: handleFieldUpdate(updatedConfig.ttsConfig.primaryProvider, existingConfig.ttsConfig?.primaryProvider || updatedConfig.ttsConfig.provider || 'elevenlabs'),
        fallbackProviders: handleFieldUpdate(updatedConfig.ttsConfig.fallbackProviders, existingConfig.ttsConfig?.fallbackProviders || ['deepgram']),
        autoFallback: handleFieldUpdate(updatedConfig.ttsConfig.autoFallback, existingConfig.ttsConfig?.autoFallback !== undefined ? existingConfig.ttsConfig.autoFallback : true)
      };
      
      // Update Deepgram TTS specific settings if provided
      if (updatedConfig.ttsConfig.deepgramTTS) {
        if (!config.ttsConfig.deepgramTTS) {
          config.ttsConfig.deepgramTTS = {
            apiKey: '',
            isEnabled: false,
            defaultModel: 'aura-2-thalia-en',
            availableModels: ['aura-2-thalia-en', 'aura-2-luna-en', 'aura-2-stella-en'],
            voiceSettings: {
              encoding: 'mp3',
              sampleRate: 24000
            },
            status: 'unverified'
          };
        }
        
        config.ttsConfig.deepgramTTS = {
          ...existingConfig.ttsConfig?.deepgramTTS,
          apiKey: updateApiKeyIfChanged(updatedConfig.ttsConfig.deepgramTTS.apiKey, existingConfig.ttsConfig?.deepgramTTS?.apiKey || ''),
          isEnabled: handleFieldUpdate(updatedConfig.ttsConfig.deepgramTTS.isEnabled, existingConfig.ttsConfig?.deepgramTTS?.isEnabled || false),
          defaultModel: handleFieldUpdate(updatedConfig.ttsConfig.deepgramTTS.defaultModel, existingConfig.ttsConfig?.deepgramTTS?.defaultModel || 'aura-2-thalia-en'),
          voiceSettings: handleFieldUpdate(updatedConfig.ttsConfig.deepgramTTS.voiceSettings, existingConfig.ttsConfig?.deepgramTTS?.voiceSettings || { encoding: 'mp3', sampleRate: 24000 }),
          status: handleFieldUpdate(updatedConfig.ttsConfig.deepgramTTS.status, existingConfig.ttsConfig?.deepgramTTS?.status || 'unverified')
        };
      }
      
      // Mark ttsConfig as modified
      config.markModified('ttsConfig');
      
      logger.info('TTS configuration updated:', {
        provider: config.ttsConfig.provider,
        primaryProvider: config.ttsConfig.primaryProvider,
        fallbackProviders: config.ttsConfig.fallbackProviders,
        autoFallback: config.ttsConfig.autoFallback,
        deepgramTTS: {
          isEnabled: config.ttsConfig.deepgramTTS?.isEnabled || false,
          hasApiKey: !!(config.ttsConfig.deepgramTTS?.apiKey),
          defaultModel: config.ttsConfig.deepgramTTS?.defaultModel,
          status: config.ttsConfig.deepgramTTS?.status
        }
      });
    }

    // Save configuration changes
    try {
      // Process API keys - log what will be saved to the database
      let emptyKeyProviders = [];
      let providersToRemove = [];
      
      if (config.llmConfig && config.llmConfig.providers) {
        for (const provider of config.llmConfig.providers) {
          if (!provider.apiKey || provider.apiKey === '') {
            emptyKeyProviders.push(provider.name);
            providersToRemove.push(provider.name);
            logger.info(`Provider ${provider.name} has an empty API key and will be removed`);
          }
        }
        
        // Remove providers with empty API keys
        if (providersToRemove.length > 0) {
          logger.info(`Removing ${providersToRemove.length} providers with empty API keys before saving`);
          config.llmConfig.providers = config.llmConfig.providers.filter(p => p.apiKey && p.apiKey !== '');
          config.markModified('llmConfig.providers');
        }
      }
      
      // Add detailed logging before save
      logger.info('Saving configuration with the following LLM providers:', {
        providers: config.llmConfig.providers.map(p => ({
          name: p.name,
          isEnabled: p.isEnabled,
          status: p.status,
          hasApiKey: p.apiKey ? (p.apiKey.length > 0 ? 'yes' : 'empty') : 'none',
          apiKeyLength: p.apiKey ? p.apiKey.length : 0,
          modelsCount: p.availableModels ? p.availableModels.length : 0
        }))
      });
      
      // Force Mongoose to detect changes to nested subdocuments
      config.markModified('llmConfig');
      config.markModified('llmConfig.providers');
      config.markModified('elevenLabsConfig');
      config.markModified('twilioConfig');
      config.markModified('voiceAIConfig');
      config.markModified('ttsConfig');
      
      // Also mark each provider individually to ensure status changes are detected
      if (config.llmConfig && config.llmConfig.providers) {
        config.llmConfig.providers.forEach((provider, index) => {
          config.markModified(`llmConfig.providers.${index}.status`);
          config.markModified(`llmConfig.providers.${index}.lastVerified`);
        });
      }
      
      // Save with a retry mechanism in case of Mongoose optimistic concurrency issues
      let saveAttempt = 0;
      const maxSaveAttempts = 3;
      
      while (saveAttempt < maxSaveAttempts) {
        try {
          await config.save();
          logger.info(`Configuration saved successfully on attempt ${saveAttempt + 1}`);
          
          // Verify the save was successful by immediately querying the database
          const verifiedConfig = await Configuration.findById(config._id);
          if (verifiedConfig) {
            // Check that any empty API keys were properly saved
            let verificationSuccessful = true;
            for (const providerName of emptyKeyProviders) {
              const provider = verifiedConfig.llmConfig.providers.find(p => p.name === providerName);
              if (provider) {
                logger.error(`❌ Provider ${providerName} with empty API key still exists after save - should have been removed`);
                verificationSuccessful = false;
              } else {
                logger.info(`✅ Verified provider ${providerName} with empty API key was properly removed`);
              }
            }
            
            // Verify that the status for all verified providers was correctly saved
            if (verifiedConfig.llmConfig?.providers) {
              const verifiedProviders = verifiedConfig.llmConfig.providers.filter(p => p.status === 'verified');
              const expectedVerifiedCount = updatedConfig.llmConfig?.providers.filter(p => 
                p.status === 'verified' && p.apiKey && p.apiKey.length > 0
              ).length || 0;
              
              logger.info(`✅ Verified provider count matches expected count: ${verifiedProviders.length}`);
              
              // Log the status of each provider
              for (const provider of verifiedConfig.llmConfig.providers) {
                logger.debug(`Provider ${provider.name} status: ${provider.status || 'unset'}, lastVerified: ${provider.lastVerified || 'none'}`);
              }
            }
            
            // Also verify that the provider count matches expected count
            const expectedProviderCount = config.llmConfig.providers.length;
            if (verifiedConfig.llmConfig.providers.length !== expectedProviderCount) {
              logger.error(`❌ Provider count mismatch after save: expected ${expectedProviderCount}, got ${verifiedConfig.llmConfig.providers.length}`);
              verificationSuccessful = false;
            } else {
              logger.info(`✅ Verified provider count matches expected count: ${expectedProviderCount}`);
            }
            
            // Verify status preservation for verified providers
            for (const provider of config.llmConfig.providers) {
              if (provider.status === 'verified') {
                const savedProvider = verifiedConfig.llmConfig.providers.find(p => p.name === provider.name);
                if (savedProvider && savedProvider.status === 'verified') {
                  logger.info(`✅ Verified status correctly preserved for provider ${provider.name}`);
                } else if (savedProvider) {
                  logger.error(`❌ Provider ${provider.name} status not preserved - expected 'verified' but got '${savedProvider.status}'`);
                  verificationSuccessful = false;
                }
              }
            }
            
            if (verificationSuccessful) {
              logger.info('All empty API keys were properly removed from the database and status preserved');
            } else {
              logger.warn('Some empty API keys were not properly removed or status was not preserved - may reappear after page refresh');
            }
          }
          
          break;
        } catch (saveErr) {
          saveAttempt++;
          if (saveAttempt >= maxSaveAttempts) {
            throw saveErr; // Rethrow if we've exhausted our attempts
          }
          logger.warn(`Save attempt ${saveAttempt} failed, retrying...`, saveErr);
          await new Promise(resolve => setTimeout(resolve, 200)); // Small delay before retry
        }
      }
      
      // Update services with new API keys
      await updateServicesWithNewConfig(config);
      
      // Prepare masked response
      const response = maskSensitiveValues(config.toObject());
      
      // Log configuration update (with masked sensitive data)
      logger.info('Configuration updated:', {
        twilioConfig: {
          isEnabled: response.twilioConfig.isEnabled,
          hasAuthToken: !!response.twilioConfig.authToken,
          phoneNumberCount: response.twilioConfig.phoneNumbers?.length || 0
        },
        elevenLabsConfig: {
          isEnabled: response.elevenLabsConfig.isEnabled,
          hasApiKey: !!response.elevenLabsConfig.apiKey,
          voiceSpeed: response.elevenLabsConfig.voiceSpeed,
          voiceStability: response.elevenLabsConfig.voiceStability,
          voiceClarity: response.elevenLabsConfig.voiceClarity
        },
        llmConfig: {
          defaultProvider: response.llmConfig.defaultProvider,
          defaultModel: response.llmConfig.defaultModel,
          temperature: response.llmConfig.temperature,
          maxTokens: response.llmConfig.maxTokens,
          providers: response.llmConfig.providers.map(p => ({
            name: p.name,
            isEnabled: p.isEnabled,
            hasApiKey: !!p.apiKey
          }))
        },
        generalSettings: {
          maxCallDuration: response.generalSettings.maxCallDuration,
          maxConcurrentCalls: response.generalSettings.maxConcurrentCalls,
          callRetryAttempts: response.generalSettings.callRetryAttempts
        },
        webhookConfig: {
          hasSecret: !!response.webhookConfig.secret
        }
      });
      
      // After saving, check for final saved state
      const savedConfig = await Configuration.findOne();
      if (savedConfig) {
        // Check providers
        for (const provider of savedConfig.llmConfig.providers) {
          logger.info(`After save - Provider ${provider.name}: Status: ${provider.status}, Last Verified: ${provider.lastVerified || 'None'}`);
        }

        // Log the default provider
        const defaultProvider = savedConfig.llmConfig.providers.find(p => p.name === savedConfig.llmConfig.defaultProvider);
        if (defaultProvider) {
          logger.info(`Default provider ${defaultProvider.name} final status: ${defaultProvider.status}, Last Verified: ${defaultProvider.lastVerified || 'None'}`);
        }
      }
      
      res.status(200).send({
        message: 'Configuration updated successfully',
        success: true,
        configuration: response
      });
      
    } catch (saveError) {
      logger.error('Error saving configuration:', saveError);
      throw saveError;
    }
    
  } catch (error: unknown) {
    logger.error('Error in updateSystemConfiguration:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
      config: maskSensitiveValues(req.body)
    });

    if (error instanceof Error && error.name === 'ValidationError') {
      return res.status(400).send({
        message: 'Configuration validation failed',
        success: false,
        error: error.message
      });
    }

    if (error instanceof Error && error.name === 'MongoError') {
      return res.status(500).send({
        message: 'Database error',
        success: false,
        error: 'Failed to save configuration'
      });
    }

    res.status(500).send({
      message: 'Server error',
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// @desc    Get available LLM models and providers
// @route   GET /api/configuration/llm-options
// @access  Private
export const getLLMOptions = async (_req: FastifyRequest, res: FastifyReply) => {
  try {
    // This would typically fetch the latest model information from the LLM providers
    // For now, return predefined options
    const llmOptions = {
      providers: [
        {
          name: 'OpenAI',
          value: 'openai',
          models: [
            { name: 'GPT-3.5 Turbo', value: 'gpt-3.5-turbo' },
            { name: 'GPT-4', value: 'gpt-4' },
            { name: 'GPT-4 Turbo', value: 'gpt-4-turbo' }
          ]
        },
        {
          name: 'Anthropic',
          value: 'anthropic',
          models: [
            { name: 'Claude 2', value: 'claude-2' },
            { name: 'Claude Instant', value: 'claude-instant' },
            { name: 'Claude 3 Opus', value: 'claude-3-opus' },
            { name: 'Claude 3 Sonnet', value: 'claude-3-sonnet' },
            { name: 'Claude 3 Haiku', value: 'claude-3-haiku' }
          ]
        },
        {
          name: 'Google',
          value: 'google',
          models: [
            { name: 'Gemini Pro', value: 'gemini-pro' },
            { name: 'Gemini Ultra', value: 'gemini-ultra' }
          ]
        }
      ]
    };

    res.status(200).send(llmOptions);
  } catch (error) {
    logger.error('Error in getLLMOptions:', error);
    res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
    return;
  }
};

// @desc    Get available voice options from ElevenLabs
// @route   GET /api/configuration/voice-options
// @access  Private
export const getVoiceOptions = async (_req: FastifyRequest, res: FastifyReply) => {
  try {
    const configuration = await Configuration.findOne();
    
    if (!configuration || !configuration.elevenLabsConfig.apiKey) {
      return res.status(400).send({ 
        message: 'ElevenLabs API key not configured',
        voices: [] 
      });
    }

    // Get voices from configuration instead of hardcoded values
    const availableVoices = configuration.elevenLabsConfig.availableVoices || [];
    
    if (availableVoices.length === 0) {
      return res.status(200).send({ 
        message: 'No voices configured. Please set up voices in ElevenLabs configuration.',
        voices: [] 
      });
    }

    // Map configuration voices to the expected format
    const voiceOptions = availableVoices.map(voice => ({
      voiceId: voice.voiceId,
      name: voice.name,
      previewUrl: voice.previewUrl || null
    }));

    return res.status(200).send({ voices: voiceOptions });
  } catch (error) {
    logger.error('Error in getVoiceOptions:', error);
    return res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Test LLM connection
// @route   POST /api/configuration/test-llm
// @access  Private
export const testLLMConnection = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { provider, apiKey, model } = req.body as {
      provider: string;
      apiKey: string;
      model: string;
    };

    if (!provider || !apiKey || !model) {
      return res.status(400).send({ 
        message: 'Provider, API key, and model are required',
        success: false
      });
    }

    let isSuccessful = false;
    let response: any = null;

    // Test connection based on provider
    switch (provider) {
      case 'openai':
        try {
          const openaiResponse = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
              model,
              messages: [{ role: 'user', content: 'Say "Connection successful"' }],
              max_tokens: 50
            },
            {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
              }
            }
          );
          
          isSuccessful = true;
          response = openaiResponse.data;
        } catch (error: unknown) {
          logger.error('OpenAI test connection failed:', error);
          if (error instanceof Error && 'response' in error) {
            response = (error as any).response?.data || handleError(error);
          } else {
            response = handleError(error);
          }
        }
        break;
        
      case 'anthropic':
        try {
          const anthropicResponse = await axios.post(
            'https://api.anthropic.com/v1/messages',
            {
              model,
              messages: [{ role: 'user', content: 'Say "Connection successful"' }],
              max_tokens: 50
            },
            {
              headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'Content-Type': 'application/json'
              }
            }
          );
          
          isSuccessful = true;
          response = anthropicResponse.data;
        } catch (error: unknown) {
          logger.error('Anthropic test connection failed:', error);
          if (error instanceof Error && 'response' in error) {
            response = (error as any).response?.data || handleError(error);
          } else {
            response = handleError(error);
          }
        }
        break;
        
      case 'google':
        try {
          const googleResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent`,
            {
              contents: [{ parts: [{ text: 'Say "Connection successful"' }] }]
            },
            {
              params: { key: apiKey },
              headers: { 'Content-Type': 'application/json' }
            }
          );
          
          isSuccessful = true;
          response = googleResponse.data;
        } catch (error: unknown) {
          logger.error('Google AI test connection failed:', error);
          if (error instanceof Error && 'response' in error) {
            response = (error as any).response?.data || handleError(error);
          } else {
            response = handleError(error);
          }
        }
        break;
        
      default:
        return res.status(400).send({ 
          message: 'Unsupported LLM provider',
          success: false
        });
    }

    // Update LLM provider status in database based on test result
    if (isSuccessful) {
      // Update status in database
      const configuration = await Configuration.findOne();
      if (configuration) {
        // Find the provider and update its status
        const providerIndex = configuration.llmConfig.providers.findIndex(
          p => p.name === provider
        );
        
        if (providerIndex >= 0) {
          configuration.llmConfig.providers[providerIndex].lastVerified = new Date();
          configuration.llmConfig.providers[providerIndex].status = 'verified';
          
          // Make sure MongoDB detects these changes
          configuration.markModified('llmConfig');
          configuration.markModified('llmConfig.providers');
          configuration.markModified(`llmConfig.providers.${providerIndex}.status`);
          configuration.markModified(`llmConfig.providers.${providerIndex}.lastVerified`);
          
          await configuration.save();
          logger.info(`${provider} LLM provider status updated to verified`);
        }
      }
    } else {
      // Update status to failed
      const configuration = await Configuration.findOne();
      if (configuration) {
        // Find the provider and update its status
        const providerIndex = configuration.llmConfig.providers.findIndex(
          p => p.name === provider
        );
        
        if (providerIndex >= 0) {
          configuration.llmConfig.providers[providerIndex].status = 'failed';
          
          // Make sure MongoDB detects these changes
          configuration.markModified('llmConfig');
          configuration.markModified('llmConfig.providers');
          configuration.markModified(`llmConfig.providers.${providerIndex}.status`);
          
          await configuration.save();
          logger.info(`${provider} LLM provider status updated to failed`);
        }
      }
    }

    return res.status(200).send({
      success: isSuccessful,
      message: isSuccessful ? 'Connection successful' : 'Connection failed',
      details: response
    });
  } catch (error) {
    logger.error('Error in testLLMConnection:', error);
    return res.status(500).send({
      message: 'Server error',
      success: false,
      error: handleError(error)
    });
  }
};

// @desc    Test Twilio connection
// @route   POST /api/configuration/test-twilio
// @access  Private
export const testTwilioConnection = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { accountSid, authToken, phoneNumber } = req.body as any;

    if (!accountSid || !authToken) {
      return res.status(400).send({ message: 'Account SID and Auth Token are required' });
    }

    let isSuccessful = false;
    let response = null;

    try {
      // Initialize Twilio client
      const client = twilio(accountSid, authToken);
      
      // Test by fetching account info
      const account = await client.api.accounts(accountSid).fetch();
      
      // If phoneNumber is provided, verify it's valid
      if (phoneNumber) {
        // Check if phone number exists in account
        const numbers = await client.incomingPhoneNumbers.list({
          phoneNumber
        });
        
        if (numbers.length === 0) {
          return res.status(400).send({
            success: false,
            message: 'Phone number not found in Twilio account',
            accountStatus: account.status
          });
        }
      }
      
      isSuccessful = true;
      response = {
        accountStatus: account.status,
        accountType: account.type,
        accountName: account.friendlyName
      };
      
      // Update status in database
      const configuration = await Configuration.findOne();
      if (configuration) {
        configuration.twilioConfig.lastVerified = new Date();
        configuration.twilioConfig.status = 'verified';
        await configuration.save();
        logger.info('Twilio configuration status updated to verified');
      }
    } catch (error) {
      logger.error('Twilio test connection failed:', error);
      response = handleError(error);
      
      // Update status in database
      const configuration = await Configuration.findOne();
      if (configuration) {
        configuration.twilioConfig.status = 'failed';
        await configuration.save();
        logger.info('Twilio configuration status updated to failed');
      }
    }

    return res.status(200).send({
      success: isSuccessful,
      message: isSuccessful ? 'Connection successful' : 'Connection failed',
      details: response
    });
  } catch (error) {
    logger.error('Error in testTwilioConnection:', error);
    return res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Test Deepgram TTS connection
// @route   POST /api/configuration/test-deepgram-tts
// @access  Private
export const testDeepgramTTSConnection = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { apiKey } = req.body as any;

    if (!apiKey) {
      return res.status(400).send({ message: 'API key is required' });
    }

    let isSuccessful = false;
    let response = null;

    try {
      // Test Deepgram TTS connection by creating a service instance and testing availability
      const { DeepgramTTSService } = await import('../services/deepgramTTSService');
      const tempService = new DeepgramTTSService(apiKey);
      
      // Test if the API key is valid
      const isAvailable = await tempService.isAvailable();
      
      if (isAvailable) {
        isSuccessful = true;
        const models = tempService.getAvailableModels();
        response = {
          availableVoices: models.map(model => ({
            voiceId: model,
            name: model.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
            previewUrl: undefined // Deepgram doesn't have preview URLs
          }))
        };
        
        // Update status in database
        const configuration = await Configuration.findOne();
        if (configuration) {
          if (!configuration.ttsConfig) {
            configuration.ttsConfig = {
              provider: 'elevenlabs',
              primaryProvider: 'elevenlabs',
              fallbackProviders: ['deepgram'],
              autoFallback: true
            };
          }
          if (!configuration.ttsConfig.deepgramTTS) {
            configuration.ttsConfig.deepgramTTS = {
              apiKey: apiKey,
              isEnabled: true,
              defaultModel: 'aura-2-thalia-en',
              availableModels: [],
              voiceSettings: {
                encoding: 'mp3',
                sampleRate: 24000
              }
            };
          } else {
            // Update existing configuration with the new API key
            configuration.ttsConfig.deepgramTTS.apiKey = apiKey;
            configuration.ttsConfig.deepgramTTS.isEnabled = true;
          }
          configuration.ttsConfig.deepgramTTS.lastVerified = new Date();
          configuration.ttsConfig.deepgramTTS.status = 'verified';
          configuration.ttsConfig.deepgramTTS.availableModels = models;
          await configuration.save();
          logger.info('Deepgram TTS configuration status updated to verified');
          // Always update ttsConfig.provider according to user's selection
          if ((req.body as any).ttsConfig && (req.body as any).ttsConfig.provider) {
            configuration.ttsConfig = {
              ...configuration.ttsConfig,
              ...(req.body as any).ttsConfig,
            };
            configuration.markModified('ttsConfig');
            logger.info(`TTS provider set to: ${(req.body as any).ttsConfig.provider}`);
          }
        }
      } else {
        throw new Error('Deepgram TTS API key validation failed');
      }
    } catch (error: unknown) {
      logger.error('Deepgram TTS test connection failed:', error);
      
      // Update status to failed in database
      const configuration = await Configuration.findOne();
      if (configuration && configuration.ttsConfig?.deepgramTTS) {
        configuration.ttsConfig.deepgramTTS.status = 'failed';
        configuration.ttsConfig.deepgramTTS.lastError = error instanceof Error ? error.message : 'Unknown error';
        await configuration.save();
      }
      
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      return res.status(400).send({
        success: false,
        message: 'Deepgram TTS connection failed',
        error: errorMessage
      });
    }

    return res.send({
      success: isSuccessful,
      message: isSuccessful ? 'Deepgram TTS connection successful' : 'Deepgram TTS connection failed',
      details: response
    });
  } catch (error) {
    logger.error('Error in testDeepgramTTSConnection:', error);
    return res.status(500).send({
      message: 'Server error',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

// @desc    Test ElevenLabs connection
// @route   POST /api/configuration/test-elevenlabs
// @access  Private
export const testElevenLabsConnection = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { apiKey } = req.body as any;

    if (!apiKey) {
      return res.status(400).send({ message: 'API key is required' });
    }

    let isSuccessful = false;
    let response = null;

    try {
      // Test ElevenLabs connection by getting voices
      const elevenLabsResponse = await axios.get(
        'https://api.elevenlabs.io/v1/voices',
        {
          headers: {
            'xi-api-key': apiKey,
            'Content-Type': 'application/json'
          }
        }
      );
      
      isSuccessful = true;
      response = {
        availableVoices: elevenLabsResponse.data.voices.map((voice: any) => ({
          voiceId: voice.voice_id,
          name: voice.name,
          previewUrl: voice.preview_url
        }))
      };
      
      // Update status in database
      const configuration = await Configuration.findOne();
      if (configuration) {
        configuration.elevenLabsConfig.lastVerified = new Date();
        configuration.elevenLabsConfig.status = 'verified';
        await configuration.save();
        logger.info('ElevenLabs configuration status updated to verified');
      }
    } catch (error: unknown) {
      logger.error('ElevenLabs test connection failed:', error);
      if (error instanceof Error && 'response' in error) {
        response = (error as any).response?.data || handleError(error);
      } else {
        response = handleError(error);
      }
      
      // Update status in database
      const configuration = await Configuration.findOne();
      if (configuration) {
        configuration.elevenLabsConfig.status = 'failed';
        await configuration.save();
        logger.info('ElevenLabs configuration status updated to failed');
      }
    }

    return res.status(200).send({
      success: isSuccessful,
      message: isSuccessful ? 'Connection successful' : 'Connection failed',
      details: response
    });
  } catch (error) {
    logger.error('Error in testElevenLabsConnection:', error);
    return res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Test voice synthesis with ElevenLabs
// @route   POST /api/configuration/test-voice
// @access  Private
export const testVoiceSynthesis = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { voiceId, text, apiKey, campaignId, useConfigSettings = true } = req.body as any;
    logger.info(`Voice synthesis test request received with voiceId: ${voiceId}`);
    
    if (!voiceId || !text) {
      logger.warn('Voice synthesis test missing required fields', { voiceId: !!voiceId, text: !!text });
      return res.status(400).send({ message: 'Voice ID and text are required' });
    }

    let elevenLabsApiKey = apiKey;

    // If no API key provided in request, get it from configuration
    if (!elevenLabsApiKey) {
      logger.info('No API key provided in request, fetching from configuration');
      const configuration = await Configuration.findOne();
      if (!configuration?.elevenLabsConfig?.apiKey) {
        logger.warn('ElevenLabs API key not configured');
        return res.status(400).send({ message: 'ElevenLabs API key not configured' });
      }
      elevenLabsApiKey = configuration.elevenLabsConfig.apiKey;
    }
    
    // Validate API key format (ElevenLabs keys are typically 32+ characters)
    if (!elevenLabsApiKey || elevenLabsApiKey.length < 32 || elevenLabsApiKey.includes('••••••••')) {
      logger.warn('Invalid ElevenLabs API key format');
      return res.status(400).send({ message: 'Invalid ElevenLabs API key format' });
    }

    logger.info(`Making ElevenLabs API request with voice ID: ${voiceId}`);

    try {
      // Get voice settings from configuration and campaign
      let voiceSettings = {
        stability: 0.8,
        similarity_boost: 0.8,
        style: 0.3,
        use_speaker_boost: true
      };

      if (useConfigSettings) {
        // Import EnhancedVoiceAIService to get combined settings
        const { EnhancedVoiceAIService } = await import('../services/enhancedVoiceAIService');
        const combinedSettings = await EnhancedVoiceAIService.getCombinedVoiceSettings(campaignId);
        
        voiceSettings = {
          stability: combinedSettings.stability,
          similarity_boost: combinedSettings.similarityBoost,
          style: combinedSettings.style,
          use_speaker_boost: combinedSettings.useSpeakerBoost
        };

        logger.info(`Using combined voice settings for test (campaign: ${campaignId || 'none'}):`, voiceSettings);
      } else {
        logger.info(`Using default voice settings for test:`, voiceSettings);
      }

      // Get configuration for model selection
      const config = await Configuration.findOne();

      // Test voice synthesis with ElevenLabs
      const elevenLabsResponse = await axios.post(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          text: text,
          model_id: config?.elevenLabsConfig?.useFlashModel ? "eleven_flash_v2_5" : "eleven_multilingual_v2",
          voice_settings: voiceSettings
        },
        {
          headers: {
            'xi-api-key': elevenLabsApiKey,
            'Content-Type': 'application/json'
          },
          responseType: 'arraybuffer'
        }
      );

      // Convert audio data to base64
      const audioBuffer = Buffer.from(elevenLabsResponse.data);
      const audioBase64 = audioBuffer.toString('base64');

      // Update ElevenLabs status in database
      const configForUpdate = await Configuration.findOne();
      if (configForUpdate) {
        configForUpdate.elevenLabsConfig.lastVerified = new Date();
        configForUpdate.elevenLabsConfig.status = 'verified';
        await configForUpdate.save();
        logger.info('ElevenLabs configuration status updated to verified after successful voice synthesis');
      }

      logger.info('Voice synthesis successful');
      return res.status(200).send({
        success: true,
        message: 'Voice synthesis successful',
        audioData: `data:audio/mpeg;base64,${audioBase64}`,
        voiceId: voiceId,
        text: text
      });

    } catch (error: unknown) {
      logger.error('ElevenLabs voice synthesis failed:', error);
      let errorMessage = 'Voice synthesis failed';
      let errorDetails = handleError(error);
      let statusCode = 400;

      if (error instanceof Error && 'response' in error) {
        const axiosError = error as any;
        if (axiosError.response?.status === 401) {
          errorMessage = 'Invalid ElevenLabs API key';
          
          // Update ElevenLabs status to failed in database
          const configuration = await Configuration.findOne();
          if (configuration) {
            configuration.elevenLabsConfig.status = 'failed';
            await configuration.save();
            logger.info('ElevenLabs configuration status updated to failed after voice synthesis error');
          }
        } else if (axiosError.response?.status === 422) {
          errorMessage = 'Invalid voice ID or parameters';
        } else if (axiosError.response?.status === 404) {
          errorMessage = 'Voice ID not found';
        }
        
        // Log response for debugging
        if (axiosError.response?.data) {
          try {
            if (typeof axiosError.response.data === 'string') {
              errorDetails = axiosError.response.data;
            } else if (Buffer.isBuffer(axiosError.response.data)) {
              errorDetails = axiosError.response.data.toString('utf8');
            } else {
              errorDetails = JSON.stringify(axiosError.response.data);
            }
            logger.error(`ElevenLabs error details: ${errorDetails}`);
          } catch (parseError) {
            logger.error('Error parsing ElevenLabs error response:', parseError);
          }
        }
        
        statusCode = axiosError.response?.status || 400;
      }

      return res.status(statusCode).send({
        success: false,
        message: errorMessage,
        details: errorDetails
      });
    }

  } catch (error) {
    logger.error('Error in testVoiceSynthesis:', error);
    return res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Delete API key
// @route   DELETE /api/configuration/api-key/:provider/:name?
// @access  Private
export const deleteApiKey = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { provider, name } = req.params as any;
    
    logger.info(`Received request to delete API key for provider: ${provider}${name ? `, name: ${name}` : ''}`);
    
    // Get existing configuration
    let configuration = await Configuration.findOne();
    
    if (!configuration) {
      return res.status(404).send({ message: 'Configuration not found' });
    }
    
    let success = false;
    let message = '';
    
    // Delete the appropriate API key based on provider
    switch (provider) {
      case 'elevenlabs':
        if (configuration.elevenLabsConfig && configuration.elevenLabsConfig.apiKey) {
          configuration.elevenLabsConfig.apiKey = '';
          configuration.elevenLabsConfig.isEnabled = false;
          configuration.elevenLabsConfig.status = 'unverified';
          success = true;
          message = 'ElevenLabs API key deleted successfully';
          logger.info('ElevenLabs API key deleted');
        } else {
          message = 'No ElevenLabs API key found to delete';
          logger.warn('No ElevenLabs API key found to delete');
        }
        break;
        
      case 'twilio':
        if (configuration.twilioConfig) {
          configuration.twilioConfig.authToken = '';
          configuration.twilioConfig.isEnabled = false;
          configuration.twilioConfig.status = 'unverified';
          success = true;
          message = 'Twilio auth token deleted successfully';
          logger.info('Twilio auth token deleted');
        } else {
          message = 'No Twilio auth token found to delete';
          logger.warn('No Twilio auth token found to delete');
        }
        break;
        
      case 'llm':
        if (!name) {
          return res.status(400).send({ message: 'LLM provider name is required' });
        }
        
        if (configuration.llmConfig && configuration.llmConfig.providers) {
          const providerIndex = configuration.llmConfig.providers.findIndex(
            (p: any) => p.name === name
          );
          
          if (providerIndex >= 0) {
            // Remove the provider completely from the array
            logger.info(`Removing provider ${name} completely from the configuration`);
            configuration.llmConfig.providers.splice(providerIndex, 1);
            
            // Force Mongoose to detect the change
            configuration.markModified('llmConfig.providers');
            
            success = true;
            message = `${name} provider deleted successfully`;
            logger.info(`${name} provider deleted completely`);
            
            // If this was the default provider, update to another provider if available
            if (configuration.llmConfig.defaultProvider === name) {
              const availableProvider = configuration.llmConfig.providers.find(
                (p: any) => p.name !== name && p.apiKey
              );
              
              if (availableProvider) {
                configuration.llmConfig.defaultProvider = availableProvider.name;
                logger.info(`Updated default LLM provider to ${availableProvider.name}`);
              }
            }
          } else {
            message = `No API key found for LLM provider: ${name}`;
            logger.warn(`No API key found for LLM provider: ${name}`);
          }
        } else {
          message = 'LLM configuration not found';
          logger.warn('LLM configuration not found');
        }
        break;
        
      case 'webhook':
        if (configuration.webhookConfig) {
          configuration.webhookConfig.secret = '';
          success = true;
          message = 'Webhook secret deleted successfully';
          logger.info('Webhook secret deleted');
        } else {
          message = 'No webhook secret found to delete';
          logger.warn('No webhook secret found to delete');
        }
        break;
        
      default:
        return res.status(400).send({ message: 'Invalid provider specified' });
    }
    
    // Save the updated configuration
    if (success) {
      try {          // Force Mongoose to detect changes to the entire array
        configuration.markModified('llmConfig');
        configuration.markModified('llmConfig.providers');
        
        // Log state before saving
        logger.info('Saving configuration with the following LLM providers state:', {
          providers: configuration.llmConfig.providers.map((p: any) => ({
            name: p.name,
            isEnabled: p.isEnabled,
            status: p.status,
            hasApiKey: p.apiKey ? (p.apiKey.length > 0 ? 'yes' : 'empty') : 'none',
            apiKeyLength: p.apiKey ? p.apiKey.length : 0
          }))
        });
        
        // Save with retry mechanism for optimistic concurrency issues
        let saveAttempt = 0;
        const maxSaveAttempts = 3;
        
        while (saveAttempt < maxSaveAttempts) {
          try {
            await configuration.save();
            logger.info(`Configuration saved successfully after API key deletion (attempt ${saveAttempt + 1})`);
            
            // Verify the removal persisted
            const verifiedConfig = await Configuration.findById(configuration._id);
            if (verifiedConfig && provider === 'llm' && name) {
              const providerStillExists = verifiedConfig.llmConfig.providers.some((p: any) => p.name === name);
              if (providerStillExists) {
                logger.error(`Provider ${name} still exists after deletion - persistence issue detected`);
              } else {
                logger.info(`✅ Verified provider ${name} was successfully removed from database`);
              }
            }
            
            break;
          } catch (saveErr) {
            saveAttempt++;
            if (saveAttempt >= maxSaveAttempts) {
              throw saveErr; // Rethrow if we've exhausted our attempts
            }
            logger.warn(`Save attempt ${saveAttempt} failed after API key deletion, retrying...`, saveErr);
            await new Promise(resolve => setTimeout(resolve, 200)); // Small delay before retry
          }
        }
        
        // Update services with new configuration (removed API keys)
        await updateServicesWithNewConfig(configuration);
      } catch (error) {
        logger.error('Error saving configuration after API key deletion:', error);
        return res.status(500).send({
          message: 'Failed to save configuration after API key deletion',
          error: handleError(error)
        });
      }
    }
    
    return res.status(200).send({
      success,
      message
    });
  } catch (error) {
    logger.error('Error in deleteApiKey:', error);
    return res.status(500).send({
      message: 'Server error',
      error: handleError(error)
    });
  }
};

// @desc    Verify ElevenLabs API Key
// @route   POST /api/configuration/verify/elevenlabs
// @access  Private
export const verifyElevenLabsApiKey = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    // Get the configuration
    const config = await Configuration.findOne();
    if (!config) {
      return res.status(404).send({ message: 'Configuration not found' });
    }

    // Check if API key exists
    if (!config.elevenLabsConfig?.apiKey) {
      return res.status(400).send({ 
        message: 'ElevenLabs API key is not set',
        status: 'failed'
      });
    }

    // Verify the API key
    logger.info('Verifying ElevenLabs API key...');
    const verificationResult = await verifyAndUpdateElevenLabsApiStatus(config.elevenLabsConfig.apiKey);

    // Get the updated configuration after verification
    const updatedConfig = await Configuration.findOne();
    
    // Return the verification result with the latest configuration status
    return res.status(200).send({
      success: verificationResult.success,
      status: verificationResult.status,
      message: verificationResult.message,
      subscription: verificationResult.subscription,
      isUnusualActivity: verificationResult.isUnusualActivity || updatedConfig?.elevenLabsConfig?.unusualActivityDetected || false,
      quotaInfo: updatedConfig?.elevenLabsConfig?.quotaInfo || null,
      lastVerified: updatedConfig?.elevenLabsConfig?.lastVerified || new Date(),
      currentStatus: updatedConfig?.elevenLabsConfig?.status || 'unknown'
    });
  } catch (error) {
    logger.error(`Error verifying ElevenLabs API key: ${getErrorMessage(error)}`);
    return res.status(500).send({
      message: 'Error verifying ElevenLabs API key',
      error: getErrorMessage(error)
    });
  }
};

// @desc    Verify Deepgram TTS API Key
// @route   POST /api/configuration/verify/deepgram-tts
// @access  Private
export const verifyDeepgramTTSApiKey = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    // Get the configuration
    const config = await Configuration.findOne();
    if (!config) {
      return res.status(404).send({ message: 'Configuration not found' });
    }

    // Check if API key exists
    if (!config.ttsConfig?.deepgramTTS?.apiKey) {
      return res.status(400).send({ 
        message: 'Deepgram TTS API key is not set',
        status: 'failed'
      });
    }

    // Verify the API key
    logger.info('Verifying Deepgram TTS API key...');
    const verificationResult = await verifyAndUpdateDeepgramTTSApiStatus(config.ttsConfig.deepgramTTS.apiKey);

    // Get the updated configuration after verification
    const updatedConfig = await Configuration.findOne();
    
    // Return the verification result with the latest configuration status
    return res.status(200).send({
      success: verificationResult.success,
      status: verificationResult.status,
      message: verificationResult.message,
      latency: verificationResult.latency,
      availableModels: verificationResult.availableModels || updatedConfig?.ttsConfig?.deepgramTTS?.availableModels || [],
      lastVerified: updatedConfig?.ttsConfig?.deepgramTTS?.lastVerified || new Date(),
      currentStatus: updatedConfig?.ttsConfig?.deepgramTTS?.status || 'unknown'
    });
  } catch (error) {
    logger.error(`Error verifying Deepgram TTS API key: ${getErrorMessage(error)}`);
    return res.status(500).send({
      message: 'Error verifying Deepgram TTS API key',
      error: getErrorMessage(error)
    });
  }
};

// @desc    Make a test call using Twilio
// @route   POST /api/configuration/test-call
// @access  Private
export const makeTestCall = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { accountSid, authToken, fromNumber, toNumber, message } = req.body as any;
    
    logger.info('Testing Twilio call with:', { 
      fromNumber, 
      toNumber, 
      hasMessage: !!message,
      accountSidPrefix: accountSid ? accountSid.substring(0, 5) + '...' : 'NOT PROVIDED',
      hasAuthToken: !!authToken
    });

    // Validate required fields
    if (!accountSid || !authToken || !fromNumber || !toNumber) {
      return res.status(400).send({
        success: false,
        message: 'Missing required parameters. Please provide accountSid, authToken, fromNumber, and toNumber.'
      });
    }

    // Validate phone numbers
    if (!fromNumber.match(/^\+\d{10,15}$/) || !toNumber.match(/^\+\d{10,15}$/)) {
      return res.status(400).send({
        success: false,
        message: 'Phone numbers must be in E.164 format (e.g., +12125551234)'
      });
    }

    // Initialize Twilio client with the provided credentials
    const twilioClient = require('twilio')(accountSid, authToken);

    // Default message if not provided
    const callMessage = message || 'This is a test call from Project Call. Your system is working correctly.';
    
    // Create TwiML for the call
    const twiml = `
      <Response>
        <Say voice="alice" language="en-US">${callMessage}</Say>
        <Pause length="1"/>
        <Say voice="alice" language="en-US">Test call complete. Goodbye.</Say>
      </Response>
    `;
    
    // Make the test call
    const call = await twilioClient.calls.create({
      twiml: twiml,
      to: toNumber,
      from: fromNumber
    });
    
    logger.info('Test call initiated successfully:', { callSid: call.sid });
    
    // Update status in configuration if this is using saved credentials
    try {
      const config = await Configuration.findOne();
      if (config && 
          config.twilioConfig && 
          config.twilioConfig.accountSid === accountSid) {
        
        config.twilioConfig.status = 'verified';
        config.twilioConfig.lastVerified = new Date();
        config.twilioConfig.isEnabled = true;
        
        await config.save();
        logger.info('Updated Twilio configuration status to verified');
      }
    } catch (configError) {
      logger.error('Error updating configuration after successful test call:', configError);
      // Don't fail the request if just the config update fails
    }
    
    return res.status(200).send({
      success: true,
      message: 'Test call initiated successfully',
      callSid: call.sid,
      status: call.status
    });
    
  } catch (error) {
    logger.error('Error making test call with Twilio:', error);
    
    let errorMessage = 'Failed to make test call';
    let errorDetails = null;
    
    if (error.code) {
      switch (error.code) {
        case 20404:
          errorMessage = 'Invalid phone number';
          break;
        case 20003:
          errorMessage = 'Authentication failed - check your Account SID and Auth Token';
          break;
        case 21210:
        case 21211:
        case 21212:
        case 21213:
        case 21214:
          errorMessage = 'Invalid phone number format';
          break;
        case 21215:
        case 21216:
          errorMessage = 'Phone number not verified or not in your Twilio account';
          break;
        case 13224:
          errorMessage = 'Call cannot be created. Twilio account may be trial account with restrictions';
          break;
        default:
          errorMessage = `Twilio error: ${error.message || 'Unknown error'}`;
      }
      
      errorDetails = {
        code: error.code,
        moreInfo: error.moreInfo,
        status: error.status
      };
    }
    
    return res.status(400).send({
      success: false,
      message: errorMessage,
      details: errorDetails
    });
  }
};
// @desc    Auto-configure Deepgram model
// @route   POST /api/configuration/deepgram/auto-configure
// @access  Private
export const autoConfigureDeepgramModel = async (_req: FastifyRequest, res: FastifyReply) => {
  try {
    logger.info('Starting Deepgram auto-configuration...');
    
    const { getDeepgramAutoConfigService } = await import('../services/deepgramAutoConfigService');
    const autoConfigService = getDeepgramAutoConfigService();
    
    // Perform auto-configuration
    const result = await autoConfigService.autoConfigureOptimalModel();
    
    if (result.success) {
      logger.info(`Deepgram auto-configuration successful: ${result.model}`);
      
      res.status(200).send({
        success: true,
        message: 'Deepgram model auto-configured successfully',
        data: {
          model: result.model,
          previousModel: result.previousModel,
          accountTier: result.accountTier,
          availableModels: result.availableModels,
          fallbackModels: result.fallbackModels,
          warnings: result.warnings
        }
      });
    } else {
      logger.error(`Deepgram auto-configuration failed: ${result.error}`);
      
      res.status(400).send({
        success: false,
        message: 'Deepgram auto-configuration failed',
        error: result.error,
        warnings: result.warnings
      });
    }
    
  } catch (error) {
    const errorMessage = handleError(error);
    logger.error(`Deepgram auto-configuration error: ${errorMessage}`);
    
    res.status(500).send({
      success: false,
      message: 'Internal server error during auto-configuration',
      error: errorMessage
    });
  }
};

// @desc    Validate Deepgram model configuration
// @route   POST /api/configuration/deepgram/validate
// @access  Private
export const validateDeepgramConfiguration = async (_req: FastifyRequest, res: FastifyReply) => {
  try {
    logger.info('Validating Deepgram configuration...');
    
    const { getDeepgramAutoConfigService } = await import('../services/deepgramAutoConfigService');
    const autoConfigService = getDeepgramAutoConfigService();
    
    // Force immediate validation
    const result = await autoConfigService.forceValidation();
    
    if (result.isValid) {
      logger.info(`Deepgram validation successful for model: ${result.model}`);
      
      res.status(200).send({
        success: true,
        message: 'Deepgram configuration is valid',
        data: {
          model: result.model,
          timestamp: result.timestamp,
          isValid: true
        }
      });
    } else {
      logger.warn(`Deepgram validation failed for model ${result.model}: ${result.error}`);
      
      res.status(400).send({
        success: false,
        message: 'Deepgram configuration validation failed',
        data: {
          model: result.model,
          timestamp: result.timestamp,
          isValid: false,
          error: result.error,
          suggestedAction: result.suggestedAction
        }
      });
    }
    
  } catch (error) {
    const errorMessage = handleError(error);
    logger.error(`Deepgram validation error: ${errorMessage}`);
    
    res.status(500).send({
      success: false,
      message: 'Internal server error during validation',
      error: errorMessage
    });
  }
};

// @desc    Get Deepgram validation status
// @route   GET /api/configuration/deepgram/status
// @access  Private
export const getDeepgramValidationStatus = async (_req: FastifyRequest, res: FastifyReply) => {
  try {
    const { getDeepgramAutoConfigService } = await import('../services/deepgramAutoConfigService');
    const autoConfigService = getDeepgramAutoConfigService();
    
    // Get current validation status
    const status = await autoConfigService.getValidationStatus();
    
    res.status(200).send({
      success: true,
      message: 'Deepgram validation status retrieved',
      data: status
    });
    
  } catch (error) {
    const errorMessage = handleError(error);
    logger.error(`Error getting Deepgram validation status: ${errorMessage}`);
    
    res.status(500).send({
      success: false,
      message: 'Internal server error getting validation status',
      error: errorMessage
    });
  }
};

// @desc    Test Deepgram model compatibility
// @route   POST /api/configuration/deepgram/test-model
// @access  Private
export const testDeepgramModelCompatibility = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { model } = req.body as any;
    
    if (!model) {
      return res.status(400).send({
        success: false,
        message: 'Model name is required'
      });
    }
    
    logger.info(`Testing Deepgram model compatibility: ${model}`);
    
    // Get current configuration
    const config = await Configuration.findOne();
    if (!config || !config.deepgramConfig?.apiKey) {
      return res.status(400).send({
        success: false,
        message: 'Deepgram API key not configured'
      });
    }
    
    const { getModelCompatibilityService } = await import('../services/modelCompatibilityService');
    const compatibilityService = getModelCompatibilityService();
    
    if (!compatibilityService) {
      return res.status(500).send({
        success: false,
        message: 'Model compatibility service not initialized'
      });
    }
    
    // Test model compatibility
    const result = await compatibilityService.validateModelAccess(config.deepgramConfig.apiKey, model);
    
    if (result.isValid) {
      logger.info(`Model ${model} is compatible`);
      
      res.status(200).send({
        success: true,
        message: `Model ${model} is compatible`,
        data: {
          model: result.model,
          tier: result.tier,
          isValid: true
        }
      });
    } else {
      logger.warn(`Model ${model} is not compatible: ${result.error}`);
      
      res.status(400).send({
        success: false,
        message: `Model ${model} is not compatible`,
        data: {
          model: result.model,
          tier: result.tier,
          isValid: false,
          error: result.error,
          suggestedAlternatives: result.suggestedAlternatives
        }
      });
    }
    
  } catch (error) {
    const errorMessage = handleError(error);
    logger.error(`Error testing model compatibility: ${errorMessage}`);
    
    res.status(500).send({
      success: false,
      message: 'Internal server error during model compatibility test',
      error: errorMessage
    });
  }
};

// @desc    Get suggested models based on account capabilities
// @route   GET /api/configuration/deepgram/suggested-models
// @access  Private
export const getSuggestedDeepgramModels = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    logger.info('Getting suggested Deepgram models...');
    
    // Get current configuration
    const config = await Configuration.findOne();
    if (!config || !config.deepgramConfig?.apiKey) {
      return res.status(400).send({
        success: false,
        message: 'Deepgram API key not configured'
      });
    }
    
    const { getDeepgramConfigValidator } = await import('../services/deepgramConfigValidator');
    const configValidator = getDeepgramConfigValidator();
    
    // Get query parameters for preferences
    const { useCase = 'general', language = 'en', prioritizeAccuracy = false, prioritizeSpeed = false, prioritizeCost = false } = req.query as any;
    
    // Get optimal configuration suggestions
    const optimalConfig = await configValidator.suggestOptimalConfiguration(
      config.deepgramConfig.apiKey,
      {
        useCase,
        language,
        prioritizeAccuracy,
        prioritizeSpeed,
        prioritizeCost
      }
    );
    
    logger.info(`Generated optimal configuration suggestions for ${useCase} use case`);
    
    res.status(200).send({
      success: true,
      message: 'Suggested models retrieved successfully',
      data: {
        primaryModel: optimalConfig.config.model,
        fallbackModels: optimalConfig.config.fallbackModels || [],
        accountTier: optimalConfig.config.accountTier,
        availableModels: optimalConfig.config.availableModels || [],
        reasoning: optimalConfig.reasoning,
        warnings: optimalConfig.warnings,
        configuration: {
          language: optimalConfig.config.language,
          autoFallback: optimalConfig.config.autoFallback,
          punctuate: optimalConfig.config.punctuate,
          diarize: optimalConfig.config.diarize,
          endpointing: optimalConfig.config.endpointing,
          utteranceEndMs: optimalConfig.config.utteranceEndMs
        }
      }
    });
    
  } catch (error) {
    const errorMessage = handleError(error);
    logger.error(`Error getting suggested models: ${errorMessage}`);
    
    res.status(500).send({
      success: false,
      message: 'Internal server error getting suggested models',
      error: errorMessage
    });
  }
};

// @desc    Validate complete Deepgram configuration
// @route   POST /api/configuration/deepgram/validate-config
// @access  Private
export const validateCompleteDeepgramConfiguration = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    logger.info('Validating complete Deepgram configuration...');
    
    // Get current configuration
    const config = await Configuration.findOne();
    if (!config || !config.deepgramConfig?.apiKey) {
      return res.status(400).send({
        success: false,
        message: 'Deepgram API key not configured'
      });
    }
    
    const { getDeepgramConfigValidator } = await import('../services/deepgramConfigValidator');
    const configValidator = getDeepgramConfigValidator();
    
    // Prepare configuration for validation
    const configForValidation = {
      apiKey: config.deepgramConfig.apiKey,
      model: config.deepgramConfig.primaryModel,
      language: (req.body as any).language || 'en',
      fallbackModels: config.deepgramConfig.fallbackModels,
      accountTier: config.deepgramConfig.tier,
      availableModels: config.deepgramConfig.availableModels,
      autoFallback: config.deepgramConfig.autoFallback,
      status: config.deepgramConfig.status,
      lastModelValidation: config.deepgramConfig.lastModelValidation,
      lastError: config.deepgramConfig.lastError,
      ...(req.body as any) // Allow override of specific settings for validation
    };
    
    // Validate the configuration
    const validationResult = await configValidator.validateConfiguration(configForValidation);
    
    logger.info(`Configuration validation completed: ${validationResult.isValid ? 'PASSED' : 'FAILED'}`);
    
    res.status(validationResult.isValid ? 200 : 400).send({
      success: validationResult.isValid,
      message: validationResult.isValid 
        ? 'Deepgram configuration is valid' 
        : 'Deepgram configuration has issues',
      data: {
        isValid: validationResult.isValid,
        issues: validationResult.issues,
        suggestions: validationResult.suggestions,
        accountInfo: validationResult.accountInfo
      }
    });
    
  } catch (error) {
    const errorMessage = handleError(error);
    logger.error(`Error validating complete configuration: ${errorMessage}`);
    
    res.status(500).send({
      success: false,
      message: 'Internal server error during configuration validation',
      error: errorMessage
    });
  }
};

// @desc    Batch test multiple models
// @route   POST /api/configuration/deepgram/batch-test-models
// @access  Private
export const batchTestDeepgramModels = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { models } = req.body as any;
    
    if (!models || !Array.isArray(models) || models.length === 0) {
      return res.status(400).send({
        success: false,
        message: 'Models array is required and must not be empty'
      });
    }
    
    if (models.length > 10) {
      return res.status(400).send({
        success: false,
        message: 'Maximum 10 models can be tested at once'
      });
    }
    
    logger.info(`Batch testing ${models.length} Deepgram models: ${models.join(', ')}`);
    
    // Get current configuration
    const config = await Configuration.findOne();
    if (!config || !config.deepgramConfig?.apiKey) {
      return res.status(400).send({
        success: false,
        message: 'Deepgram API key not configured'
      });
    }
    
    const { getDeepgramConfigValidator } = await import('../services/deepgramConfigValidator');
    const configValidator = getDeepgramConfigValidator();
    
    // Batch test models
    const testResults = await configValidator.batchTestModels(config.deepgramConfig.apiKey, models);
    
    // Convert Map to object for JSON response
    const resultsObject: { [key: string]: any } = {};
    testResults.forEach((result, model) => {
      resultsObject[model] = result;
    });
    
    // Calculate summary statistics
    const totalModels = models.length;
    const accessibleModels = Array.from(testResults.values()).filter(result => result.isAccessible).length;
    const averageResponseTime = Array.from(testResults.values())
      .filter(result => result.responseTime)
      .reduce((sum, result) => sum + (result.responseTime || 0), 0) / totalModels;
    
    logger.info(`Batch testing completed: ${accessibleModels}/${totalModels} models accessible`);
    
    res.status(200).send({
      success: true,
      message: `Batch testing completed for ${totalModels} models`,
      data: {
        results: resultsObject,
        summary: {
          totalModels,
          accessibleModels,
          inaccessibleModels: totalModels - accessibleModels,
          averageResponseTime: Math.round(averageResponseTime),
          successRate: Math.round((accessibleModels / totalModels) * 100)
        }
      }
    });
    
  } catch (error) {
    const errorMessage = handleError(error);
    logger.error(`Error in batch model testing: ${errorMessage}`);
    
    res.status(500).send({
      success: false,
      message: 'Internal server error during batch model testing',
      error: errorMessage
    });
  }
};

/**

 * @desc    Fetch LLM models dynamically with API key
 * @route   POST /api/configuration/llm-models/dynamic
 * @access  Private
 */
export const getDynamicProviderModels = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { provider, apiKey } = req.body as { provider: string; apiKey: string };

    if (!provider || !apiKey) {
      return res.status(400).send({
        success: false,
        message: 'Provider and API key are required'
      });
    }

    logger.info(`Fetching models for provider: ${provider}`);

    let models: any[] = [];

    switch (provider.toLowerCase()) {
      case 'openai':
        try {
          const openaiResponse = await axios.get('https://api.openai.com/v1/models', {
            headers: {
              'Authorization': `Bearer ${apiKey}`
            }
          });
          
          // Filter for chat models only
          models = openaiResponse.data.data
            .filter((model: any) => 
              model.id.includes('gpt') && 
              !model.id.includes('instruct') &&
              !model.id.includes('vision')
            )
            .map((model: any) => ({
              id: model.id,
              name: model.id,
              description: `OpenAI ${model.id}`
            }))
            .sort((a: any, b: any) => b.id.localeCompare(a.id));
        } catch (error: any) {
          logger.error(`OpenAI API error: ${getErrorMessage(error)}`);
          throw new Error(error.response?.data?.error?.message || 'Failed to fetch OpenAI models');
        }
        break;

      case 'anthropic':
        // Anthropic doesn't have a models list endpoint, return known models
        models = [
          { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', description: 'Most intelligent model' },
          { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', description: 'Fastest model' },
          { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', description: 'Powerful model for complex tasks' },
          { id: 'claude-3-sonnet-20240229', name: 'Claude 3 Sonnet', description: 'Balanced performance' },
          { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', description: 'Fast and compact' }
        ];
        
        // Verify API key by making a test request
        try {
          await axios.post('https://api.anthropic.com/v1/messages', {
            model: 'claude-3-haiku-20240307',
            max_tokens: 1,
            messages: [{ role: 'user', content: 'test' }]
          }, {
            headers: {
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json'
            }
          });
        } catch (error: any) {
          if (error.response?.status === 401) {
            throw new Error('Invalid Anthropic API key');
          }
          // Other errors are okay, we just wanted to verify the key
        }
        break;

      case 'google':
        // Fetch actual available models from Google API
        try {
          const listModelsResponse = await axios.get(
            `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
          );
          
          // Filter for models that support generateContent
          const availableModels = listModelsResponse.data.models
            .filter((model: any) => 
              model.supportedGenerationMethods?.includes('generateContent')
            )
            .map((model: any) => {
              // Extract model name from full path (e.g., "models/gemini-1.5-flash" -> "gemini-1.5-flash")
              const modelId = model.name.replace('models/', '');
              
              // Create friendly names
              let friendlyName = modelId;
              let description = model.description || '';
              
              if (modelId.includes('gemini-2.5')) {
                friendlyName = modelId.includes('pro') ? 'Gemini 2.5 Pro' : 'Gemini 2.5 Flash';
                description = modelId.includes('pro') ? 'Latest, most capable model' : 'Latest, fast and efficient';
              } else if (modelId.includes('gemini-2.0')) {
                friendlyName = 'Gemini 2.0 Flash';
                description = 'Stable 2.0 version';
              } else if (modelId.includes('gemini-1.5')) {
                friendlyName = modelId.includes('pro') ? 'Gemini 1.5 Pro' : 'Gemini 1.5 Flash';
                description = modelId.includes('pro') ? 'Most capable 1.5 model' : 'Fast and efficient 1.5 model';
              } else if (modelId.includes('gemini-1.0')) {
                friendlyName = 'Gemini 1.0 Pro';
                description = 'Stable production model';
              }
              
              return {
                id: modelId,
                name: friendlyName,
                description: description
              };
            })
            // Sort by version (newest first)
            .sort((a: any, b: any) => b.id.localeCompare(a.id));
          
          models = availableModels;
          
          if (models.length === 0) {
            throw new Error('No models available for this API key');
          }
          
          logger.info(`Found ${models.length} available Google models`);
        } catch (error: any) {
          if (error.response?.status === 400 && error.response?.data?.error?.message?.includes('API key')) {
            throw new Error('Invalid Google API key');
          }
          logger.error(`Error fetching Google models: ${getErrorMessage(error)}`);
          throw new Error('Failed to fetch available models from Google API');
        }
        break;

      default:
        return res.status(400).send({
          success: false,
          message: `Unsupported provider: ${provider}`
        });
    }

    logger.info(`Successfully fetched ${models.length} models for ${provider}`);

    return res.status(200).send({
      success: true,
      provider,
      models
    });

  } catch (error) {
    const errorMessage = handleError(error);
    logger.error(`Error fetching dynamic models: ${errorMessage}`);
    
    return res.status(500).send({
      success: false,
      message: errorMessage
    });
  }
};


/**
 * @desc    Test LLM chat functionality
 * @route   POST /api/configuration/test-llm-chat
 * @access  Private
 */
export const testLLMChat = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { provider, apiKey, model, prompt, temperature } = req.body as any;

    if (!provider || !prompt) {
      return res.status(400).send({
        success: false,
        message: 'Provider and prompt are required'
      });
    }

    logger.info(`Testing LLM chat for provider: ${provider}`);

    let response: any;
    let content = '';

    switch (provider.toLowerCase()) {
      case 'openai':
        try {
          const openaiResponse = await axios.post(
            'https://api.openai.com/v1/chat/completions',
            {
              model: model || 'gpt-4o-mini',
              messages: [{ role: 'user', content: prompt }],
              temperature: temperature || 0.7,
              max_tokens: 150
            },
            {
              headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json'
              }
            }
          );
          content = openaiResponse.data.choices[0].message.content;
        } catch (error: any) {
          logger.error(`OpenAI chat error: ${getErrorMessage(error)}`);
          throw new Error(error.response?.data?.error?.message || 'OpenAI chat test failed');
        }
        break;

      case 'anthropic':
        try {
          const anthropicResponse = await axios.post(
            'https://api.anthropic.com/v1/messages',
            {
              model: model || 'claude-3-haiku-20240307',
              max_tokens: 150,
              messages: [{ role: 'user', content: prompt }],
              temperature: temperature || 0.7
            },
            {
              headers: {
                'x-api-key': apiKey,
                'anthropic-version': '2023-06-01',
                'content-type': 'application/json'
              }
            }
          );
          content = anthropicResponse.data.content[0].text;
        } catch (error: any) {
          logger.error(`Anthropic chat error: ${getErrorMessage(error)}`);
          throw new Error(error.response?.data?.error?.message || 'Anthropic chat test failed');
        }
        break;

      case 'google':
        try {
          // Use provided model or fetch the first available model
          let modelToUse = model;
          
          if (!modelToUse) {
            // Fetch available models to get a default
            const listModelsResponse = await axios.get(
              `https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`
            );
            const availableModels = listModelsResponse.data.models
              .filter((m: any) => m.supportedGenerationMethods?.includes('generateContent'))
              .map((m: any) => m.name.replace('models/', ''));
            
            modelToUse = availableModels[0] || 'gemini-1.5-flash';
          }
          
          const googleResponse = await axios.post(
            `https://generativelanguage.googleapis.com/v1/models/${modelToUse}:generateContent?key=${apiKey}`,
            {
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: temperature || 0.7,
                maxOutputTokens: 150
              }
            }
          );
          content = googleResponse.data.candidates[0].content.parts[0].text;
        } catch (error: any) {
          logger.error(`Google chat error: ${getErrorMessage(error)}`);
          throw new Error(error.response?.data?.error?.message || 'Google chat test failed');
        }
        break;

      default:
        return res.status(400).send({
          success: false,
          message: `Unsupported provider: ${provider}`
        });
    }

    logger.info(`LLM chat test successful for ${provider}`);

    return res.status(200).send({
      success: true,
      provider,
      model: model || 'default',
      response: {
        content,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    const errorMessage = handleError(error);
    logger.error(`LLM chat test error: ${errorMessage}`);
    
    return res.status(500).send({
      success: false,
      message: errorMessage
    });
  }
};

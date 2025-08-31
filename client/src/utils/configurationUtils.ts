/**
 * Utility functions for checking configuration status
 */

import { configApi } from '../services/configApi';

export interface ConfigurationStatus {
  telephonyConfigured: boolean;
  voiceConfigured: boolean;
  llmConfigured: boolean;
  asrConfigured: boolean;
  overallConfigured: boolean;
  details: {
    twilioAccountSid: boolean;
    twilioAuthToken: boolean;
    twilioPhoneNumber: boolean;
    elevenLabsApiKey: boolean;
    llmApiKey: boolean;
    asrApiKey: boolean;
  };
}

/**
 * Check if telephony services are properly configured
 */
export async function checkTelephonyConfiguration(): Promise<ConfigurationStatus> {
  try {
    const config = await configApi.getConfiguration();
    
    const twilioAccountSid = !!(config.twilioConfig?.accountSid && !config.twilioConfig.accountSid.includes('••••'));
    const twilioAuthToken = !!(config.twilioConfig?.authToken && !config.twilioConfig.authToken.includes('••••'));
    const twilioPhoneNumber = !!(config.twilioConfig?.phoneNumbers?.[0]);
    
    // Determine voice configuration based on selected TTS provider
    const selectedTTSProvider = config.ttsConfig?.provider || 'elevenlabs';
    let voiceConfigured = false;
    
    if (selectedTTSProvider === 'elevenlabs') {
      voiceConfigured = !!(config.elevenLabsConfig?.isEnabled && config.elevenLabsConfig?.apiKey && !config.elevenLabsConfig.apiKey.includes('••••'));
    } else if (selectedTTSProvider === 'deepgram') {
      voiceConfigured = !!(config.ttsConfig?.deepgramTTS?.isEnabled && config.ttsConfig?.deepgramTTS?.apiKey && !config.ttsConfig.deepgramTTS.apiKey.includes('••••'));
    } else {
      // For other providers, fall back to ElevenLabs check for backward compatibility
      voiceConfigured = !!(config.elevenLabsConfig?.apiKey && !config.elevenLabsConfig.apiKey.includes('••••'));
    }
    
    const llmProvider = config.llmConfig?.providers?.find((p: any) => p.name === config.llmConfig?.defaultProvider);
    const llmApiKey = !!(llmProvider?.apiKey && !llmProvider.apiKey.includes('••••'));
    
    // Check ASR configuration (support both asrConfig.apiKey and deepgramConfig.apiKey)
    const asrApiKey = !!(
      (config.asrConfig?.apiKey && !config.asrConfig.apiKey.includes('••••')) ||
      (config.deepgramConfig?.apiKey && !config.deepgramConfig.apiKey.includes('••••'))
    );
    
    const telephonyConfigured = twilioAccountSid && twilioAuthToken && twilioPhoneNumber;
    const llmConfigured = llmApiKey;
    const asrConfigured = asrApiKey;
    const overallConfigured = telephonyConfigured && voiceConfigured && llmConfigured && asrConfigured;
    
    return {
      telephonyConfigured,
      voiceConfigured,
      llmConfigured,
      asrConfigured,
      overallConfigured,
      details: {
        twilioAccountSid,
        twilioAuthToken,
        twilioPhoneNumber,
        elevenLabsApiKey: selectedTTSProvider === 'elevenlabs' ? voiceConfigured : !!(config.elevenLabsConfig?.apiKey && !config.elevenLabsConfig.apiKey.includes('••••')),
        llmApiKey,
        asrApiKey,
      }
    };
  } catch (error) {
    console.error('Error checking configuration:', error);
    return {
      telephonyConfigured: false,
      voiceConfigured: false,
      llmConfigured: false,
      asrConfigured: false,
      overallConfigured: false,
      details: {
        twilioAccountSid: false,
        twilioAuthToken: false,
        twilioPhoneNumber: false,
        elevenLabsApiKey: false,
        llmApiKey: false,
        asrApiKey: false,
      }
    };
  }
}

/**
 * Test telephony service connectivity
 */
export async function testTelephonyConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const config = await configApi.getConfiguration();
    
    if (!config.twilioConfig?.accountSid || !config.twilioConfig?.authToken) {
      return {
        success: false,
        message: 'Twilio credentials not configured'
      };
    }
    
    const result = await configApi.testTwilioConnection({
      accountSid: config.twilioConfig.accountSid,
      authToken: config.twilioConfig.authToken,
      phoneNumber: config.twilioConfig.phoneNumbers?.[0]
    });
    
    return {
      success: result.success,
      message: result.message || (result.success ? 'Connection successful' : 'Connection failed')
    };
  } catch (error: any) {
    return {
      success: false,
      message: error.response?.data?.message || 'Failed to test connection'
    };
  }
}

import api from './api';

// Types
interface LLMConnectionData {
  provider: string;
  apiKey: string;
  model: string;
}

interface LLMChatTestData {
  provider: string;
  apiKey?: string;
  model?: string;
  prompt: string;
  temperature?: number;
}

interface TwilioConnectionData {
  accountSid: string;
  authToken: string;
  phoneNumber?: string;
}

interface TwilioTestCallData {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  toNumber: string;
  message?: string;
}

interface ElevenLabsConnectionData {
  apiKey: string;
}

interface DeepgramTTSConnectionData {
  apiKey: string;
}

interface VoiceSynthesisTestData {
  voiceId: string;
  text: string;
  apiKey?: string;
}

interface DeleteApiKeyParams {
  provider: 'elevenlabs' | 'llm' | 'twilio' | 'webhook' | 'deepgram';
  name?: string; // For LLM providers, specify which one (openai, anthropic, etc.)
}

// Configuration API endpoints
export const configApi = {
  // Get system configuration
  getConfiguration: async () => {
    const response = await api.get('/configuration');
    return response.data;
  },

  // Update system configuration
  updateConfiguration: async (configData: any) => {
    // Create a deep copy to avoid modifying the original object
    const configToSend = JSON.parse(JSON.stringify(configData));
    
    // Add detailed debug logging for key fields
    console.log('Updating configuration with:', {
      elevenLabsConfig: {
        voiceSpeed: configToSend.elevenLabsConfig?.voiceSpeed,
        voiceStability: configToSend.elevenLabsConfig?.voiceStability,
        voiceClarity: configToSend.elevenLabsConfig?.voiceClarity,
        isEnabled: configToSend.elevenLabsConfig?.isEnabled,
        apiKey: configToSend.elevenLabsConfig?.apiKey ? '[MASKED]' : 'NOT SET',
      },
      llmConfig: {
        defaultProvider: configToSend.llmConfig?.defaultProvider,
        defaultModel: configToSend.llmConfig?.defaultModel,
        temperature: configToSend.llmConfig?.temperature,
        maxTokens: configToSend.llmConfig?.maxTokens,
        providers: configToSend.llmConfig?.providers?.map((p: any) => ({
          name: p.name,
          isEnabled: p.isEnabled,
          apiKey: p.apiKey ? '[MASKED]' : 'NOT SET',
        })),
      },
      webhookConfig: {
        // URL is now environment-only, not sent from frontend
        secret: configToSend.webhookConfig?.secret ? '[MASKED]' : 'NOT SET',
      }
    });
    
    try {
      const response = await api.put('/configuration', configToSend);
      console.log('Configuration update response:', {
        status: response.status,
        success: response.data?.success || true,
      });
      return response.data;
    } catch (error) {
      console.error('Error updating configuration:', error);
      throw error;
    }
  },

  // Delete an API key
  deleteApiKey: async (params: DeleteApiKeyParams) => {
    console.log(`Deleting API key for provider: ${params.provider}${params.name ? `, name: ${params.name}` : ''}`);
    try {
      const response = await api.delete(`/configuration/api-key/${params.provider}${params.name ? `/${params.name}` : ''}`);
      return response.data;
    } catch (error) {
      console.error('Error deleting API key:', error);
      throw error;
    }
  },

  // Get LLM options
  getLLMOptions: async () => {
    const response = await api.get('/configuration/llm-options');
    return response.data;
  },

  // Get voice options
  getVoiceOptions: async () => {
    const response = await api.get('/configuration/voice-options');
    return response.data;
  },

  // Test LLM connection
  testLLMConnection: async (connectionData: LLMConnectionData) => {
    const response = await api.post('/configuration/test-llm', connectionData);
    return response.data;
  },

  // Test LLM chat functionality
  testLLMChat: async (chatData: LLMChatTestData) => {
    console.log('Testing LLM chat with data:', {
      provider: chatData.provider,
      model: chatData.model || 'default',
      prompt: chatData.prompt ? `${chatData.prompt.substring(0, 20)}...` : 'empty',
      temperature: chatData.temperature || 0.7,
      apiKey: chatData.apiKey ? 'PROVIDED' : 'FROM CONFIG'
    });
    
    try {
      const response = await api.post('/configuration/test-llm-chat', chatData);
      console.log('LLM chat test response:', {
        success: response.data.success,
        contentPreview: response.data.response?.content ? 
          `${response.data.response.content.substring(0, 50)}...` : 'No content'
      });
      return response.data;
    } catch (error: any) {
      console.error('LLM chat test error:', error);
      if (error.response) {
        const errorDetails = error.response.data;
        console.error('Error details:', errorDetails);
        throw new Error(errorDetails.message || 'LLM chat test failed. Server returned an error.');
      }
      throw error;
    }
  },

  // Test Twilio connection
  testTwilioConnection: async (connectionData: TwilioConnectionData) => {
    const response = await api.post('/configuration/test-twilio', connectionData);
    return response.data;
  },

  // Test ElevenLabs connection
  testElevenLabsConnection: async (connectionData: ElevenLabsConnectionData) => {
    const response = await api.post('/configuration/test-elevenlabs', connectionData);
    return response.data;
  },

  // Test Deepgram TTS connection
  testDeepgramTTSConnection: async (connectionData: DeepgramTTSConnectionData) => {
    const response = await api.post('/configuration/test-deepgram-tts', connectionData);
    return response.data;
  },

  // Make a test call with Twilio
  makeTestCall: async (callData: TwilioTestCallData) => {
    console.log('Making test call with data:', {
      fromNumber: callData.fromNumber,
      toNumber: callData.toNumber,
      message: callData.message ? 'provided' : 'default',
      accountSid: callData.accountSid ? `${callData.accountSid.substring(0, 5)}...` : 'NOT SET',
      authToken: callData.authToken ? 'SET' : 'NOT SET'
    });
    
    try {
      const response = await api.post('/configuration/test-call', callData);
      console.log('Test call response:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('Test call error:', error);
      if (error.response) {
        const errorDetails = error.response.data;
        console.error('Error details:', errorDetails);
        throw new Error(errorDetails.message || 'Test call failed. Server returned an error.');
      }
      throw error;
    }
  },

  // Test voice synthesis
  testVoiceSynthesis: async (synthesisData: VoiceSynthesisTestData) => {
    console.log('Testing voice synthesis with data:', {
      voiceId: synthesisData.voiceId,
      text: synthesisData.text ? `${synthesisData.text.substring(0, 20)}...` : 'empty',
      apiKey: synthesisData.apiKey ? `${synthesisData.apiKey.substring(0, 5)}...${synthesisData.apiKey.substring(synthesisData.apiKey.length - 5)}` : 'NOT SET'
    });
    
    if (!synthesisData.voiceId) {
      throw new Error('Voice ID is required');
    }
    
    if (!synthesisData.text) {
      throw new Error('Text is required');
    }
    
    if (!synthesisData.apiKey) {
      throw new Error('API key is required');
    }
    
    try {
      const response = await api.post('/configuration/test-voice', synthesisData);
      console.log('Voice synthesis test response:', response.data);
      return response.data;
    } catch (error: any) {
      console.error('Voice synthesis test error:', error);
      // Enhanced error reporting with more details
      if (error.response) {
        const errorDetails = error.response.data;
        console.error('Error details:', errorDetails);
        throw new Error(errorDetails.message || 'Voice test failed. Server returned an error.');
      }
      throw error;
    }
  },

  // Dynamically fetch models from a provider using an API key
  fetchModelsWithApiKey: async (provider: string, apiKey: string) => {
    console.log('Fetching models dynamically for provider:', provider);
    
    try {
      const response = await api.post('/configuration/llm-models/dynamic', {
        provider,
        apiKey
      });
      
      console.log('Dynamic model fetch response:', {
        success: response.data.success,
        provider: response.data.provider,
        modelCount: response.data.models?.length || 0
      });
      
      return response.data;
    } catch (error: any) {
      console.error('Dynamic model fetch error:', error);
      if (error.response) {
        const errorDetails = error.response.data;
        console.error('Error details:', errorDetails);
        throw new Error(errorDetails.message || 'Failed to fetch models from provider.');
      }
      throw error;
    }
  }
};

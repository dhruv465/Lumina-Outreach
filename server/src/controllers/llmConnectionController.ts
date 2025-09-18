/**
 * LLM Connection Test Controller
 * 
 * This controller handles testing LLM provider connections with the unified LLM Service SDK.
 */
import { FastifyRequest, FastifyReply } from 'fastify';
import Configuration from '../models/Configuration';
import { logger, getErrorMessage } from '../index';
import LLMService, { LLMConfig, LLMProvider, LLMMessage } from '../services/llm';

interface TestLLMConnectionParams {
  provider: string;
  apiKey: string;
  model: string;
}

/**
 * Test LLM provider connection
 * @route POST /api/configuration/test-llm
 * @access Private
 */
export const testLLMConnection = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { provider, apiKey, model } = req.body as TestLLMConnectionParams;

    if (!provider || !apiKey || !model) {
      return res.status(400).send({ 
        message: 'Provider, API key, and model are required',
        success: false
      });
    }

    // Normalize provider name
    const providerName = provider.toLowerCase() as LLMProvider;
    // Map 'gemini' to 'google' for configuration lookup
    const configProviderName = providerName === 'gemini' ? 'google' : providerName;
    
    // Create a one-time service for testing
    const config: LLMConfig = {
      providers: [{
        name: configProviderName as LLMProvider,
        apiKey: apiKey,
        defaultModel: model,
        isEnabled: true
      }],
      defaultProvider: configProviderName as LLMProvider
    };
    
    const llmService = new LLMService(config);
    
    let isSuccessful = false;
    let response: any = null;
    
    try {
      // Get the provider client and test connection
      const provider = llmService.getProvider(configProviderName as LLMProvider);
      await provider.testConnection();
      
      // Send a simple test message
      const testMessages: LLMMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
        { role: 'user', content: 'Say "Connection successful"' }
      ];
      
      const result = await llmService.chat({
        provider: providerName,
        model: model,
        messages: testMessages,
        options: {
          maxTokens: 50
        }
      });
      
      isSuccessful = true;
      response = result.rawResponse;
    } catch (error) {
      logger.error(`${provider} test connection failed:`, error);
      response = {
        error: getErrorMessage(error)
      };
    }

    // Update LLM provider status in database based on test result
    const configuration = await Configuration.findOne();
    if (configuration) {
      // Find the provider and update its status
      const providerIndex = configuration.llmConfig.providers.findIndex(
        p => p.name.toLowerCase() === configProviderName
      );
      
      if (providerIndex >= 0) {
        if (isSuccessful) {
          configuration.llmConfig.providers[providerIndex].lastVerified = new Date();
          configuration.llmConfig.providers[providerIndex].status = 'verified';
        } else {
          configuration.llmConfig.providers[providerIndex].status = 'failed';
        }
        
        await configuration.save();
        logger.info(`${provider} LLM provider status updated to ${isSuccessful ? 'verified' : 'failed'}`);
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
      error: getErrorMessage(error)
    });
  }
};

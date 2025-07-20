import { ModelCompatibilityService, DeepgramErrorType, AccountTier, ModelValidationResult, AccountCapabilities, ModelPreferences } from '../modelCompatibilityService';
import { createClient } from '@deepgram/sdk';

// Mock the Deepgram SDK
jest.mock('@deepgram/sdk');
const mockCreateClient = createClient as jest.MockedFunction<typeof createClient>;

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  },
  getErrorMessage: jest.fn((error) => error.message || 'Unknown error')
}));

// Mock alert system
jest.mock('../../monitoring/alert_system', () => ({
  alertSystem: {
    createAlert: jest.fn()
  },
  AlertLevel: {
    INFO: 'info',
    WARNING: 'warning',
    CRITICAL: 'critical'
  },
  AlertType: {
    DEEPGRAM_MODEL_VALIDATION: 'deepgram-model-validation',
    DEEPGRAM_MODEL_FALLBACK: 'deepgram-model-fallback',
    DEEPGRAM_ULTIMATE_FALLBACK: 'deepgram-ultimate-fallback',
    DEEPGRAM_ACCOUNT_TIER: 'deepgram-account-tier',
    DEEPGRAM_LIMITED_MODELS: 'deepgram-limited-models'
  }
}));

describe('ModelCompatibilityService', () => {
  let service: ModelCompatibilityService;
  let mockClient: any;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Create mock client
    mockClient = {
      listen: {
        prerecorded: {
          transcribeUrl: jest.fn()
        }
      }
    };
    
    mockCreateClient.mockReturnValue(mockClient);
    
    // Create service instance
    service = new ModelCompatibilityService('test-api-key');
  });

  describe('validateModelAccess', () => {
    it('should return valid result for accessible model', async () => {
      // Mock successful API call
      mockClient.listen.prerecorded.transcribeUrl.mockResolvedValue({
        result: {
          results: {
            channels: [{
              alternatives: [{
                transcript: 'test',
                confidence: 0.9
              }]
            }]
          }
        }
      });

      const result = await service.validateModelAccess('test-key', 'nova-2');

      expect(result.isValid).toBe(true);
      expect(result.model).toBe('nova-2');
      expect(result.tier).toBe('premium');
      expect(result.suggestedAlternatives).toEqual([]);
    });

    it('should return invalid result with alternatives for permission error', async () => {
      // Mock permission error
      const permissionError = new Error('Insufficient permissions');
      (permissionError as any).status = 403;
      mockClient.listen.prerecorded.transcribeUrl.mockRejectedValue(permissionError);

      const result = await service.validateModelAccess('test-key', 'nova-2');

      expect(result.isValid).toBe(false);
      expect(result.model).toBe('nova-2');
      expect(result.tier).toBe('premium');
      expect(result.error).toBe('Insufficient permissions');
      expect(result.suggestedAlternatives).toContain('nova');
      expect(result.suggestedAlternatives).toContain('base');
    });

    it('should cache validation results', async () => {
      // Mock successful API call
      mockClient.listen.prerecorded.transcribeUrl.mockResolvedValue({
        result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } }
      });

      // First call
      await service.validateModelAccess('test-key', 'nova-2');
      
      // Second call should use cache
      await service.validateModelAccess('test-key', 'nova-2');

      // API should only be called once
      expect(mockClient.listen.prerecorded.transcribeUrl).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCompatibleModels', () => {
    it('should return list of compatible models', async () => {
      // Mock successful calls for some models
      mockClient.listen.prerecorded.transcribeUrl
        .mockResolvedValueOnce({ result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } } }) // nova-2
        .mockRejectedValueOnce(new Error('Permission denied')) // nova-2-general
        .mockResolvedValueOnce({ result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } } }) // nova
        .mockResolvedValueOnce({ result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } } }); // base

      const compatibleModels = await service.getCompatibleModels('test-key');

      expect(compatibleModels).toContain('nova-2');
      expect(compatibleModels).toContain('nova');
      expect(compatibleModels).toContain('base');
      expect(compatibleModels).not.toContain('nova-2-general');
    });
  });

  describe('selectBestModel', () => {
    it('should select preferred model when available', () => {
      const availableModels = ['nova-2', 'nova', 'base'];
      const preferences = {
        preferredModels: ['nova-2'],
        useCase: 'general' as const,
        language: 'en',
        realtime: true
      };

      const selectedModel = service.selectBestModel(availableModels, preferences);

      expect(selectedModel).toBe('nova-2');
    });

    it('should select best available model when preferred not available', () => {
      const availableModels = ['nova', 'base'];
      const preferences = {
        preferredModels: ['nova-2'],
        useCase: 'general' as const,
        language: 'en',
        realtime: false
      };

      const selectedModel = service.selectBestModel(availableModels, preferences);

      expect(selectedModel).toBe('nova'); // Higher tier than base
    });

    it('should fallback to any model when no suitable models found', () => {
      const availableModels = ['base'];
      const preferences = {
        preferredModels: ['nova-2'],
        useCase: 'meeting' as const,
        language: 'fr', // base only supports 'en'
        realtime: true
      };

      const selectedModel = service.selectBestModel(availableModels, preferences);

      expect(selectedModel).toBe('base'); // Fallback to available model
    });
  });

  describe('handleModelFallback', () => {
    it('should suggest lower tier model for permission error', () => {
      const permissionError = new Error('Insufficient permissions');
      (permissionError as any).status = 403;

      const fallbackModel = service.handleModelFallback('nova-2', permissionError);

      expect(fallbackModel).toBe('nova'); // First alternative for premium model
    });

    it('should fallback to base for unknown errors', () => {
      const unknownError = new Error('Unknown error');

      const fallbackModel = service.handleModelFallback('unknown-model', unknownError);

      expect(fallbackModel).toBe('base'); // Ultimate fallback
    });
  });

  describe('getAccountCapabilities', () => {
    it('should detect premium account capabilities', async () => {
      // Mock successful calls for premium models
      mockClient.listen.prerecorded.transcribeUrl.mockResolvedValue({
        result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } }
      });

      const capabilities = await service.getAccountCapabilities('test-key');

      expect(capabilities.tier).toBe('premium');
      expect(capabilities.features.realtime).toBe(true);
      expect(capabilities.features.batch).toBe(true);
      expect(capabilities.features.streaming).toBe(true);
      expect(capabilities.limits.requestsPerMinute).toBe(1000);
    });

    it('should detect free account capabilities', async () => {
      // Mock failures for premium/basic models, success for free models
      mockClient.listen.prerecorded.transcribeUrl
        .mockRejectedValueOnce(new Error('Permission denied')) // nova-2
        .mockRejectedValueOnce(new Error('Permission denied')) // nova-2-general
        .mockRejectedValueOnce(new Error('Permission denied')) // nova-2-meeting
        .mockRejectedValueOnce(new Error('Permission denied')) // nova-2-phonecall
        .mockRejectedValueOnce(new Error('Permission denied')) // nova
        .mockRejectedValueOnce(new Error('Permission denied')) // nova-general
        .mockResolvedValueOnce({ result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } } }) // base
        .mockResolvedValueOnce({ result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } } }); // base-general

      const capabilities = await service.getAccountCapabilities('test-key');

      expect(capabilities.tier).toBe('free');
      expect(capabilities.features.realtime).toBe(false);
      expect(capabilities.features.batch).toBe(true);
      expect(capabilities.features.streaming).toBe(true);
      expect(capabilities.limits.requestsPerMinute).toBe(10);
      expect(capabilities.limits.hoursPerMonth).toBe(12);
    });
  });

  describe('updateApiKey', () => {
    it('should update API key and clear cache', () => {
      const clearCacheSpy = jest.spyOn(service, 'clearCache');
      
      service.updateApiKey('new-api-key');

      expect(mockCreateClient).toHaveBeenCalledWith('new-api-key');
      expect(clearCacheSpy).toHaveBeenCalled();
    });
  });

  describe('getModelRegistry', () => {
    it('should return model registry with expected models', () => {
      const registry = service.getModelRegistry();

      expect(registry.models).toHaveProperty('nova-2');
      expect(registry.models).toHaveProperty('nova');
      expect(registry.models).toHaveProperty('base');
      
      expect(registry.models['nova-2'].tier).toBe('premium');
      expect(registry.models['nova'].tier).toBe('basic');
      expect(registry.models['base'].tier).toBe('free');
    });
  });

  describe('error classification', () => {
    it('should classify permission errors correctly', async () => {
      const permissionError = new Error('Insufficient permissions');
      (permissionError as any).status = 403;
      mockClient.listen.prerecorded.transcribeUrl.mockRejectedValue(permissionError);

      const result = await service.validateModelAccess('test-key', 'nova-2');

      expect(result.suggestedAlternatives).toEqual(['nova', 'nova-general', 'base', 'base-general']);
    });

    it('should classify authentication errors correctly', async () => {
      const authError = new Error('Invalid API key');
      (authError as any).status = 401;
      mockClient.listen.prerecorded.transcribeUrl.mockRejectedValue(authError);

      const result = await service.validateModelAccess('test-key', 'nova-2');

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid API key');
    });

    it('should classify quota exceeded errors correctly', async () => {
      const quotaError = new Error('Rate limit exceeded');
      (quotaError as any).status = 429;
      mockClient.listen.prerecorded.transcribeUrl.mockRejectedValue(quotaError);

      const result = await service.validateModelAccess('test-key', 'nova-2');

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Rate limit exceeded');
      expect(result.suggestedAlternatives).toContain('nova');
    });

    it('should classify invalid model errors correctly', async () => {
      const invalidModelError = new Error('Invalid model: unknown-model');
      (invalidModelError as any).status = 400;
      mockClient.listen.prerecorded.transcribeUrl.mockRejectedValue(invalidModelError);

      const result = await service.validateModelAccess('test-key', 'unknown-model');

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Invalid model: unknown-model');
    });

    it('should classify network errors correctly', async () => {
      const networkError = new Error('Connection timeout');
      (networkError as any).code = 'ECONNRESET';
      mockClient.listen.prerecorded.transcribeUrl.mockRejectedValue(networkError);

      const result = await service.validateModelAccess('test-key', 'nova-2');

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Connection timeout');
    });
  });

  describe('fallback logic', () => {
    it('should provide correct fallback hierarchy for premium models', () => {
      const fallbackModel = service.handleModelFallback('nova-2', new Error('Permission denied'));
      expect(fallbackModel).toBe('nova');
    });

    it('should provide correct fallback hierarchy for basic models', () => {
      const fallbackModel = service.handleModelFallback('nova', new Error('Permission denied'));
      expect(fallbackModel).toBe('base');
    });

    it('should use first alternative for base models', () => {
      const fallbackModel = service.handleModelFallback('base', new Error('Service unavailable'));
      expect(fallbackModel).toBe('nova'); // First alternative from default list
    });

    it('should handle unknown models gracefully', () => {
      const fallbackModel = service.handleModelFallback('unknown-model', new Error('Model not found'));
      expect(fallbackModel).toBe('nova-2'); // First model that supports 'general' use case
    });
  });

  describe('model preferences and selection', () => {
    it('should respect use case preferences', () => {
      const availableModels = ['nova-2-meeting', 'nova-2-phonecall', 'nova-2'];
      const preferences: ModelPreferences = {
        preferredModels: [],
        useCase: 'meeting',
        language: 'en',
        realtime: false
      };

      const selectedModel = service.selectBestModel(availableModels, preferences);
      expect(selectedModel).toBe('nova-2-meeting');
    });

    it('should respect language preferences', () => {
      const availableModels = ['nova-2', 'base'];
      const preferences: ModelPreferences = {
        preferredModels: [],
        useCase: 'general',
        language: 'es',
        realtime: false
      };

      const selectedModel = service.selectBestModel(availableModels, preferences);
      expect(selectedModel).toBe('nova-2'); // Supports Spanish
    });

    it('should respect realtime requirements', () => {
      const availableModels = ['nova-2', 'base'];
      const preferences: ModelPreferences = {
        preferredModels: [],
        useCase: 'general',
        language: 'en',
        realtime: true
      };

      const selectedModel = service.selectBestModel(availableModels, preferences);
      expect(selectedModel).toBe('nova-2'); // Supports realtime
    });
  });

  describe('caching behavior', () => {
    it('should cache validation results for performance', async () => {
      mockClient.listen.prerecorded.transcribeUrl.mockResolvedValue({
        result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } }
      });

      // First call
      const result1 = await service.validateModelAccess('test-key', 'nova-2');
      
      // Second call should use cache
      const result2 = await service.validateModelAccess('test-key', 'nova-2');

      expect(result1).toEqual(result2);
      expect(mockClient.listen.prerecorded.transcribeUrl).toHaveBeenCalledTimes(1);
    });

    it('should clear cache when API key is updated', async () => {
      mockClient.listen.prerecorded.transcribeUrl.mockResolvedValue({
        result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } }
      });

      // First call
      await service.validateModelAccess('test-key', 'nova-2');
      
      // Update API key
      service.updateApiKey('new-key');
      
      // Second call should not use cache
      await service.validateModelAccess('new-key', 'nova-2');

      expect(mockClient.listen.prerecorded.transcribeUrl).toHaveBeenCalledTimes(2);
    });

    it('should respect cache TTL', async () => {
      jest.useFakeTimers();
      
      mockClient.listen.prerecorded.transcribeUrl.mockResolvedValue({
        result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } }
      });

      // First call
      await service.validateModelAccess('test-key', 'nova-2');
      
      // Advance time beyond cache TTL (5 minutes)
      jest.advanceTimersByTime(6 * 60 * 1000);
      
      // Second call should not use cache
      await service.validateModelAccess('test-key', 'nova-2');

      expect(mockClient.listen.prerecorded.transcribeUrl).toHaveBeenCalledTimes(2);
      
      jest.useRealTimers();
    });
  });

  describe('account tier detection edge cases', () => {
    it('should handle mixed model availability correctly', async () => {
      // Mock partial model availability - need to mock all models in the test order
      mockClient.listen.prerecorded.transcribeUrl
        .mockRejectedValueOnce(new Error('Permission denied')) // nova-2 fails
        .mockRejectedValueOnce(new Error('Permission denied')) // nova-2-general fails
        .mockRejectedValueOnce(new Error('Permission denied')) // nova-2-meeting fails
        .mockRejectedValueOnce(new Error('Permission denied')) // nova-2-phonecall fails
        .mockResolvedValueOnce({ result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } } }) // nova succeeds
        .mockResolvedValueOnce({ result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } } }) // nova-general succeeds
        .mockResolvedValueOnce({ result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } } }) // base succeeds
        .mockResolvedValueOnce({ result: { results: { channels: [{ alternatives: [{ transcript: 'test' }] }] } } }); // base-general succeeds

      const capabilities = await service.getAccountCapabilities('test-key');

      expect(capabilities.tier).toBe('basic'); // Highest available tier
      expect(capabilities.availableModels).toContain('nova');
      expect(capabilities.availableModels).toContain('base');
      expect(capabilities.availableModels).not.toContain('nova-2');
    });

    it('should handle complete model failure gracefully', async () => {
      // Mock all models failing
      mockClient.listen.prerecorded.transcribeUrl.mockRejectedValue(new Error('Service unavailable'));

      const capabilities = await service.getAccountCapabilities('test-key');

      expect(capabilities.tier).toBe('free'); // Default to free tier
      expect(capabilities.availableModels).toHaveLength(0);
      expect(capabilities.features.realtime).toBe(false);
    });
  });
});
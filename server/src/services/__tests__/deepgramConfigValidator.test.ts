import { 
  DeepgramConfigValidator, 
  getDeepgramConfigValidator,
  DeepgramConfigForValidation,
  ConfigValidationResult,
  OptimalConfigResult,
  ModelTestResult
} from '../deepgramConfigValidator';

// Mock the model compatibility service
jest.mock('../modelCompatibilityService', () => ({
  getModelCompatibilityService: jest.fn(() => ({
    getAccountCapabilities: jest.fn(),
    validateModelAccess: jest.fn(),
    selectBestModel: jest.fn(),
    getModelRegistry: jest.fn(() => ({
      models: {
        'nova-2': {
          name: 'nova-2',
          tier: 'premium',
          features: ['realtime', 'batch', 'streaming', 'high-accuracy'],
          useCases: ['general', 'meeting', 'phone'],
          languages: ['en', 'es', 'fr']
        },
        'nova': {
          name: 'nova',
          tier: 'basic',
          features: ['realtime', 'batch', 'streaming'],
          useCases: ['general', 'meeting', 'phone'],
          languages: ['en', 'es', 'fr']
        },
        'base': {
          name: 'base',
          tier: 'free',
          features: ['batch', 'streaming'],
          useCases: ['general'],
          languages: ['en']
        }
      }
    }))
  }))
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  },
  getErrorMessage: jest.fn((error) => error.message || error.toString())
}));

describe('DeepgramConfigValidator', () => {
  let validator: DeepgramConfigValidator;
  let mockModelCompatibilityService: any;

  beforeEach(() => {
    jest.clearAllMocks();
    validator = getDeepgramConfigValidator();
    mockModelCompatibilityService = require('../modelCompatibilityService').getModelCompatibilityService();
  });

  describe('validateConfiguration', () => {
    it('should return error for missing API key', async () => {
      const config: DeepgramConfigForValidation = {
        model: 'nova-2',
        language: 'en'
      };

      const result = await validator.validateConfiguration(config);

      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].field).toBe('apiKey');
      expect(result.issues[0].severity).toBe('error');
      expect(result.issues[0].code).toBe('MISSING_API_KEY');
    });

    it('should validate configuration with valid API key and model', async () => {
      const config: DeepgramConfigForValidation = {
        apiKey: 'test-api-key',
        model: 'nova-2',
        language: 'en'
      };

      // Mock successful validation
      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue({
        tier: 'premium',
        availableModels: ['nova-2', 'nova', 'base'],
        features: { realtime: true, batch: true, streaming: true },
        limits: { requestsPerMinute: 1000, hoursPerMonth: 1000 }
      });

      mockModelCompatibilityService.validateModelAccess.mockResolvedValue({
        isValid: true,
        model: 'nova-2',
        tier: 'premium',
        suggestedAlternatives: []
      });

      const result = await validator.validateConfiguration(config);

      expect(result.isValid).toBe(true);
      expect(result.issues.filter(issue => issue.severity === 'error')).toHaveLength(0);
      expect(result.accountInfo).toBeDefined();
      expect(result.accountInfo?.tier).toBe('premium');
    });

    it('should detect invalid primary model', async () => {
      const config: DeepgramConfigForValidation = {
        apiKey: 'test-api-key',
        model: 'invalid-model',
        language: 'en'
      };

      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue({
        tier: 'free',
        availableModels: ['base'],
        features: { realtime: false, batch: true, streaming: true },
        limits: { requestsPerMinute: 10, hoursPerMonth: 12 }
      });

      mockModelCompatibilityService.validateModelAccess.mockResolvedValue({
        isValid: false,
        model: 'invalid-model',
        tier: 'premium',
        error: 'Model not available for free tier',
        suggestedAlternatives: ['base']
      });

      const result = await validator.validateConfiguration(config);

      expect(result.isValid).toBe(false);
      expect(result.issues.some(issue => issue.code === 'INVALID_PRIMARY_MODEL')).toBe(true);
      expect(result.suggestions.some(suggestion => suggestion.field === 'model')).toBe(true);
    });

    it('should detect account tier mismatch', async () => {
      const config: DeepgramConfigForValidation = {
        apiKey: 'test-api-key',
        model: 'nova',
        language: 'en',
        accountTier: 'premium'
      };

      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue({
        tier: 'basic',
        availableModels: ['nova', 'base'],
        features: { realtime: true, batch: true, streaming: true },
        limits: { requestsPerMinute: 100, hoursPerMonth: 100 }
      });

      mockModelCompatibilityService.validateModelAccess.mockResolvedValue({
        isValid: true,
        model: 'nova',
        tier: 'basic',
        suggestedAlternatives: []
      });

      const result = await validator.validateConfiguration(config);

      expect(result.isValid).toBe(true); // Warning, not error
      expect(result.issues.some(issue => issue.code === 'TIER_MISMATCH')).toBe(true);
      expect(result.suggestions.some(suggestion => 
        suggestion.field === 'accountTier' && suggestion.suggestedValue === 'basic'
      )).toBe(true);
    });

    it('should validate fallback models', async () => {
      const config: DeepgramConfigForValidation = {
        apiKey: 'test-api-key',
        model: 'nova-2',
        language: 'en',
        fallbackModels: ['nova', 'invalid-fallback']
      };

      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue({
        tier: 'premium',
        availableModels: ['nova-2', 'nova'],
        features: { realtime: true, batch: true, streaming: true },
        limits: { requestsPerMinute: 1000, hoursPerMonth: 1000 }
      });

      mockModelCompatibilityService.validateModelAccess
        .mockResolvedValueOnce({
          isValid: true,
          model: 'nova-2',
          tier: 'premium',
          suggestedAlternatives: []
        })
        .mockResolvedValueOnce({
          isValid: true,
          model: 'nova',
          tier: 'basic',
          suggestedAlternatives: []
        })
        .mockResolvedValueOnce({
          isValid: false,
          model: 'invalid-fallback',
          tier: 'unknown',
          error: 'Model not found',
          suggestedAlternatives: []
        });

      const result = await validator.validateConfiguration(config);

      expect(result.isValid).toBe(true); // Fallback issues are warnings
      expect(result.issues.some(issue => issue.code === 'INVALID_FALLBACK_MODEL')).toBe(true);
    });

    it('should validate endpointing settings', async () => {
      const config: DeepgramConfigForValidation = {
        apiKey: 'test-api-key',
        model: 'nova',
        language: 'en',
        endpointing: 5000 // Too high
      };

      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue({
        tier: 'basic',
        availableModels: ['nova'],
        features: { realtime: true, batch: true, streaming: true },
        limits: { requestsPerMinute: 100, hoursPerMonth: 100 }
      });

      mockModelCompatibilityService.validateModelAccess.mockResolvedValue({
        isValid: true,
        model: 'nova',
        tier: 'basic',
        suggestedAlternatives: []
      });

      const result = await validator.validateConfiguration(config);

      expect(result.issues.some(issue => issue.code === 'INVALID_ENDPOINTING')).toBe(true);
    });

    it('should use cached results', async () => {
      const config: DeepgramConfigForValidation = {
        apiKey: 'test-api-key',
        model: 'nova',
        language: 'en'
      };

      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue({
        tier: 'basic',
        availableModels: ['nova'],
        features: { realtime: true, batch: true, streaming: true },
        limits: { requestsPerMinute: 100, hoursPerMonth: 100 }
      });

      mockModelCompatibilityService.validateModelAccess.mockResolvedValue({
        isValid: true,
        model: 'nova',
        tier: 'basic',
        suggestedAlternatives: []
      });

      // First call
      await validator.validateConfiguration(config);
      
      // Second call should use cache
      await validator.validateConfiguration(config);

      // Should only call the service once due to caching
      expect(mockModelCompatibilityService.getAccountCapabilities).toHaveBeenCalledTimes(1);
    });
  });

  describe('suggestOptimalConfiguration', () => {
    it('should suggest optimal configuration for general use case', async () => {
      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue({
        tier: 'basic',
        availableModels: ['nova', 'base'],
        features: { realtime: true, batch: true, streaming: true },
        limits: { requestsPerMinute: 100, hoursPerMonth: 100 }
      });

      mockModelCompatibilityService.selectBestModel.mockReturnValue('nova');

      const result = await validator.suggestOptimalConfiguration('test-api-key', {
        useCase: 'general',
        language: 'en'
      });

      expect(result.config.model).toBe('nova');
      expect(result.config.language).toBe('en');
      expect(result.config.autoFallback).toBe(true);
      expect(result.config.fallbackModels).toContain('base');
      expect(result.reasoning).toContain('Detected basic account tier with 2 available models');
    });

    it('should suggest meeting-specific configuration', async () => {
      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue({
        tier: 'premium',
        availableModels: ['nova-2', 'nova', 'base'],
        features: { realtime: true, batch: true, streaming: true },
        limits: { requestsPerMinute: 1000, hoursPerMonth: 1000 }
      });

      mockModelCompatibilityService.selectBestModel.mockReturnValue('nova-2');

      const result = await validator.suggestOptimalConfiguration('test-api-key', {
        useCase: 'meeting',
        language: 'en'
      });

      expect(result.config.diarize).toBe(true);
      expect(result.config.utteranceEndMs).toBe(1000);
      expect(result.reasoning).toContain('Enabled diarization and longer utterance timeout for meeting use case');
    });

    it('should suggest phone-specific configuration', async () => {
      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue({
        tier: 'basic',
        availableModels: ['nova', 'base'],
        features: { realtime: true, batch: true, streaming: true },
        limits: { requestsPerMinute: 100, hoursPerMonth: 100 }
      });

      mockModelCompatibilityService.selectBestModel.mockReturnValue('nova');

      const result = await validator.suggestOptimalConfiguration('test-api-key', {
        useCase: 'phone',
        language: 'en'
      });

      expect(result.config.endpointing).toBe(300);
      expect(result.reasoning).toContain('Configured shorter endpointing for phone call use case');
    });

    it('should prioritize accuracy when requested', async () => {
      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue({
        tier: 'premium',
        availableModels: ['nova-2', 'nova', 'base'],
        features: { realtime: true, batch: true, streaming: true },
        limits: { requestsPerMinute: 1000, hoursPerMonth: 1000 }
      });

      mockModelCompatibilityService.selectBestModel.mockReturnValue('nova-2');

      const result = await validator.suggestOptimalConfiguration('test-api-key', {
        prioritizeAccuracy: true
      });

      expect(result.reasoning).toContain('Prioritizing accuracy: selected Nova models for best transcription quality');
    });

    it('should add warnings for free tier limitations', async () => {
      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue({
        tier: 'free',
        availableModels: ['base'],
        features: { realtime: false, batch: true, streaming: true },
        limits: { requestsPerMinute: 10, hoursPerMonth: 12 }
      });

      mockModelCompatibilityService.selectBestModel.mockReturnValue('base');

      const result = await validator.suggestOptimalConfiguration('test-api-key');

      expect(result.warnings).toContain('Free tier has limited monthly hours and request rate limits');
      expect(result.warnings).toContain('Consider upgrading for production use');
    });
  });

  describe('testModelAccess', () => {
    it('should test model access successfully', async () => {
      mockModelCompatibilityService.validateModelAccess.mockResolvedValue({
        isValid: true,
        model: 'nova',
        tier: 'basic',
        suggestedAlternatives: []
      });

      const result = await validator.testModelAccess('test-api-key', 'nova');

      expect(result.model).toBe('nova');
      expect(result.isAccessible).toBe(true);
      expect(result.tier).toBe('basic');
      expect(result.responseTime).toBeGreaterThan(0);
      expect(result.features).toEqual(['realtime', 'batch', 'streaming']);
    });

    it('should handle model access failure', async () => {
      mockModelCompatibilityService.validateModelAccess.mockResolvedValue({
        isValid: false,
        model: 'nova-2',
        tier: 'premium',
        error: 'Insufficient permissions',
        suggestedAlternatives: ['nova']
      });

      const result = await validator.testModelAccess('test-api-key', 'nova-2');

      expect(result.model).toBe('nova-2');
      expect(result.isAccessible).toBe(false);
      expect(result.error).toBe('Insufficient permissions');
    });

    it('should handle validation service errors', async () => {
      mockModelCompatibilityService.validateModelAccess.mockRejectedValue(
        new Error('Network error')
      );

      const result = await validator.testModelAccess('test-api-key', 'nova');

      expect(result.model).toBe('nova');
      expect(result.isAccessible).toBe(false);
      expect(result.error).toBe('Network error');
    });
  });

  describe('batchTestModels', () => {
    it('should test multiple models in batches', async () => {
      const models = ['nova-2', 'nova', 'base'];

      mockModelCompatibilityService.validateModelAccess
        .mockResolvedValueOnce({
          isValid: true,
          model: 'nova-2',
          tier: 'premium',
          suggestedAlternatives: []
        })
        .mockResolvedValueOnce({
          isValid: true,
          model: 'nova',
          tier: 'basic',
          suggestedAlternatives: []
        })
        .mockResolvedValueOnce({
          isValid: true,
          model: 'base',
          tier: 'free',
          suggestedAlternatives: []
        });

      const results = await validator.batchTestModels('test-api-key', models);

      expect(results.size).toBe(3);
      expect(results.get('nova-2')?.isAccessible).toBe(true);
      expect(results.get('nova')?.isAccessible).toBe(true);
      expect(results.get('base')?.isAccessible).toBe(true);
    });

    it('should handle mixed success and failure results', async () => {
      const models = ['nova', 'invalid-model'];

      mockModelCompatibilityService.validateModelAccess
        .mockResolvedValueOnce({
          isValid: true,
          model: 'nova',
          tier: 'basic',
          suggestedAlternatives: []
        })
        .mockResolvedValueOnce({
          isValid: false,
          model: 'invalid-model',
          tier: 'unknown',
          error: 'Model not found',
          suggestedAlternatives: []
        });

      const results = await validator.batchTestModels('test-api-key', models);

      expect(results.size).toBe(2);
      expect(results.get('nova')?.isAccessible).toBe(true);
      expect(results.get('invalid-model')?.isAccessible).toBe(false);
    });
  });

  describe('clearCache', () => {
    it('should clear validation cache', () => {
      validator.clearCache();
      // No assertion needed, just ensure it doesn't throw
    });
  });
});
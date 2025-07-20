import { 
  DeepgramValidationService,
  initializeDeepgramValidationService,
  getDeepgramValidationService
} from '../deepgramValidationService';
import { 
  ModelCompatibilityService,
  initializeModelCompatibilityService
} from '../modelCompatibilityService';
import { DeepgramConfigValidator } from '../../utils/deepgramConfigValidator';
import Configuration from '../../models/Configuration';
import { EnhancedDeepgramConfig, DeepgramAccountTier } from '../../types/deepgram';

// Mock dependencies
jest.mock('../modelCompatibilityService');
jest.mock('../../utils/deepgramConfigValidator');
jest.mock('../../models/Configuration');
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

const mockInitializeModelCompatibilityService = initializeModelCompatibilityService as jest.MockedFunction<typeof initializeModelCompatibilityService>;
const mockDeepgramConfigValidator = DeepgramConfigValidator as jest.Mocked<typeof DeepgramConfigValidator>;
const mockConfiguration = Configuration as jest.Mocked<typeof Configuration>;

describe('DeepgramValidationService', () => {
  let service: DeepgramValidationService;
  let mockModelCompatibilityService: jest.Mocked<ModelCompatibilityService>;
  let mockConfig: any;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock model compatibility service
    mockModelCompatibilityService = {
      validateModelAccess: jest.fn(),
      getCompatibleModels: jest.fn(),
      selectBestModel: jest.fn(),
      getAccountCapabilities: jest.fn(),
      clearCache: jest.fn(),
      updateApiKey: jest.fn(),
      handleModelFallback: jest.fn(),
      getModelRegistry: jest.fn()
    } as any;

    mockInitializeModelCompatibilityService.mockReturnValue(mockModelCompatibilityService);
    
    // Set up default mock returns
    mockModelCompatibilityService.validateModelAccess.mockResolvedValue({
      isValid: true,
      model: 'nova-2',
      tier: 'premium' as DeepgramAccountTier,
      suggestedAlternatives: []
    });
    
    mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue({
      tier: 'premium' as DeepgramAccountTier,
      availableModels: ['nova-2', 'nova', 'base'],
      features: { realtime: true, batch: true, streaming: true },
      limits: { requestsPerMinute: 1000, hoursPerMonth: 1000 }
    });
    
    mockModelCompatibilityService.getCompatibleModels.mockResolvedValue(['nova-2', 'nova', 'base']);
    mockModelCompatibilityService.selectBestModel.mockReturnValue('nova-2');

    // Create mock configuration
    mockConfig = {
      deepgramConfig: {
        modelCompatibilityStatus: {},
        lastModelValidation: null,
        accountTier: null,
        availableModels: []
      },
      save: jest.fn().mockResolvedValue(true)
    };

    mockConfiguration.findOne.mockResolvedValue(mockConfig);

    // Set up default validator mock
    mockDeepgramConfigValidator.validateConfiguration.mockReturnValue({
      isValid: true,
      issues: [],
      recommendations: []
    });

    // Initialize service
    service = initializeDeepgramValidationService();
  });

  describe('initialization', () => {
    it('should initialize successfully with API key', async () => {
      await service.initialize('test-api-key');
      
      expect(mockInitializeModelCompatibilityService).toHaveBeenCalledWith('test-api-key');
    });

    it('should handle initialization errors', async () => {
      mockInitializeModelCompatibilityService.mockImplementation(() => {
        throw new Error('Initialization failed');
      });

      await expect(service.initialize('invalid-key')).rejects.toThrow('Initialization failed');
    });
  });

  describe('validateModelAccess', () => {
    beforeEach(async () => {
      // Service will auto-initialize when needed
    });

    it('should validate model access successfully', async () => {
      const mockResult = {
        isValid: true,
        model: 'nova-2',
        tier: 'premium' as DeepgramAccountTier,
        suggestedAlternatives: []
      };

      mockModelCompatibilityService.validateModelAccess.mockResolvedValue(mockResult);

      const result = await service.validateModelAccess('test-api-key', 'nova-2');

      expect(result).toEqual(mockResult);
      expect(mockModelCompatibilityService.validateModelAccess).toHaveBeenCalledWith('test-api-key', 'nova-2');
    });

    it('should cache validation results', async () => {
      const mockResult = {
        isValid: true,
        model: 'nova-2',
        tier: 'premium' as DeepgramAccountTier,
        suggestedAlternatives: []
      };

      mockModelCompatibilityService.validateModelAccess.mockResolvedValue(mockResult);

      // First call
      await service.validateModelAccess('test-api-key', 'nova-2');
      
      // Second call should use cache
      await service.validateModelAccess('test-api-key', 'nova-2');

      // Service should only be called once
      expect(mockModelCompatibilityService.validateModelAccess).toHaveBeenCalledTimes(1);
    });

    it('should update configuration with validation status', async () => {
      const mockResult = {
        isValid: false,
        model: 'nova-2',
        tier: 'premium' as DeepgramAccountTier,
        error: 'Insufficient permissions',
        suggestedAlternatives: ['nova', 'base']
      };

      mockModelCompatibilityService.validateModelAccess.mockResolvedValue(mockResult);

      await service.validateModelAccess('test-api-key', 'nova-2');

      expect(mockConfig.save).toHaveBeenCalled();
      expect(mockConfig.deepgramConfig.modelCompatibilityStatus['nova-2']).toEqual({
        isCompatible: false,
        lastTested: expect.any(Date),
        error: 'Insufficient permissions'
      });
    });
  });

  describe('detectAccountTier', () => {
    beforeEach(async () => {
      // Service will auto-initialize when needed
    });

    it('should detect account tier successfully', async () => {
      const mockCapabilities = {
        tier: 'premium' as DeepgramAccountTier,
        availableModels: ['nova-2', 'nova', 'base'],
        features: {
          realtime: true,
          batch: true,
          streaming: true
        },
        limits: {
          requestsPerMinute: 1000,
          hoursPerMonth: 1000
        }
      };

      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue(mockCapabilities);

      const result = await service.detectAccountTier('test-api-key');

      expect(result.tier).toBe('premium');
      expect(result.availableModels).toEqual(['nova-2', 'nova', 'base']);
      expect(result.capabilities).toEqual(mockCapabilities);
      expect(result.detectedAt).toBeInstanceOf(Date);
    });

    it('should cache account tier detection results', async () => {
      const mockCapabilities = {
        tier: 'premium' as DeepgramAccountTier,
        availableModels: ['nova-2', 'nova', 'base'],
        features: { realtime: true, batch: true, streaming: true },
        limits: { requestsPerMinute: 1000, hoursPerMonth: 1000 }
      };

      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue(mockCapabilities);

      // First call
      await service.detectAccountTier('test-api-key');
      
      // Second call should use cache
      await service.detectAccountTier('test-api-key');

      // Service should only be called once
      expect(mockModelCompatibilityService.getAccountCapabilities).toHaveBeenCalledTimes(1);
    });

    it('should update configuration with detected tier', async () => {
      const mockCapabilities = {
        tier: 'basic' as DeepgramAccountTier,
        availableModels: ['nova', 'base'],
        features: { realtime: false, batch: true, streaming: true },
        limits: { requestsPerMinute: 100, hoursPerMonth: 100 }
      };

      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue(mockCapabilities);

      await service.detectAccountTier('test-api-key');

      expect(mockConfig.deepgramConfig.accountTier).toBe('basic');
      expect(mockConfig.deepgramConfig.availableModels).toEqual(['nova', 'base']);
      expect(mockConfig.save).toHaveBeenCalled();
    });
  });

  describe('validateConfiguration', () => {
    beforeEach(async () => {
      // Service will auto-initialize when needed
    });

    it('should validate configuration structure first', async () => {
      const mockConfig: EnhancedDeepgramConfig = {
        apiKey: 'test-key',
        isEnabled: true,
        primaryModel: 'nova-2',
        fallbackModels: ['nova', 'base'],
        autoFallback: true,
        tier: 'enhanced',
        retryAttempts: 3,
        timeoutMs: 30000
      };

      const mockStructuralValidation = {
        isValid: true,
        issues: [],
        recommendations: []
      };

      mockDeepgramConfigValidator.validateConfiguration.mockReturnValue(mockStructuralValidation);

      const mockModelValidation = {
        isValid: true,
        model: 'nova-2',
        tier: 'premium' as DeepgramAccountTier,
        suggestedAlternatives: []
      };

      mockModelCompatibilityService.validateModelAccess.mockResolvedValue(mockModelValidation);

      const mockTierResult = {
        tier: 'premium' as DeepgramAccountTier,
        availableModels: ['nova-2', 'nova', 'base'],
        capabilities: {
          tier: 'premium' as DeepgramAccountTier,
          availableModels: ['nova-2', 'nova', 'base'],
          features: { realtime: true, batch: true, streaming: true },
          limits: { requestsPerMinute: 1000, hoursPerMonth: 1000 }
        },
        detectedAt: new Date()
      };

      mockModelCompatibilityService.getAccountCapabilities.mockResolvedValue(mockTierResult.capabilities);

      const result = await service.validateConfiguration(mockConfig);

      expect(mockDeepgramConfigValidator.validateConfiguration).toHaveBeenCalledWith(mockConfig);
      expect(result.isValid).toBe(true);
    });

    it('should return structural validation errors without API testing', async () => {
      const mockConfig: EnhancedDeepgramConfig = {
        apiKey: '',
        isEnabled: true,
        primaryModel: '',
        fallbackModels: [],
        autoFallback: true,
        tier: 'enhanced',
        retryAttempts: 3,
        timeoutMs: 30000
      };

      const mockStructuralValidation = {
        isValid: false,
        issues: [{
          type: 'error' as const,
          field: 'apiKey',
          message: 'API key is required',
          suggestedFix: 'Provide a valid API key'
        }],
        recommendations: []
      };

      mockDeepgramConfigValidator.validateConfiguration.mockReturnValue(mockStructuralValidation);

      const result = await service.validateConfiguration(mockConfig);

      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(mockModelCompatibilityService.validateModelAccess).not.toHaveBeenCalled();
    });

    it('should add model validation errors to structural validation', async () => {
      const mockConfig: EnhancedDeepgramConfig = {
        apiKey: 'test-key',
        isEnabled: true,
        primaryModel: 'nova-2',
        fallbackModels: ['nova', 'base'],
        autoFallback: true,
        tier: 'enhanced',
        retryAttempts: 3,
        timeoutMs: 30000
      };

      const mockStructuralValidation = {
        isValid: true,
        issues: [],
        recommendations: []
      };

      mockDeepgramConfigValidator.validateConfiguration.mockReturnValue(mockStructuralValidation);

      const mockModelValidation = {
        isValid: false,
        model: 'nova-2',
        tier: 'premium' as DeepgramAccountTier,
        error: 'Insufficient permissions',
        suggestedAlternatives: ['nova', 'base']
      };

      mockModelCompatibilityService.validateModelAccess.mockResolvedValue(mockModelValidation);

      const result = await service.validateConfiguration(mockConfig);

      expect(result.isValid).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].field).toBe('primaryModel');
      expect(result.issues[0].message).toContain('nova-2 is not accessible');
    });
  });

  describe('getOptimalModel', () => {
    beforeEach(async () => {
      // Service will auto-initialize when needed
    });

    it('should return optimal model based on preferences', async () => {
      const mockCompatibleModels = ['nova-2', 'nova', 'base'];
      const mockPreferences = {
        preferredModels: ['nova-2'],
        useCase: 'general' as const,
        language: 'en',
        realtime: true
      };

      mockModelCompatibilityService.getCompatibleModels.mockResolvedValue(mockCompatibleModels);
      mockModelCompatibilityService.selectBestModel.mockReturnValue('nova-2');

      const result = await service.getOptimalModel('test-api-key', mockPreferences);

      expect(result).toBe('nova-2');
      expect(mockModelCompatibilityService.getCompatibleModels).toHaveBeenCalledWith('test-api-key');
      expect(mockModelCompatibilityService.selectBestModel).toHaveBeenCalledWith(mockCompatibleModels, mockPreferences);
    });

    it('should return base fallback when no compatible models found', async () => {
      mockModelCompatibilityService.getCompatibleModels.mockResolvedValue([]);

      const result = await service.getOptimalModel('test-api-key', {
        preferredModels: ['nova-2'],
        useCase: 'general',
        language: 'en',
        realtime: true
      });

      expect(result).toBe('base');
    });

    it('should return base fallback on error', async () => {
      mockModelCompatibilityService.getCompatibleModels.mockRejectedValue(new Error('API error'));

      const result = await service.getOptimalModel('test-api-key', {
        preferredModels: ['nova-2'],
        useCase: 'general',
        language: 'en',
        realtime: true
      });

      expect(result).toBe('base');
    });
  });

  describe('batchValidateModels', () => {
    beforeEach(async () => {
      // Service will auto-initialize when needed
    });

    it('should validate multiple models in batches', async () => {
      const models = ['nova-2', 'nova', 'base'];
      const mockResults = [
        { isValid: true, model: 'nova-2', tier: 'premium' as DeepgramAccountTier, suggestedAlternatives: [] },
        { isValid: true, model: 'nova', tier: 'basic' as DeepgramAccountTier, suggestedAlternatives: [] },
        { isValid: true, model: 'base', tier: 'free' as DeepgramAccountTier, suggestedAlternatives: [] }
      ];

      // Mock each call to return the correct result for each model
      mockModelCompatibilityService.validateModelAccess
        .mockImplementation(async (apiKey: string, model: string) => {
          const result = mockResults.find(r => r.model === model);
          return result || mockResults[0];
        });

      const results = await service.batchValidateModels('test-api-key', models);

      expect(results.size).toBe(3);
      expect(results.get('nova-2')).toEqual(mockResults[0]);
      expect(results.get('nova')).toEqual(mockResults[1]);
      expect(results.get('base')).toEqual(mockResults[2]);
    });

    it('should handle individual model validation failures', async () => {
      const models = ['nova-2', 'invalid-model'];

      mockModelCompatibilityService.validateModelAccess
        .mockImplementation(async (apiKey: string, model: string) => {
          if (model === 'nova-2') {
            return { isValid: true, model: 'nova-2', tier: 'premium' as DeepgramAccountTier, suggestedAlternatives: [] };
          } else {
            throw new Error('Model not found');
          }
        });

      const results = await service.batchValidateModels('test-api-key', models);

      expect(results.size).toBe(2);
      expect(results.get('nova-2')?.isValid).toBe(true);
      expect(results.get('invalid-model')?.isValid).toBe(false);
      expect(results.get('invalid-model')?.error).toBe('Model not found');
    });
  });

  describe('cache management', () => {
    it('should clear all caches', async () => {
      // Initialize service first
      await service.initialize('test-api-key');
      
      service.clearCache();

      expect(mockModelCompatibilityService.clearCache).toHaveBeenCalled();
    });

    it('should return cache statistics', () => {
      const stats = service.getCacheStats();

      expect(stats).toHaveProperty('validationCache');
      expect(stats).toHaveProperty('accountTierCache');
      expect(typeof stats.validationCache).toBe('number');
      expect(typeof stats.accountTierCache).toBe('number');
    });
  });

  describe('singleton pattern', () => {
    it('should return same instance', () => {
      const instance1 = initializeDeepgramValidationService();
      const instance2 = getDeepgramValidationService();

      expect(instance1).toBe(instance2);
    });
  });
});
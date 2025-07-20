import { Request, Response } from 'express';
import mongoose from 'mongoose';
import {
  testModelCompatibility,
  getAvailableModels,
  batchTestModels,
  getModelRegistry,
  updateModelConfiguration,
  suggestOptimalConfiguration
} from '../../controllers/modelManagementController';
import { ModelCompatibilityService, initializeModelCompatibilityService } from '../modelCompatibilityService';
import { DeepgramConfigValidator, getDeepgramConfigValidator } from '../deepgramConfigValidator';
import Configuration from '../../models/Configuration';

// Mock dependencies
jest.mock('../modelCompatibilityService', () => {
  const originalModule = jest.requireActual('../modelCompatibilityService');
  return {
    ...originalModule,
    getModelCompatibilityService: jest.fn(),
    initializeModelCompatibilityService: jest.fn()
  };
});

jest.mock('../deepgramConfigValidator', () => {
  return {
    getDeepgramConfigValidator: jest.fn(),
    initializeDeepgramConfigValidator: jest.fn()
  };
});

jest.mock('../../models/Configuration');

describe('Model Management Controller', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockModelService: Partial<ModelCompatibilityService>;
  let mockConfigValidator: Partial<DeepgramConfigValidator>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();

    // Mock request and response
    mockRequest = {
      body: {},
      params: {}
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn()
    };

    // Mock model compatibility service
    mockModelService = {
      validateModelAccess: jest.fn(),
      getCompatibleModels: jest.fn(),
      selectBestModel: jest.fn(),
      handleModelFallback: jest.fn(),
      getAccountCapabilities: jest.fn(),
      getModelRegistry: jest.fn(),
      updateApiKey: jest.fn(),
      clearCache: jest.fn()
    };

    // Mock config validator
    mockConfigValidator = {
      validateConfiguration: jest.fn(),
      suggestOptimalConfiguration: jest.fn(),
      testModelAccess: jest.fn(),
      batchTestModels: jest.fn(),
      clearCache: jest.fn()
    };

    // Set up mock implementations
    (getDeepgramConfigValidator as jest.Mock).mockReturnValue(mockConfigValidator);
    (initializeModelCompatibilityService as jest.Mock).mockReturnValue(mockModelService);
    (getModelCompatibilityService as jest.Mock).mockReturnValue(mockModelService);
  });

  describe('testModelCompatibility', () => {
    it('should return 400 if apiKey or model is missing', async () => {
      await testModelCompatibility(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'API key and model name are required'
      });
    });

    it('should test model compatibility and return result', async () => {
      // Mock request with required data
      mockRequest.body = {
        apiKey: 'test-api-key',
        model: 'nova-2'
      };

      // Mock test result
      const mockTestResult = {
        model: 'nova-2',
        isAccessible: true,
        responseTime: 150,
        tier: 'premium',
        features: ['realtime', 'streaming']
      };

      (mockConfigValidator.testModelAccess as jest.Mock).mockResolvedValue(mockTestResult);

      await testModelCompatibility(mockRequest as Request, mockResponse as Response);

      expect(mockConfigValidator.testModelAccess).toHaveBeenCalledWith('test-api-key', 'nova-2');
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        result: mockTestResult
      });
    });

    it('should handle errors and return 500', async () => {
      // Mock request with required data
      mockRequest.body = {
        apiKey: 'test-api-key',
        model: 'nova-2'
      };

      // Mock error
      (mockConfigValidator.testModelAccess as jest.Mock).mockRejectedValue(new Error('Test error'));

      await testModelCompatibility(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to test model compatibility',
        error: 'Test error'
      });
    });
  });

  describe('getAvailableModels', () => {
    it('should return 400 if Deepgram API key is not configured', async () => {
      // Mock Configuration.findOne to return null
      (Configuration.findOne as jest.Mock).mockResolvedValue(null);

      await getAvailableModels(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Deepgram API key not configured'
      });
    });

    it('should return account capabilities', async () => {
      // Mock Configuration.findOne to return config with API key
      (Configuration.findOne as jest.Mock).mockResolvedValue({
        deepgramConfig: {
          apiKey: 'test-api-key'
        }
      });

      // Mock account capabilities
      const mockCapabilities = {
        tier: 'premium',
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

      (mockModelService.getAccountCapabilities as jest.Mock).mockResolvedValue(mockCapabilities);

      await getAvailableModels(mockRequest as Request, mockResponse as Response);

      expect(mockModelService.getAccountCapabilities).toHaveBeenCalledWith('test-api-key');
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        tier: 'premium',
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
      });
    });

    it('should handle errors and return 500', async () => {
      // Mock Configuration.findOne to return config with API key
      (Configuration.findOne as jest.Mock).mockResolvedValue({
        deepgramConfig: {
          apiKey: 'test-api-key'
        }
      });

      // Mock error
      (mockModelService.getAccountCapabilities as jest.Mock).mockRejectedValue(new Error('Test error'));

      await getAvailableModels(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to get available models',
        error: 'Test error'
      });
    });
  });

  describe('batchTestModels', () => {
    it('should return 400 if apiKey or models array is missing', async () => {
      await batchTestModels(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'API key and array of models are required'
      });
    });

    it('should batch test models and return results', async () => {
      // Mock request with required data
      mockRequest.body = {
        apiKey: 'test-api-key',
        models: ['nova-2', 'nova', 'base']
      };

      // Mock test results
      const mockTestResults = new Map([
        ['nova-2', { model: 'nova-2', isAccessible: true, responseTime: 150 }],
        ['nova', { model: 'nova', isAccessible: true, responseTime: 120 }],
        ['base', { model: 'base', isAccessible: true, responseTime: 100 }]
      ]);

      (mockConfigValidator.batchTestModels as jest.Mock).mockResolvedValue(mockTestResults);

      await batchTestModels(mockRequest as Request, mockResponse as Response);

      expect(mockConfigValidator.batchTestModels).toHaveBeenCalledWith('test-api-key', ['nova-2', 'nova', 'base']);
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        results: [
          { model: 'nova-2', isAccessible: true, responseTime: 150 },
          { model: 'nova', isAccessible: true, responseTime: 120 },
          { model: 'base', isAccessible: true, responseTime: 100 }
        ]
      });
    });

    it('should handle errors and return 500', async () => {
      // Mock request with required data
      mockRequest.body = {
        apiKey: 'test-api-key',
        models: ['nova-2', 'nova', 'base']
      };

      // Mock error
      (mockConfigValidator.batchTestModels as jest.Mock).mockRejectedValue(new Error('Test error'));

      await batchTestModels(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to batch test models',
        error: 'Test error'
      });
    });
  });

  describe('getModelRegistry', () => {
    it('should return 400 if Deepgram API key is not configured', async () => {
      // Mock Configuration.findOne to return null
      (Configuration.findOne as jest.Mock).mockResolvedValue(null);

      await getModelRegistry(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Deepgram API key not configured'
      });
    });

    it('should return model registry', async () => {
      // Mock Configuration.findOne to return config with API key
      (Configuration.findOne as jest.Mock).mockResolvedValue({
        deepgramConfig: {
          apiKey: 'test-api-key'
        }
      });

      // Mock model registry
      const mockRegistry = {
        models: {
          'nova-2': {
            name: 'nova-2',
            tier: 'premium',
            features: ['realtime', 'streaming'],
            useCases: ['general', 'meeting', 'phone'],
            languages: ['en', 'es', 'fr']
          },
          'nova': {
            name: 'nova',
            tier: 'basic',
            features: ['realtime', 'streaming'],
            useCases: ['general', 'meeting', 'phone'],
            languages: ['en', 'es']
          }
        }
      };

      (mockModelService.getModelRegistry as jest.Mock).mockReturnValue(mockRegistry);

      await getModelRegistry(mockRequest as Request, mockResponse as Response);

      expect(mockModelService.getModelRegistry).toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        registry: mockRegistry
      });
    });

    it('should handle errors and return 500', async () => {
      // Mock Configuration.findOne to return config with API key
      (Configuration.findOne as jest.Mock).mockResolvedValue({
        deepgramConfig: {
          apiKey: 'test-api-key'
        }
      });

      // Mock error
      (mockModelService.getModelRegistry as jest.Mock).mockImplementation(() => {
        throw new Error('Test error');
      });

      await getModelRegistry(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to get model registry',
        error: 'Test error'
      });
    });
  });

  describe('updateModelConfiguration', () => {
    it('should return 404 if configuration is not found', async () => {
      // Mock Configuration.findOne to return null
      (Configuration.findOne as jest.Mock).mockResolvedValue(null);

      await updateModelConfiguration(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(404);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Configuration not found'
      });
    });

    it('should return 400 if Deepgram API key is not configured', async () => {
      // Mock Configuration.findOne to return config without API key
      (Configuration.findOne as jest.Mock).mockResolvedValue({
        deepgramConfig: {}
      });

      await updateModelConfiguration(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Deepgram API key not configured'
      });
    });

    it('should update model configuration and return success', async () => {
      // Mock request with model configuration
      mockRequest.body = {
        model: 'nova-2',
        fallbackModels: ['nova', 'base'],
        autoFallback: true
      };

      // Mock Configuration.findOne to return config with API key
      const mockConfig = {
        deepgramConfig: {
          apiKey: 'test-api-key',
          model: 'base',
          fallbackModels: [],
          autoFallback: false
        },
        save: jest.fn().mockResolvedValue(true)
      };
      
      (Configuration.findOne as jest.Mock).mockResolvedValue(mockConfig);

      // Mock model test results
      (mockConfigValidator.testModelAccess as jest.Mock).mockResolvedValueOnce({
        model: 'nova-2',
        isAccessible: true
      });
      
      // Mock fallback model tests
      (mockConfigValidator.testModelAccess as jest.Mock).mockResolvedValueOnce({
        model: 'nova',
        isAccessible: true
      });
      
      (mockConfigValidator.testModelAccess as jest.Mock).mockResolvedValueOnce({
        model: 'base',
        isAccessible: true
      });

      await updateModelConfiguration(mockRequest as Request, mockResponse as Response);

      expect(mockConfigValidator.testModelAccess).toHaveBeenCalledWith('test-api-key', 'nova-2');
      expect(mockConfig.save).toHaveBeenCalled();
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        message: 'Model configuration updated successfully',
        config: {
          model: 'nova-2',
          fallbackModels: ['nova', 'base'],
          autoFallback: true,
          status: 'verified',
          lastModelValidation: expect.any(Date)
        }
      });
    });

    it('should return 400 if primary model is not accessible', async () => {
      // Mock request with model configuration
      mockRequest.body = {
        model: 'nova-2'
      };

      // Mock Configuration.findOne to return config with API key
      (Configuration.findOne as jest.Mock).mockResolvedValue({
        deepgramConfig: {
          apiKey: 'test-api-key'
        }
      });

      // Mock model test result - not accessible
      (mockConfigValidator.testModelAccess as jest.Mock).mockResolvedValue({
        model: 'nova-2',
        isAccessible: false,
        error: 'Permission denied'
      });

      await updateModelConfiguration(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: "Primary model 'nova-2' is not accessible",
        error: 'Permission denied'
      });
    });

    it('should handle errors and return 500', async () => {
      // Mock request with model configuration
      mockRequest.body = {
        model: 'nova-2'
      };

      // Mock Configuration.findOne to return config with API key
      (Configuration.findOne as jest.Mock).mockResolvedValue({
        deepgramConfig: {
          apiKey: 'test-api-key'
        }
      });

      // Mock error
      (mockConfigValidator.testModelAccess as jest.Mock).mockRejectedValue(new Error('Test error'));

      await updateModelConfiguration(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to update model configuration',
        error: 'Test error'
      });
    });
  });

  describe('suggestOptimalConfiguration', () => {
    it('should return 400 if API key is missing', async () => {
      await suggestOptimalConfiguration(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'API key is required'
      });
    });

    it('should suggest optimal configuration and return result', async () => {
      // Mock request with required data
      mockRequest.body = {
        apiKey: 'test-api-key',
        preferences: {
          useCase: 'phone',
          language: 'en',
          prioritizeAccuracy: true
        }
      };

      // Mock suggestion result
      const mockSuggestion = {
        config: {
          model: 'nova-2',
          fallbackModels: ['nova', 'base'],
          autoFallback: true
        },
        reasoning: ['Selected nova-2 for best accuracy'],
        warnings: []
      };

      (mockConfigValidator.suggestOptimalConfiguration as jest.Mock).mockResolvedValue(mockSuggestion);

      await suggestOptimalConfiguration(mockRequest as Request, mockResponse as Response);

      expect(mockConfigValidator.suggestOptimalConfiguration).toHaveBeenCalledWith(
        'test-api-key',
        {
          useCase: 'phone',
          language: 'en',
          prioritizeAccuracy: true
        }
      );
      
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        suggestion: mockSuggestion
      });
    });

    it('should handle errors and return 500', async () => {
      // Mock request with required data
      mockRequest.body = {
        apiKey: 'test-api-key'
      };

      // Mock error
      (mockConfigValidator.suggestOptimalConfiguration as jest.Mock).mockRejectedValue(new Error('Test error'));

      await suggestOptimalConfiguration(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Failed to suggest optimal configuration',
        error: 'Test error'
      });
    });
  });
});
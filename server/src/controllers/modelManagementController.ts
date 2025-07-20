import { Request, Response } from 'express';
import { 
  ModelCompatibilityService, 
  getModelCompatibilityService,
  initializeModelCompatibilityService,
  AccountCapabilities,
  ModelValidationResult,
  ModelPreferences
} from '../services/modelCompatibilityService';
import {
  DeepgramConfigValidator,
  getDeepgramConfigValidator,
  ConfigValidationResult,
  ModelTestResult,
  OptimalConfigResult
} from '../services/deepgramConfigValidator';
import Configuration from '../models/Configuration';
import logger from '../utils/logger';
import { getErrorMessage } from '../utils/logger';

/**
 * @desc    Test model compatibility for a specific model
 * @route   POST /api/configuration/models/test
 * @access  Private
 */
export const testModelCompatibility = async (req: Request, res: Response) => {
  try {
    const { apiKey, model } = req.body;

    if (!apiKey || !model) {
      return res.status(400).json({
        success: false,
        message: 'API key and model name are required'
      });
    }

    logger.info(`Testing model compatibility for ${model}`);
    
    // Get or initialize the config validator
    const configValidator = getDeepgramConfigValidator();
    
    // Test model access
    const testResult = await configValidator.testModelAccess(apiKey, model);
    
    return res.status(200).json({
      success: true,
      result: testResult
    });
  } catch (error) {
    logger.error(`Error testing model compatibility: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to test model compatibility',
      error: getErrorMessage(error)
    });
  }
};

/**
 * @desc    Get available models for the account
 * @route   GET /api/configuration/models/available
 * @access  Private
 */
export const getAvailableModels = async (req: Request, res: Response) => {
  try {
    // Get current configuration
    const config = await Configuration.findOne();
    
    if (!config || !config.deepgramConfig || !config.deepgramConfig.apiKey) {
      return res.status(400).json({
        success: false,
        message: 'Deepgram API key not configured'
      });
    }
    
    const apiKey = config.deepgramConfig.apiKey;
    
    // Get or initialize the model compatibility service
    let modelService = getModelCompatibilityService();
    if (!modelService) {
      modelService = initializeModelCompatibilityService(apiKey);
    }
    
    // Get account capabilities
    const capabilities = await modelService.getAccountCapabilities(apiKey);
    
    return res.status(200).json({
      success: true,
      tier: capabilities.tier,
      availableModels: capabilities.availableModels,
      features: capabilities.features,
      limits: capabilities.limits
    });
  } catch (error) {
    logger.error(`Error getting available models: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to get available models',
      error: getErrorMessage(error)
    });
  }
};

/**
 * @desc    Batch test multiple models
 * @route   POST /api/configuration/models/batch-test
 * @access  Private
 */
export const batchTestModels = async (req: Request, res: Response) => {
  try {
    const { apiKey, models } = req.body;

    if (!apiKey || !models || !Array.isArray(models)) {
      return res.status(400).json({
        success: false,
        message: 'API key and array of models are required'
      });
    }

    logger.info(`Batch testing ${models.length} models`);
    
    // Get or initialize the config validator
    const configValidator = getDeepgramConfigValidator();
    
    // Batch test models
    const testResults = await configValidator.batchTestModels(apiKey, models);
    
    // Convert Map to array for JSON response
    const resultsArray = Array.from(testResults.entries()).map(([model, result]) => ({
      model,
      ...result
    }));
    
    return res.status(200).json({
      success: true,
      results: resultsArray
    });
  } catch (error) {
    logger.error(`Error batch testing models: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to batch test models',
      error: getErrorMessage(error)
    });
  }
};

/**
 * @desc    Get model registry information
 * @route   GET /api/configuration/models/registry
 * @access  Private
 */
export const getModelRegistry = async (_req: Request, res: Response) => {
  try {
    // Get current configuration
    const config = await Configuration.findOne();
    
    if (!config || !config.deepgramConfig || !config.deepgramConfig.apiKey) {
      return res.status(400).json({
        success: false,
        message: 'Deepgram API key not configured'
      });
    }
    
    const apiKey = config.deepgramConfig.apiKey;
    
    // Get or initialize the model compatibility service
    let modelService = getModelCompatibilityService();
    if (!modelService) {
      modelService = initializeModelCompatibilityService(apiKey);
    }
    
    // Get model registry
    const registry = modelService.getModelRegistry();
    
    return res.status(200).json({
      success: true,
      registry
    });
  } catch (error) {
    logger.error(`Error getting model registry: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to get model registry',
      error: getErrorMessage(error)
    });
  }
};

/**
 * @desc    Update configuration with validated model settings
 * @route   PUT /api/configuration/models/update
 * @access  Private
 */
export const updateModelConfiguration = async (req: Request, res: Response) => {
  try {
    const { model, fallbackModels, autoFallback } = req.body;
    
    // Get current configuration
    const config = await Configuration.findOne();
    
    if (!config) {
      return res.status(404).json({
        success: false,
        message: 'Configuration not found'
      });
    }
    
    if (!config.deepgramConfig || !config.deepgramConfig.apiKey) {
      return res.status(400).json({
        success: false,
        message: 'Deepgram API key not configured'
      });
    }
    
    const apiKey = config.deepgramConfig.apiKey;
    
    // Get or initialize the config validator
    const configValidator = getDeepgramConfigValidator();
    
    // Validate the primary model if provided
    if (model) {
      const modelTest = await configValidator.testModelAccess(apiKey, model);
      
      if (!modelTest.isAccessible) {
        return res.status(400).json({
          success: false,
          message: `Primary model '${model}' is not accessible`,
          error: modelTest.error
        });
      }
      
      // Update primary model
      config.deepgramConfig.primaryModel = model;
    }
    
    // Update fallback models if provided
    if (fallbackModels && Array.isArray(fallbackModels)) {
      // Test each fallback model
      const fallbackResults = await Promise.all(
        fallbackModels.map(fallbackModel => configValidator.testModelAccess(apiKey, fallbackModel))
      );
      
      // Filter out inaccessible models
      const accessibleFallbacks = fallbackModels.filter(
        (_, index) => fallbackResults[index].isAccessible
      );
      
      // Update fallback models
      config.deepgramConfig.fallbackModels = accessibleFallbacks;
      
      // Warn if some models were filtered out
      if (accessibleFallbacks.length < fallbackModels.length) {
        logger.warn(`Some fallback models were not accessible and were removed`);
      }
    }
    
    // Update auto fallback setting if provided
    if (autoFallback !== undefined) {
      config.deepgramConfig.autoFallback = autoFallback;
    }
    
    // Update last validation timestamp
    config.deepgramConfig.lastModelValidation = new Date();
    config.deepgramConfig.status = 'verified';
    
    // Save configuration
    await config.save();
    
    return res.status(200).json({
      success: true,
      message: 'Model configuration updated successfully',
      config: {
        model: config.deepgramConfig.primaryModel,
        fallbackModels: config.deepgramConfig.fallbackModels,
        autoFallback: config.deepgramConfig.autoFallback,
        status: config.deepgramConfig.status,
        lastModelValidation: config.deepgramConfig.lastModelValidation
      }
    });
  } catch (error) {
    logger.error(`Error updating model configuration: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to update model configuration',
      error: getErrorMessage(error)
    });
  }
};

/**
 * @desc    Get optimal configuration suggestion
 * @route   POST /api/configuration/models/suggest-optimal
 * @access  Private
 */
export const suggestOptimalConfiguration = async (req: Request, res: Response) => {
  try {
    const { apiKey, preferences } = req.body;
    
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        message: 'API key is required'
      });
    }
    
    // Get or initialize the config validator
    const configValidator = getDeepgramConfigValidator();
    
    // Get optimal configuration suggestion
    const suggestion = await configValidator.suggestOptimalConfiguration(apiKey, preferences);
    
    return res.status(200).json({
      success: true,
      suggestion
    });
  } catch (error) {
    logger.error(`Error suggesting optimal configuration: ${getErrorMessage(error)}`);
    return res.status(500).json({
      success: false,
      message: 'Failed to suggest optimal configuration',
      error: getErrorMessage(error)
    });
  }
};
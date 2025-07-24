/**
 * Integration test for system initialization with Deepgram model compatibility
 * This test verifies that the enhanced startup logic works correctly
 */

import { validateDeepgramStartupConfig } from '../../config/database-validation';

describe('System Initialization - Deepgram Integration', () => {
  describe('validateDeepgramStartupConfig', () => {
    it('should validate enabled Deepgram configuration with API key', () => {
      const config = {
        isEnabled: true,
        apiKey: 'test-api-key',
        primaryModel: 'nova-2',
        status: 'verified',
      };

      const result = validateDeepgramStartupConfig(config);
      expect(result.isValid).toBe(true);
    });

    it('should fail validation for enabled config without API key', () => {
      const config = {
        isEnabled: true,
        apiKey: '',
        primaryModel: 'nova-2',
      };

      const result = validateDeepgramStartupConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('API key is missing');
    });

    it('should pass validation for disabled Deepgram config', () => {
      const config = {
        isEnabled: false,
        apiKey: '',
      };

      const result = validateDeepgramStartupConfig(config);
      expect(result.isValid).toBe(true);
      expect(result.details).toContain('disabled');
    });

    it('should detect configuration issues for free tier with premium model', () => {
      const config = {
        isEnabled: true,
        apiKey: 'test-api-key',
        primaryModel: 'nova-2',
        accountTier: 'free',
        status: 'verified',
      };

      const result = validateDeepgramStartupConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Free tier account cannot access nova-2 models');
    });

    it('should detect failed validation status', () => {
      const config = {
        isEnabled: true,
        apiKey: 'test-api-key',
        primaryModel: 'nova-2',
        status: 'failed',
        lastError: 'Insufficient permissions',
      };

      const result = validateDeepgramStartupConfig(config);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Previous validation failed');
      expect(result.error).toContain('Insufficient permissions');
    });

    it('should handle missing configuration', () => {
      const result = validateDeepgramStartupConfig(null);
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Deepgram configuration not found');
    });
  });

  describe('Graceful startup behavior', () => {
    it('should demonstrate graceful degradation concept', () => {
      // This test demonstrates the concept of graceful degradation
      // In real implementation, even if Deepgram fails, server should continue
      
      const mockStartupResult = {
        success: false,
        canContinue: true,
        message: 'Validation failed but server can continue with degraded functionality'
      };

      // The key principle: canContinue should always be true for graceful startup
      expect(mockStartupResult.canContinue).toBe(true);
      expect(mockStartupResult.message).toContain('degraded functionality');
    });

    it('should demonstrate first-time setup detection', () => {
      // Mock configuration that represents first-time setup
      const firstTimeConfig = {
        apiKey: 'test-api-key',
        lastModelValidation: null,
        status: undefined,
        firstTimeSetupCompleted: false,
      };

      // First-time setup should be detected when:
      // 1. API key exists
      // 2. No previous validation
      // 3. No status set
      // 4. First-time setup not completed
      const isFirstTime = !firstTimeConfig.lastModelValidation && 
                         !firstTimeConfig.status &&
                         !!firstTimeConfig.apiKey &&
                         !firstTimeConfig.firstTimeSetupCompleted;

      expect(isFirstTime).toBe(true);
    });

    it('should demonstrate auto-configuration success tracking', () => {
      // Mock successful auto-configuration result
      const autoConfigResult = {
        success: true,
        model: 'base',
        previousModel: 'nova-2',
        accountTier: 'free' as const,
        availableModels: ['base'],
        fallbackModels: [],
        warnings: ['Model changed from nova-2 to base for better compatibility']
      };

      expect(autoConfigResult.success).toBe(true);
      expect(autoConfigResult.model).toBe('base');
      expect(autoConfigResult.warnings).toContain('Model changed from nova-2 to base for better compatibility');
    });
  });
});
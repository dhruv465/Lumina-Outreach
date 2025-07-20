import { DeepgramConfigValidator } from '../deepgramConfigValidator';
import { EnhancedDeepgramConfig } from '../../types/deepgram';

describe('DeepgramConfigValidator', () => {
  describe('validateConfiguration', () => {
    it('should validate a complete valid configuration', () => {
      const config: EnhancedDeepgramConfig = {
        apiKey: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        isEnabled: true,
        primaryModel: 'nova-2',
        fallbackModels: ['nova', 'base'],
        autoFallback: true,
        accountTier: 'premium',
        tier: 'enhanced',
        retryAttempts: 3,
        timeoutMs: 30000
      };

      const result = DeepgramConfigValidator.validateConfiguration(config);
      
      expect(result.isValid).toBe(true);
      expect(result.issues.filter(issue => issue.type === 'error')).toHaveLength(0);
    });

    it('should detect missing API key', () => {
      const config: EnhancedDeepgramConfig = {
        apiKey: '',
        isEnabled: true,
        primaryModel: 'nova-2',
        fallbackModels: ['nova', 'base'],
        autoFallback: true,
        tier: 'enhanced',
        retryAttempts: 3,
        timeoutMs: 30000
      };

      const result = DeepgramConfigValidator.validateConfiguration(config);
      
      expect(result.isValid).toBe(false);
      expect(result.issues.some(issue => 
        issue.type === 'error' && issue.field === 'apiKey'
      )).toBe(true);
    });

    it('should detect invalid retry attempts', () => {
      const config: EnhancedDeepgramConfig = {
        apiKey: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        isEnabled: true,
        primaryModel: 'nova-2',
        fallbackModels: ['nova', 'base'],
        autoFallback: true,
        tier: 'enhanced',
        retryAttempts: 15, // Invalid - too high
        timeoutMs: 30000
      };

      const result = DeepgramConfigValidator.validateConfiguration(config);
      
      expect(result.isValid).toBe(false);
      expect(result.issues.some(issue => 
        issue.type === 'error' && issue.field === 'retryAttempts'
      )).toBe(true);
    });

    it('should detect account tier incompatibility', () => {
      const config: EnhancedDeepgramConfig = {
        apiKey: 'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        isEnabled: true,
        primaryModel: 'nova-2', // Premium model
        fallbackModels: ['nova', 'base'],
        autoFallback: true,
        accountTier: 'free', // Free account can't use premium model
        tier: 'enhanced',
        retryAttempts: 3,
        timeoutMs: 30000
      };

      const result = DeepgramConfigValidator.validateConfiguration(config);
      
      expect(result.issues.some(issue => 
        issue.type === 'warning' && issue.field === 'primaryModel'
      )).toBe(true);
    });
  });

  describe('suggestOptimalConfiguration', () => {
    it('should suggest correct configuration for free tier', () => {
      const config = DeepgramConfigValidator.suggestOptimalConfiguration('free');
      
      expect(config.primaryModel).toBe('base');
      expect(config.fallbackModels).toEqual([]);
      expect(config.autoFallback).toBe(false);
      expect(config.accountTier).toBe('free');
    });

    it('should suggest correct configuration for premium tier', () => {
      const config = DeepgramConfigValidator.suggestOptimalConfiguration('premium');
      
      expect(config.primaryModel).toBe('nova-2');
      expect(config.fallbackModels).toEqual(['nova', 'base']);
      expect(config.autoFallback).toBe(true);
      expect(config.accountTier).toBe('premium');
    });
  });

  describe('getModelRecommendations', () => {
    it('should recommend appropriate models for phone use case with premium account', () => {
      const recommendations = DeepgramConfigValidator.getModelRecommendations('phone', 'premium', 'en');
      
      expect(recommendations).toContain('nova-2-phonecall');
      expect(recommendations).toContain('nova-2');
    });

    it('should recommend only compatible models for free account', () => {
      const recommendations = DeepgramConfigValidator.getModelRecommendations('general', 'free', 'en');
      
      expect(recommendations).toContain('base');
      expect(recommendations).not.toContain('nova-2');
    });
  });
});
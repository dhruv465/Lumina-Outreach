import { DeepgramModelCompatibilityMigration } from '../deepgram-model-compatibility-migration';

describe('DeepgramModelCompatibilityMigration', () => {
  let migration: DeepgramModelCompatibilityMigration;

  beforeEach(() => {
    migration = new DeepgramModelCompatibilityMigration();
  });

  describe('Utility Functions', () => {
    it('should get correct default fallback models', () => {
      const fallbacks1 = (migration as any).getDefaultFallbackModels('nova-2');
      expect(fallbacks1).toEqual(['nova', 'base']);
      
      const fallbacks2 = (migration as any).getDefaultFallbackModels('nova');
      expect(fallbacks2).toEqual(['base']);
      
      const fallbacks3 = (migration as any).getDefaultFallbackModels('base');
      expect(fallbacks3).toEqual([]);
      
      const fallbacks4 = (migration as any).getDefaultFallbackModels('unknown-model');
      expect(fallbacks4).toEqual(['nova', 'base']);
    });

    it('should select best fallback model', () => {
      const fallback1 = (migration as any).selectBestFallbackModel(['nova', 'base'], ['nova', 'base']);
      expect(fallback1).toBe('nova');
      
      const fallback2 = (migration as any).selectBestFallbackModel(['base'], ['nova', 'base']);
      expect(fallback2).toBe('base');
      
      const fallback3 = (migration as any).selectBestFallbackModel([], ['nova', 'base']);
      expect(fallback3).toBeNull();
      
      const fallback4 = (migration as any).selectBestFallbackModel(['nova-2', 'nova'], []);
      expect(fallback4).toBe('nova-2'); // Should pick first available when no configured fallbacks
    });

    it('should optimize fallback models', () => {
      const optimized1 = (migration as any).optimizeFallbackModels(['nova', 'base'], ['nova-2', 'nova']);
      expect(optimized1).toEqual(['nova', 'base']);
      
      const optimized2 = (migration as any).optimizeFallbackModels(['base'], []);
      expect(optimized2).toEqual(['base']);
      
      const optimized3 = (migration as any).optimizeFallbackModels(['nova-2', 'nova', 'base'], ['nova-2']);
      expect(optimized3).toEqual(['nova-2', 'nova', 'base']);
    });

    it('should handle premium model fallbacks correctly', () => {
      const premiumFallbacks = (migration as any).getDefaultFallbackModels('nova-2-general');
      expect(premiumFallbacks).toEqual(['nova-general', 'nova', 'base-general', 'base']);
      
      const meetingFallbacks = (migration as any).getDefaultFallbackModels('nova-2-meeting');
      expect(premiumFallbacks).toEqual(['nova-general', 'nova', 'base-general', 'base']);
    });

    it('should handle legacy model fallbacks', () => {
      const enhancedFallbacks = (migration as any).getDefaultFallbackModels('enhanced');
      expect(enhancedFallbacks).toEqual(['base']);
      
      const generalFallbacks = (migration as any).getDefaultFallbackModels('general');
      expect(generalFallbacks).toEqual(['base']);
    });
  });

  describe('Model Selection Logic', () => {
    it('should prioritize configured fallbacks over default priority', () => {
      const availableModels = ['base', 'nova', 'nova-2'];
      const configuredFallbacks = ['base', 'nova'];
      
      const selected = (migration as any).selectBestFallbackModel(availableModels, configuredFallbacks);
      expect(selected).toBe('base'); // First configured fallback that's available
    });

    it('should fall back to priority order when no configured fallbacks match', () => {
      const availableModels = ['nova-2', 'base'];
      const configuredFallbacks = ['nova', 'nova-general']; // None available
      
      const selected = (migration as any).selectBestFallbackModel(availableModels, configuredFallbacks);
      expect(selected).toBe('nova-2'); // Highest priority available model
    });

    it('should optimize fallback models by filtering unavailable ones', () => {
      const availableModels = ['nova', 'base'];
      const currentFallbacks = ['nova-2', 'nova', 'base', 'nova-general'];
      
      const optimized = (migration as any).optimizeFallbackModels(availableModels, currentFallbacks);
      expect(optimized).toEqual(['nova', 'base']); // Only available models kept
    });

    it('should add missing priority models to fallback list', () => {
      const availableModels = ['nova-2', 'nova', 'base'];
      const currentFallbacks = ['nova-2']; // Missing good fallbacks
      
      const optimized = (migration as any).optimizeFallbackModels(availableModels, currentFallbacks);
      expect(optimized).toContain('nova');
      expect(optimized).toContain('base');
    });
  });

  describe('Migration Logic Validation', () => {
    it('should handle empty available models gracefully', () => {
      const selected = (migration as any).selectBestFallbackModel([], ['nova', 'base']);
      expect(selected).toBeNull();
      
      const optimized = (migration as any).optimizeFallbackModels([], ['nova', 'base']);
      expect(optimized).toEqual([]);
    });

    it('should handle empty configured fallbacks', () => {
      const availableModels = ['nova', 'base'];
      const selected = (migration as any).selectBestFallbackModel(availableModels, []);
      expect(selected).toBe('nova'); // Should pick highest priority available
      
      const optimized = (migration as any).optimizeFallbackModels(availableModels, []);
      expect(optimized).toContain('nova');
      expect(optimized).toContain('base');
    });

    it('should maintain model hierarchy in fallback selection', () => {
      // Test that premium models fallback to standard, then base
      const nova2Fallbacks = (migration as any).getDefaultFallbackModels('nova-2');
      expect(nova2Fallbacks[0]).toBe('nova'); // Standard model first
      expect(nova2Fallbacks[1]).toBe('base'); // Base model second
      
      // Test that standard models fallback to base
      const novaFallbacks = (migration as any).getDefaultFallbackModels('nova');
      expect(novaFallbacks[0]).toBe('base');
      
      // Test that base models have no fallbacks (they are the fallback)
      const baseFallbacks = (migration as any).getDefaultFallbackModels('base');
      expect(baseFallbacks).toEqual([]);
    });
  });

  describe('Edge Cases', () => {
    it('should handle undefined or null inputs gracefully', () => {
      const fallbacks = (migration as any).getDefaultFallbackModels(undefined);
      expect(fallbacks).toEqual(['nova', 'base']);
      
      const selected = (migration as any).selectBestFallbackModel(undefined, []);
      expect(selected).toBeNull();
      
      const optimized = (migration as any).optimizeFallbackModels([], undefined);
      expect(optimized).toEqual([]);
    });

    it('should handle duplicate models in lists', () => {
      const availableModels = ['nova', 'base', 'nova', 'base']; // Duplicates
      const configuredFallbacks = ['nova', 'nova', 'base'];
      
      const optimized = (migration as any).optimizeFallbackModels(availableModels, configuredFallbacks);
      // Should not have duplicates in result
      expect(optimized.filter(m => m === 'nova')).toHaveLength(1);
      expect(optimized.filter(m => m === 'base')).toHaveLength(1);
    });

    it('should handle very long model lists', () => {
      const manyModels = Array(100).fill(0).map((_, i) => `model-${i}`);
      manyModels.push('nova', 'base'); // Add some real models
      
      const selected = (migration as any).selectBestFallbackModel(manyModels, []);
      expect(selected).toBe('nova'); // Should still find priority model
    });
  });
});
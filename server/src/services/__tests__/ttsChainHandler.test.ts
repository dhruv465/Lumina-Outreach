import { synthesizeWithTTSChain, splitTextIntoChunks } from '../../utils/ttsChainHandler';

describe('TTS Chain Handler', () => {
  describe('splitTextIntoChunks', () => {
    it('should split text into appropriate chunks', () => {
      const longText = 'This is a long text that needs to be split. It has multiple sentences. Each sentence should be kept together when possible.';
      const chunks = splitTextIntoChunks(longText, 50);
      
      expect(chunks.length).toBeGreaterThan(1);
      expect(chunks.every(chunk => chunk.length <= 50)).toBe(true);
      expect(chunks.join('. ')).toContain('This is a long text');
    });

    it('should return single chunk for short text', () => {
      const shortText = 'Short text';
      const chunks = splitTextIntoChunks(shortText, 50);
      
      expect(chunks).toEqual([shortText]);
    });

    it('should handle empty text', () => {
      const chunks = splitTextIntoChunks('', 50);
      expect(chunks).toEqual([]);
    });
  });

  describe('synthesizeWithTTSChain', () => {
    it('should handle configuration not found gracefully', async () => {
      // Mock Configuration.findOne to return null
      jest.doMock('../models/Configuration', () => ({
        findOne: jest.fn().mockResolvedValue(null)
      }));

      const result = await synthesizeWithTTSChain('Test text', { callId: 'test' });
      
      expect(result.success).toBe(false);
      expect(result.shouldUseTwilioFallback).toBe(true);
      expect(result.twilioVoiceConfig).toEqual({
        voice: 'alice',
        language: 'en-US'
      });
    });
  });
});
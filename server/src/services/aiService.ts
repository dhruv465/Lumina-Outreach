import { getAIOrchestrationService } from './aiOrchestrationAdapter';
import { getRAGSystem } from './rag/ragSystem';
import logger from '../utils/logger';

class AIService {
  private aiOrchestrationService = getAIOrchestrationService();
  private ragService = getRAGSystem();

  async processLLM(messages: any[], options: any) {
    return this.aiOrchestrationService.processLLM(messages, options);
  }

  async processRAG(query: string, options: any) {
    return this.ragService.generateEnhancedPrompt(query, [], options);
  }

  async processVoice(text: string, voiceId: string, options: any) {
    return this.aiOrchestrationService.processVoice(text, voiceId, options);
  }

  async processSpeechAnalysis(audioBuffer: Buffer, fileType: string) {
    // This is a placeholder. In a real implementation, you would call the appropriate service.
    logger.info('Processing speech analysis request');
    return { transcript: 'This is a placeholder transcript.' };
  }

  async detectEmotion(text: string) {
    // This is a placeholder. In a real implementation, you would call the appropriate service.
    logger.info('Detecting emotion in text');
    return { emotion: 'neutral' };
  }

  async detectIntent(text: string) {
    // This is a placeholder. In a real implementation, you would call the appropriate service.
    logger.info('Detecting intent in text');
    return { intent: 'unknown' };
  }

  async detectObjection(text: string) {
    // This is a placeholder. In a real implementation, you would call the appropriate service.
    logger.info('Detecting objection in text');
    return { objection: false };
  }

  async scoreConversation(conversationId: string, callId: string) {
    // This is a placeholder. In a real implementation, you would call the appropriate service.
    logger.info('Scoring conversation');
    return { qualityScore: 0.85 };
  }

  getMetrics() {
    return this.aiOrchestrationService.getMetrics();
  }

  clearCache() {
    // This is a placeholder. In a real implementation, you would call the appropriate service.
    logger.info('Clearing AI cache');
  }

  updateConfig(config: any) {
    return this.aiOrchestrationService.updateConfig(config);
  }
}

export const aiService = new AIService();

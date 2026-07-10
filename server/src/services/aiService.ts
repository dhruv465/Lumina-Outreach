import { getAIOrchestrationService } from './aiOrchestrationAdapter';
import { getRAGSystem } from './rag/ragSystem';
import logger from '../utils/logger';
import { appendToSheet } from '../utils/googleSheetsService';
import CallFeedback from '../models/CallFeedback';
import Lead from '../models/Lead';

export interface AIAnalysisResult {
  intent: string;
  confidence: number;
  parameters: any;
  sentiment: {
    score: number;
    magnitude: number;
  };
  emotion: string;
  isObjection: boolean;
  languageCode: string;
}

class AIService {
  private aiOrchestrationService = getAIOrchestrationService();

  async processLLM(messages: any[], options: any) {
    return this.aiOrchestrationService.processLLM(messages, options);
  }

  async processRAG(query: string, options: any) {
    const ragSystem = getRAGSystem();
    if (!ragSystem) {
      logger.warn('RAG system not initialized, skipping context enhancement');
      return { augmentedPrompt: [], selectedDocuments: [] };
    }
    return ragSystem.generateEnhancedPrompt(query, [], options);
  }

  async processVoice(_text?: string, _voiceId?: string, _options?: any) {
    return { success: false, error: 'Legacy voice synthesis removed; use LiveKit agent path' };
  }

  async processSpeechAnalysis(_audioBuffer?: Buffer, _fileType?: string) {
    return { transcript: '', message: 'Legacy speech analysis removed; use LiveKit agent path' };
  }

  async analyzeText(text: string, _sessionId: string, languageCode: string = 'en-US'): Promise<AIAnalysisResult> {
    const normalized = text.toLowerCase();
    const isObjection = [
      'not interested',
      'too expensive',
      'no thanks',
      "don't need",
      'competitor',
    ].some((phrase) => normalized.includes(phrase));

    const positive = ['yes', 'interested', 'send', 'great', 'good'].some((phrase) => normalized.includes(phrase));
    const negative = isObjection || ['no', 'bad', 'stop', 'busy'].some((phrase) => normalized.includes(phrase));

    return {
      intent: isObjection ? 'not_interested' : positive ? 'interested' : 'unknown',
      confidence: positive || negative ? 0.6 : 0,
      parameters: {},
      sentiment: {
        score: positive ? 0.6 : negative ? -0.6 : 0,
        magnitude: positive || negative ? 0.6 : 0,
      },
      emotion: positive ? 'positive' : negative ? 'negative' : 'neutral',
      isObjection,
      languageCode,
    };
  }

  async detectIntent(text: string, sessionId: string) {
    const analysis = await this.analyzeText(text, sessionId);
    return { intent: analysis.intent, confidence: analysis.confidence, parameters: analysis.parameters };
  }

  async detectEmotion(text: string, sessionId: string) {
    const analysis = await this.analyzeText(text, sessionId);
    return { emotion: analysis.emotion, score: analysis.sentiment.score };
  }

  async detectObjection(text: string, sessionId: string) {
    const analysis = await this.analyzeText(text, sessionId);
    return { isObjection: analysis.isObjection, intent: analysis.intent };
  }

  async logLeadToSheets(leadData: any) {
    logger.info('Logging lead data to Google Sheets:', leadData);

    const spreadsheetId = process.env.GOOGLE_SHEET_ID || leadData.campaignConfig?.spreadsheetId;
    if (!spreadsheetId) {
      logger.warn('No GOOGLE_SHEET_ID found in environment or campaign config. Skipping sheets logging.');
      return { success: false, reason: 'missing_spreadsheet_id' };
    }

    const values = [
      new Date().toISOString(),
      leadData.leadId,
      leadData.lastIntent,
      JSON.stringify(leadData.parameters),
      leadData.notes || '',
    ];

    try {
      await appendToSheet(spreadsheetId, 'Sheet1!A1', values);
      return { success: true };
    } catch (error) {
      logger.error(`Failed to log lead to sheets: ${error instanceof Error ? error.message : String(error)}`);
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async updateLeadStatus(leadId: string, intent: string) {
    try {
      let status = '';
      if (intent === 'ready_to_buy' || intent === 'closing_success') {
        status = 'Converted';
      } else if (intent === 'not_interested' || intent === 'objection_unresolved') {
        status = 'Not Interested';
      } else if (intent === 'interested' || intent === 'price_inquiry') {
        status = 'Qualified';
      }

      if (status) {
        await Lead.findByIdAndUpdate(leadId, { status });
        logger.info(`Updated lead ${leadId} status to ${status} based on intent ${intent}`);
      }
    } catch (error) {
      logger.error(`Error updating lead status: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async collectTrainingData(params: {
    text: string;
    analysis: AIAnalysisResult;
    sessionId: string;
    leadId: string;
    campaignId: string;
    actualIntent?: string;
  }) {
    try {
      await CallFeedback.create({
        callId: params.sessionId,
        conversationId: params.sessionId,
        leadId: params.leadId,
        campaignId: params.campaignId,
        text: params.text,
        detectedIntent: params.analysis.intent,
        detectedConfidence: params.analysis.confidence,
        actualIntent: params.actualIntent,
        isCorrect: !params.actualIntent || params.actualIntent === params.analysis.intent,
        isUsedForTraining: false,
      });
    } catch (error) {
      logger.error(`Error saving training data: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async scoreConversation(_conversationId: string, _callId: string) {
    logger.info('Scoring conversation');
    return { qualityScore: 0.85 };
  }

  getMetrics() {
    return this.aiOrchestrationService.getMetrics();
  }

  clearCache() {
    logger.info('Clearing AI cache');
  }

  updateConfig(config: any) {
    return this.aiOrchestrationService.updateConfig(config);
  }
}

export const aiService = new AIService();

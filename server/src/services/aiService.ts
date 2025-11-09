import { getAIOrchestrationService } from './aiOrchestrationAdapter';
import { getRAGSystem } from './rag/ragSystem';
import logger from '../utils/logger';
import { SessionsClient } from '@google-cloud/dialogflow-cx';
import { v4 as uuidv4 } from 'uuid';

const DIALOGFLOW_PROJECT_ID = process.env.DIALOGFLOW_PROJECT_ID!;
const DIALOGFLOW_LOCATION = process.env.DIALOGFLOW_LOCATION!;
const DIALOGFLOW_AGENT_ID = process.env.DIALOGFLOW_AGENT_ID!;

const sessionClient = new SessionsClient({ apiEndpoint: `${DIALOGFLOW_LOCATION}-dialogflow.googleapis.com` });

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

      async analyzeText(text: string, sessionId: string) {
        logger.info(`Analyzing text with Dialogflow CX for session ${sessionId}: "${text}"`);

        const sessionPath = sessionClient.projectLocationAgentSessionPath(
          DIALOGFLOW_PROJECT_ID,
          DIALOGFLOW_LOCATION,
          DIALOGFLOW_AGENT_ID,
          sessionId
        );

                  const request = {
                    session: sessionPath,
                    queryInput: {
                      text: {
                        text: text,
                      },
                      languageCode: 'en-US', // TODO: Make this configurable or detect language
                      // Enable sentiment analysis
                      sentimentAnalysisResultConfig: {
                        enableSentimentAnalysis: true,
                      },
                    },
                  };
        try {
          const [response] = await sessionClient.detectIntent(request);
          const queryResult = response.queryResult;

          if (!queryResult) {
            logger.warn('Dialogflow CX did not return a queryResult.');
            return { intent: 'unknown', confidence: 0, parameters: {}, sentiment: { score: 0, magnitude: 0 } };
          }

          const intent = queryResult.intent?.displayName || 'unknown';
          const confidence = queryResult.intentDetectionConfidence || 0;
          const parameters = queryResult.parameters?.fields || {};
          const sentiment = queryResult.sentimentAnalysisResult || { score: 0, magnitude: 0 };

          logger.info(`Dialogflow CX Response: Intent=${intent}, Confidence=${confidence}, Sentiment=${sentiment.score}`);

          return {
            intent,
            confidence,
            parameters,
            sentiment: {
              score: sentiment.score,
              magnitude: sentiment.magnitude,
            },
          };
        } catch (error) {
          logger.error(`Error calling Dialogflow CX: ${error.message}`);
          // Fallback or error handling
          return { intent: 'error', confidence: 0, parameters: {}, sentiment: { score: 0, magnitude: 0 } };
        }
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

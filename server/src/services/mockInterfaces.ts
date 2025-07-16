/**
 * Mock interfaces for compatibility with the AI Orchestration Layer
 * 
 * This file provides mock interfaces and types to ensure compatibility between
 * the AI Orchestration Layer and the existing services.
 */

// SpeechAnalysisService mock interface
export interface SpeechAnalysisMock {
  analyzeSpeech(audioPath: string, mimeType?: string): Promise<SpeechAnalysis>;
}

// SpeechAnalysis mock interface
export interface SpeechAnalysis {
  text: string;
  confidence: number;
  emotions?: {
    [key: string]: number;
  };
  intent?: string;
  language?: string;
  provider?: string;
}

// AdvancedConversationEngine mock interface
export interface AdvancedConversationEngineMock {
  processTurn(
    userInput: string,
    conversationContext: any
  ): Promise<{
    response: string;
    audio?: Buffer;
    emotion?: string;
    nextActions?: string[];
  }>;
  
  updateContext(
    currentContext: any,
    newData: any
  ): any;
}

// ObjectDetectionService mock interface
export interface ObjectDetectionServiceMock {
  detectIntent(text: string): Promise<{
    intent: string;
    confidence: number;
    entities?: Array<{
      type: string;
      value: string;
      confidence: number;
    }>;
  }>;
  
  detectObjection(text: string): Promise<{
    isObjection: boolean;
    confidence: number;
    type?: string;
    reason?: string;
  }>;
}

// ConversationQualityService mock interface
export interface ConversationQualityServiceMock {
  scoreConversation(
    conversationId: string,
    callId: string
  ): Promise<{
    overallScore: number;
    metrics: {
      [key: string]: number;
    };
    insights: string[];
    recommendations: string[];
  }>;
}

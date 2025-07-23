// This file provides type augmentations for various services
// Specifically for WebCallService and CampaignService

import { WebCallService } from '../services/webCallService';
import { CampaignService } from '../services/campaignService';

// WebCallService method augmentations
declare module '../services/webCallService' {
  interface WebCallOptions {
    campaignId: string;
    userId: string;
    testId?: string;
    campaignSettings?: any; // Replace with proper type when available
  }

  interface WebCallSession {
    id: string;
    // Add other properties as needed
  }

  interface TranscriptResult {
    text: string;
    // Add other properties as needed
  }

  interface LLMResponse {
    text: string;
    // Add other properties as needed
  }

  interface AudioResponse {
    audio: string;
    // Add other properties as needed
  }

  interface WebCallService {
    createSession(options: WebCallOptions): Promise<WebCallSession>;
    getSession(sessionId: string): Promise<WebCallSession | null>;
    endSession(sessionId: string): Promise<void>;
    processUserAudio(sessionId: string, audio: string): Promise<TranscriptResult>;
    processAudio(sessionId: string, audio: string): Promise<TranscriptResult>;
    processTranscript(sessionId: string, transcript: string): Promise<LLMResponse>;
    processResponse(sessionId: string, response: string): Promise<AudioResponse>;
  }
}

// CampaignService method augmentations
declare module '../services/campaignService' {
  interface Campaign {
    id: string;
    settings: any; // Replace with proper type when available
    // Add other properties as needed
  }

  interface CampaignService {
    getCampaign(campaignId: string): Promise<Campaign | null>;
  }
}

// CircuitBreaker augmentations
declare module '../utils/circuitBreaker' {
  export interface CircuitBreaker {
    execute<T>(fn: () => Promise<T>): Promise<T | null>;
  }

  export class CircuitBreakerFactory {
    static create(serviceName: string): CircuitBreaker;
  }
}

// Logger augmentations
declare module '../utils/logger' {
  export function createLogger(context: string): Logger;
  
  interface Logger {
    info(message: string, ...args: any[]): void;
    error(message: string, error?: Error): void;
    debug(message: string, ...args: any[]): void;
    warn(message: string, ...args: any[]): void;
  }
}

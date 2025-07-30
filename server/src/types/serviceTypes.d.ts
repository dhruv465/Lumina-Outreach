// This file provides type augmentations for various services
// Specifically for CampaignService

import { CampaignService } from '../services/campaignService';

// Web call service types removed

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

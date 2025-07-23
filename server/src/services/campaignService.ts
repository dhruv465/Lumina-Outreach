/**
 * Campaign Service - Handles campaign execution and A/B testing
 */

import mongoose from 'mongoose';
import { logger, getErrorMessage } from '../index';
import leadService from './leadService';
import ConversationEngineService from './conversationEngineService';
import { EnhancedVoiceAIService } from './enhancedVoiceAIService';
import SpeechAnalysisService from './speechAnalysisService';
import { LLMService } from './llm/service';
import Configuration from '../models/Configuration';
import { v4 as uuidv4 } from 'uuid';

export interface CampaignVariant {
  id: string;
  name: string;
  personality: string;
  script: string;
  language: 'English' | 'Hindi';
  isControl?: boolean;
}

export interface Campaign {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'paused' | 'completed';
  targetCount: number;
  currentCount: number;
  startDate?: Date;
  endDate?: Date;
  leadFilters: {
    status?: string[];
    source?: string[];
    tags?: string[];
    languagePreference?: string[];
  };
  variants: CampaignVariant[];
  metrics: {
    totalCalls: number;
    completedCalls: number;
    failedCalls: number;
    positiveEmotions: number;
    negativeEmotions: number;
    averageCallDuration: number;
    conversionRate: number;
    variantPerformance: {
      [variantId: string]: {
        calls: number;
        completions: number;
        positiveEmotions: number;
        conversionRate: number;
      };
    };
  };
  callRecords: string[]; // IDs of call records
  systemPrompt?: string;
}

export interface CallRecord {
  id: string;
  campaignId: string;
  leadId: string;
  variantId: string;
  startTime: Date;
  endTime?: Date;
  duration?: number;
  status: 'in-progress' | 'completed' | 'failed' | 'no-answer';
  emotions: {
    primary: string;
    trends: string;
    finalScore: number;
  };
  outcome: string;
  notes?: string;
  transcriptPath?: string;
  recordingPath?: string;
}

export class CampaignService {
  private campaigns: Map<string, Campaign> = new Map();
  private callRecords: Map<string, CallRecord> = new Map();
  private conversationEngine: ConversationEngineService;
  
  constructor(
    elevenLabsApiKey: string = '', 
    openAIApiKey: string = '', 
    anthropicApiKey?: string,
    googleSpeechKey?: string,
    deepgramApiKey?: string
  ) {
    // Create EnhancedVoiceAIService
    const voiceAI = new EnhancedVoiceAIService(elevenLabsApiKey);
    
    // Create SpeechAnalysisService
    const speechAnalysis = new SpeechAnalysisService(openAIApiKey, googleSpeechKey, deepgramApiKey);
    
    // Create LLMService with default config
    const llmService = new LLMService({
      providers: [
        { name: 'openai', apiKey: openAIApiKey, isEnabled: true },
        { name: 'anthropic', apiKey: anthropicApiKey || '', isEnabled: !!anthropicApiKey }
      ]
    });
    
    this.conversationEngine = new ConversationEngineService(
      voiceAI,
      speechAnalysis,
      llmService
    );
    
    // Initialize with credentials from database
    this.initializeWithCredentials().catch(error => {
      logger.error(`Error initializing CampaignService with credentials: ${getErrorMessage(error)}`);
    });
  }
  
  // Get credentials from database configuration
  private async initializeWithCredentials(): Promise<void> {
    try {
      // Get configuration from database
      const config = await Configuration.findOne();
      
      if (config) {
        let elevenLabsKey = config.elevenLabsConfig?.apiKey || '';
        
        // Get LLM providers
        const openAIProvider = config.llmConfig?.providers?.find((p: any) => p.name === 'openai');
        const openAIKey = openAIProvider?.apiKey || '';
        
        const anthropicProvider = config.llmConfig?.providers?.find((p: any) => p.name === 'anthropic');
        const anthropicKey = anthropicProvider?.apiKey || '';
        
        const googleProvider = config.llmConfig?.providers?.find((p: any) => p.name === 'google');
        const googleKey = googleProvider?.apiKey || '';
        
        // Create services
        const voiceAI = new EnhancedVoiceAIService(elevenLabsKey);
        const speechAnalysis = new SpeechAnalysisService(openAIKey, googleKey, '');
        const llmService = new LLMService({
          providers: [
            { name: 'openai', apiKey: openAIKey, isEnabled: true },
            { name: 'anthropic', apiKey: anthropicKey, isEnabled: !!anthropicKey },
            { name: 'google', apiKey: googleKey, isEnabled: !!googleKey }
          ]
        });
        
        // Reinitialize the conversation engine with database credentials
        this.conversationEngine = new ConversationEngineService(
          voiceAI,
          speechAnalysis,
          llmService
        );
        
        logger.info('CampaignService initialized with credentials from configuration');
      }
    } catch (error) {
      logger.error(`Failed to initialize CampaignService with credentials: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Create a new campaign
   */
  public createCampaign(campaignData: Partial<Campaign>): Campaign {
    const id = uuidv4();
    
    const campaign: Campaign = {
      id,
      name: campaignData.name || `Campaign ${id}`,
      description: campaignData.description || '',
      status: campaignData.status || 'draft',
      targetCount: campaignData.targetCount || 100,
      currentCount: 0,
      leadFilters: campaignData.leadFilters || {},
      variants: campaignData.variants || [],
      metrics: {
        totalCalls: 0,
        completedCalls: 0,
        failedCalls: 0,
        positiveEmotions: 0,
        negativeEmotions: 0,
        averageCallDuration: 0,
        conversionRate: 0,
        variantPerformance: {}
      },
      callRecords: [],
      settings: {}
    };
    
    // Initialize variant performance metrics
    campaign.variants.forEach(variant => {
      campaign.metrics.variantPerformance[variant.id] = {
        calls: 0,
        completions: 0,
        positiveEmotions: 0,
        conversionRate: 0
      };
    });
    
    this.campaigns.set(id, campaign);
    logger.info(`Created campaign: ${campaign.name} (${id})`);
    
    return campaign;
  }

  /**
   * Get a campaign by ID
   */
  public getCampaign(id: string): Campaign | undefined {
    return this.campaigns.get(id);
  }

  /**
   * Get all campaigns
   */
  public getAllCampaigns(): Campaign[] {
    return Array.from(this.campaigns.values());
  }

  /**
   * Update a campaign
   */
  public updateCampaign(id: string, updateData: Partial<Campaign>): Campaign | undefined {
    const campaign = this.campaigns.get(id);
    
    if (!campaign) {
      return undefined;
    }
    
    // Update campaign data
    Object.assign(campaign, {
      ...campaign,
      ...updateData,
      id // Ensure ID isn't changed
    });
    
    this.campaigns.set(id, campaign);
    logger.info(`Updated campaign: ${campaign.name} (${id})`);
    
    return campaign;
  }

  /**
   * Delete a campaign
   */
  public deleteCampaign(id: string): boolean {
    const success = this.campaigns.delete(id);
    
    if (success) {
      logger.info(`Deleted campaign: ${id}`);
    }
    
    return success;
  }

  /**
   * Start a campaign
   */
  public startCampaign(id: string): Campaign | undefined {
    const campaign = this.campaigns.get(id);
    
    if (!campaign) {
      return undefined;
    }
    
    campaign.status = 'active';
    campaign.startDate = new Date();
    
    this.campaigns.set(id, campaign);
    logger.info(`Started campaign: ${campaign.name} (${id})`);
    
    // Start processing the campaign
    this.processCampaign(id).catch(err => {
      logger.error(`Error processing campaign: ${err.message}`);
    });
    
    return campaign;
  }

  /**
   * Pause a campaign
   */
  public pauseCampaign(id: string): Campaign | undefined {
    const campaign = this.campaigns.get(id);
    
    if (!campaign) {
      return undefined;
    }
    
    campaign.status = 'paused';
    
    this.campaigns.set(id, campaign);
    logger.info(`Paused campaign: ${campaign.name} (${id})`);
    
    return campaign;
  }

  /**
   * Complete a campaign
   */
  public completeCampaign(id: string): Campaign | undefined {
    const campaign = this.campaigns.get(id);
    
    if (!campaign) {
      return undefined;
    }
    
    campaign.status = 'completed';
    campaign.endDate = new Date();
    
    this.campaigns.set(id, campaign);
    logger.info(`Completed campaign: ${campaign.name} (${id})`);
    
    return campaign;
  }

  /**
   * Process campaign by making calls
   */
  private async processCampaign(id: string): Promise<void> {
    const campaign = this.campaigns.get(id);
    
    if (!campaign || campaign.status !== 'active') {
      return;
    }
    
    // Check if campaign is complete
    if (campaign.currentCount >= campaign.targetCount) {
      this.completeCampaign(id);
      return;
    }
    
    try {
      // Get leads for calling based on campaign filters
      const filters = {
        status: campaign.leadFilters.status?.length ? campaign.leadFilters.status[0] : undefined,
        tags: campaign.leadFilters.tags,
        languagePreference: campaign.leadFilters.languagePreference?.length ? 
          campaign.leadFilters.languagePreference[0] : undefined
      };
      
      // Get leads that haven't been called in this campaign
      const excludeIds = campaign.callRecords.map(recordId => {
        const record = this.callRecords.get(recordId);
        return record?.leadId || '';
      }).filter(id => id);
      
      const leads = await leadService.getLeadsForCalling(
        10, // Get 10 leads at a time
        filters.languagePreference,
        excludeIds
      );
      
      // Process each lead
      for (const lead of leads) {
        // Skip if campaign is no longer active
        const updatedCampaign = this.campaigns.get(id);
        if (!updatedCampaign || updatedCampaign.status !== 'active') {
          break;
        }
        
        // Select a variant for A/B testing
        const variant = this.selectVariant(campaign);
        
        if (!variant) {
          logger.error(`No variants available for campaign: ${campaign.id}`);
          continue;
        }
        
        // Create call record
        const callRecordId = uuidv4();
        const callRecord: CallRecord = {
          id: callRecordId,
          campaignId: campaign.id,
          leadId: lead.id,
          variantId: variant.id,
          startTime: new Date(),
          status: 'in-progress',
          emotions: {
            primary: 'neutral',
            trends: 'stable',
            finalScore: 0.5
          },
          outcome: 'pending'
        };
        
        this.callRecords.set(callRecordId, callRecord);
        campaign.callRecords.push(callRecordId);
        
        // Update campaign metrics
        campaign.currentCount++;
        campaign.metrics.totalCalls++;
        campaign.metrics.variantPerformance[variant.id].calls++;
        
        try {
          // Initialize conversation
          const sessionId = uuidv4();
          
          // Get the personality object from the personality ID
          const personalities = await EnhancedVoiceAIService.getEnhancedVoicePersonalities();
          const personalityObj = personalities.find(p => p.id === variant.personality) || personalities[0];
          
          await this.conversationEngine.createSession(
            lead.id,
            campaign.id,
            variant.language,
            personalityObj?.id
          );
          
          // Generate opening message
          const openingMessage = await this.conversationEngine.generateOpeningMessage(
            sessionId,
            lead.name,
            campaign.name
          );
          
          logger.info(`Call initiated for lead: ${lead.name} (${lead.id}) with variant: ${variant.name}`);
          
          // In a real implementation, this would integrate with Twilio to make the call
          // For now, we'll simulate a successful call
          
          // Simulate call completion
          setTimeout(() => {
            this.completeCall(callRecordId, 'completed', 'interested', 0.7);
          }, 5000);
          
        } catch (error) {
          logger.error(`Error processing call for lead ${lead.id}: ${getErrorMessage(error)}`);
          this.completeCall(callRecordId, 'failed', 'neutral', 0.5);
        }
      }
      
      // Schedule next batch if campaign is still active
      setTimeout(() => {
        this.processCampaign(id);
      }, 30000); // Process next batch after 30 seconds
      
    } catch (error) {
      logger.error(`Error processing campaign ${id}: ${getErrorMessage(error)}`);
      
      // Retry after a delay
      setTimeout(() => {
        this.processCampaign(id);
      }, 60000); // Retry after 1 minute
    }
  }

  /**
   * Select a variant for A/B testing
   */
  private selectVariant(campaign: Campaign): CampaignVariant | undefined {
    if (campaign.variants.length === 0) {
      return undefined;
    }
    
    // If campaign is just starting, distribute evenly
    if (campaign.metrics.totalCalls < campaign.variants.length * 10) {
      // Find the variant with the fewest calls
      return campaign.variants.reduce((min, variant) => {
        const minCalls = campaign.metrics.variantPerformance[min.id].calls;
        const variantCalls = campaign.metrics.variantPerformance[variant.id].calls;
        return variantCalls < minCalls ? variant : min;
      }, campaign.variants[0]);
    }
    
    // If we have enough data, use Thompson sampling for multi-armed bandit
    // This prioritizes variants with higher conversion rates
    const randomSamples = campaign.variants.map(variant => {
      const performance = campaign.metrics.variantPerformance[variant.id];
      const conversions = performance.conversionRate * performance.completions;
      const nonConversions = performance.completions - conversions;
      
      // Sample from beta distribution (simplified)
      const alpha = conversions + 1; // Add 1 for smoothing
      const beta = nonConversions + 1; // Add 1 for smoothing
      
      // Simple approximation of beta sampling
      let sample = 0;
      for (let i = 0; i < 12; i++) {
        sample += Math.random();
      }
      sample = sample - 6;
      sample = sample * Math.sqrt(1 / (alpha + beta)) + (alpha / (alpha + beta));
      
      return { variant, sample };
    });
    
    // Select the variant with the highest sample
    randomSamples.sort((a, b) => b.sample - a.sample);
    return randomSamples[0].variant;
  }

  /**
   * Complete a call and update metrics
   */
  public completeCall(
    callRecordId: string,
    status: 'completed' | 'failed' | 'no-answer',
    primaryEmotion: string = 'neutral',
    emotionScore: number = 0.5,
    outcome: string = 'undecided',
    notes?: string
  ): CallRecord | undefined {
    const callRecord = this.callRecords.get(callRecordId);
    
    if (!callRecord) {
      return undefined;
    }
    
    // Update call record
    callRecord.status = status;
    callRecord.endTime = new Date();
    callRecord.duration = callRecord.endTime.getTime() - callRecord.startTime.getTime();
    callRecord.emotions.primary = primaryEmotion;
    callRecord.emotions.finalScore = emotionScore;
    callRecord.outcome = outcome;
    
    if (notes) {
      callRecord.notes = notes;
    }
    
    this.callRecords.set(callRecordId, callRecord);
    
    // Update campaign metrics
    const campaign = this.campaigns.get(callRecord.campaignId);
    
    if (campaign) {
      const isPositiveEmotion = ['interested', 'happy', 'excited', 'satisfied'].includes(primaryEmotion);
      const isConversion = outcome === 'converted';
      
      if (status === 'completed') {
        campaign.metrics.completedCalls++;
        campaign.metrics.variantPerformance[callRecord.variantId].completions++;
        
        if (isPositiveEmotion) {
          campaign.metrics.positiveEmotions++;
          campaign.metrics.variantPerformance[callRecord.variantId].positiveEmotions++;
        } else {
          campaign.metrics.negativeEmotions++;
        }
        
        if (isConversion) {
          campaign.metrics.conversionRate = campaign.metrics.completedCalls > 0 ? 
            campaign.metrics.totalCalls / campaign.metrics.completedCalls : 0;
            
          campaign.metrics.variantPerformance[callRecord.variantId].conversionRate = 
            campaign.metrics.variantPerformance[callRecord.variantId].completions > 0 ?
            campaign.metrics.variantPerformance[callRecord.variantId].calls / 
            campaign.metrics.variantPerformance[callRecord.variantId].completions : 0;
        }
      } else {
        campaign.metrics.failedCalls++;
      }
      
      // Calculate average call duration
      const completedRecords = campaign.callRecords
        .map(id => this.callRecords.get(id))
        .filter(record => record && record.status === 'completed' && record.duration);
        
      const totalDuration = completedRecords.reduce((sum, record) => sum + (record?.duration || 0), 0);
      campaign.metrics.averageCallDuration = completedRecords.length > 0 ? 
        totalDuration / completedRecords.length : 0;
      
      this.campaigns.set(campaign.id, campaign);
    }
    
    // Update lead status based on call outcome
    this.updateLeadAfterCall(callRecord);
    
    logger.info(`Call completed: ${callRecordId}, status: ${status}, outcome: ${outcome}`);
    
    return callRecord;
  }

  /**
   * Update lead status after call
   */
  private async updateLeadAfterCall(callRecord: CallRecord): Promise<void> {
    try {
      let status = 'Contacted';
      let notes = callRecord.notes || '';
      let callbackDate: Date | undefined;
      
      switch (callRecord.outcome) {
        case 'converted':
          status = 'Converted';
          break;
        case 'not_interested':
          status = 'Not Interested';
          break;
        case 'callback_requested':
          status = 'Scheduled Callback';
          callbackDate = new Date();
          callbackDate.setDate(callbackDate.getDate() + 3); // Schedule callback in 3 days
          break;
      }
      
      // Append emotion information to notes
      notes += `\nCall outcome: ${callRecord.outcome}. Primary emotion: ${callRecord.emotions.primary}. Emotion score: ${callRecord.emotions.finalScore}.`;
      
      await leadService.updateLeadAfterCall(
        callRecord.leadId,
        status,
        notes,
        callbackDate
      );
      
    } catch (error) {
      logger.error(`Error updating lead after call: ${getErrorMessage(error)}`);
    }
  }

  /**
   * Get call record by ID
   */
  public getCallRecord(id: string): CallRecord | undefined {
    return this.callRecords.get(id);
  }

  /**
   * Get call records for a campaign
   */
  public getCallRecordsForCampaign(campaignId: string): CallRecord[] {
    return Array.from(this.callRecords.values())
      .filter(record => record.campaignId === campaignId);
  }

  /**
   * Get call records for a lead
   */
  public getCallRecordsForLead(leadId: string): CallRecord[] {
    return Array.from(this.callRecords.values())
      .filter(record => record.leadId === leadId);
  }

  /**
   * Get campaign performance report
   */
  public getCampaignPerformanceReport(campaignId: string): any {
    const campaign = this.campaigns.get(campaignId);
    
    if (!campaign) {
      return null;
    }
    
    // Calculate additional metrics
    const callRecords = this.getCallRecordsForCampaign(campaignId);
    const completedCalls = callRecords.filter(record => record.status === 'completed');
    const conversionRate = completedCalls.length > 0 ? 
      completedCalls.filter(record => record.outcome === 'converted').length / completedCalls.length : 0;
    
    // Calculate variant performance
    const variantPerformance = campaign.variants.map(variant => {
      const variantRecords = callRecords.filter(record => record.variantId === variant.id);
      const variantCompletedCalls = variantRecords.filter(record => record.status === 'completed');
      const variantConversionRate = variantCompletedCalls.length > 0 ?
        variantCompletedCalls.filter(record => record.outcome === 'converted').length / variantCompletedCalls.length : 0;
      
      return {
        variantId: variant.id,
        variantName: variant.name,
        personality: variant.personality,
        totalCalls: variantRecords.length,
        completedCalls: variantCompletedCalls.length,
        conversionRate: variantConversionRate,
        positiveEmotions: variantRecords.filter(record => 
          ['interested', 'happy', 'excited', 'satisfied'].includes(record.emotions.primary)
        ).length
      };
    });
    
    // Calculate emotion distribution
    const emotionDistribution: Record<string, number> = {};
    completedCalls.forEach(record => {
      emotionDistribution[record.emotions.primary] = 
        (emotionDistribution[record.emotions.primary] || 0) + 1;
    });
    
    return {
      campaignId: campaign.id,
      campaignName: campaign.name,
      status: campaign.status,
      startDate: campaign.startDate,
      endDate: campaign.endDate,
      targetCount: campaign.targetCount,
      currentCount: campaign.currentCount,
      metrics: {
        totalCalls: callRecords.length,
        completedCalls: completedCalls.length,
        conversionRate,
        averageCallDuration: campaign.metrics.averageCallDuration / 1000, // Convert to seconds
        emotionDistribution
      },
      variantPerformance,
      bestPerformingVariant: variantPerformance.length > 0 ? 
        variantPerformance.reduce((best, current) => 
          current.conversionRate > best.conversionRate ? current : best
        ) : null
    };
  }
}

export default CampaignService;

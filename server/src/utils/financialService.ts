import Campaign from '../models/Campaign';
import Call from '../models/Call';
import logger from './logger';

export interface AICostBreakdown {
  llm: number;
  stt: number;
  tts: number;
  telephony: number;
}

export class FinancialService {
  /**
   * Approximate costs for different AI providers (per 1k tokens or minute)
   * These should be moved to a configuration model in a real scenario
   */
  private static readonly PRICING = {
    llm: {
      'gpt-4o': 0.015 / 1000, // $0.015 per 1k tokens
      'gpt-3.5-turbo': 0.002 / 1000,
      'claude-3-opus': 0.075 / 1000,
    },
    stt: {
      'deepgram': 0.0043 / 60, // ~$0.0043 per minute (Nova-2)
    },
    tts: {
      'elevenlabs': 0.18 / 1000, // $0.18 per 1k characters
    },
    telephony: {
      'twilio': 0.013 / 60, // $0.013 per minute
    }
  };

  /**
   * Calculate LLM cost based on token usage
   */
  static calculateLLMCost(model: string, tokens: number): number {
    const pricePerToken = (this.PRICING.llm as any)[model] || (this.PRICING.llm as any)['gpt-4o'];
    return tokens * pricePerToken;
  }

  /**
   * Update campaign total cost and check budget
   */
  static async trackCallCost(callId: string, campaignId: string, breakdown: AICostBreakdown) {
    try {
      const totalCallCost = breakdown.llm + breakdown.stt + breakdown.tts + breakdown.telephony;

      // Update Call record
      await Call.findByIdAndUpdate(callId, {
        cost: {
          ...breakdown,
          total: totalCallCost
        }
      });

      // Update Campaign record
      const campaign = await Campaign.findById(campaignId);
      if (campaign) {
        const newTotalCost = (campaign.metrics.totalCost || 0) + totalCallCost;
        
        const updateData: any = {
          'metrics.totalCost': newTotalCost
        };

        // Check if total budget exceeded
        if (campaign.budget && newTotalCost >= campaign.budget.totalBudget) {
          updateData['budget.isBudgetExceeded'] = true;
          updateData.status = 'Paused'; // Automatically pause if budget hit
          logger.warn(`Campaign ${campaignId} auto-paused: Total budget of $${campaign.budget.totalBudget} exceeded.`);
        }

        await Campaign.findByIdAndUpdate(campaignId, updateData);
      }
    } catch (error) {
      logger.error(`Error tracking financial data for call ${callId}:`, error);
    }
  }

  /**
   * Check if a campaign is allowed to make another call based on budget
   */
  static async isCampaignBudgetAvailable(campaignId: string): Promise<boolean> {
    try {
      const campaign = await Campaign.findById(campaignId);
      if (!campaign || !campaign.budget) return true;

      if (campaign.budget.isBudgetExceeded) return false;
      if (campaign.status === 'Paused' || campaign.status === 'Completed') return false;

      return (campaign.metrics.totalCost || 0) < campaign.budget.totalBudget;
    } catch (error) {
      return false;
    }
  }
}

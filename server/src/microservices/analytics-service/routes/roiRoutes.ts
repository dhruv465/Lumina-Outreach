/**
 * ROI Analysis Routes for Analytics Service
 * 
 * Provides financial return on investment calculations for campaigns
 */

import { FastifyInstance } from 'fastify';
import { RedisClientType } from 'redis';
import { Db, ObjectId } from 'mongodb';
import { ICampaign } from '../../types/campaign';
import { Server, IncomingMessage, ServerResponse } from 'http';

export function registerROIRoutes(
  server: FastifyInstance<Server, IncomingMessage, ServerResponse, any, any>,
  db: Db,
  redisClient: RedisClientType
) {
  /**
   * Calculate ROI for a specific campaign
   */
  server.get('/roi/campaign/:campaignId', async (request, reply) => {
    try {
      const { campaignId } = request.params as any;
      
      // Get collections
      const calls = db.collection('calls');
      const leads = db.collection('leads');
      const campaigns = db.collection('campaigns');
      
      // Get campaign details
      const campaign = await campaigns.findOne({ _id: new ObjectId(campaignId) }) as ICampaign | null;
      
      if (!campaign) {
        return reply.code(404).send({ error: 'Campaign not found' });
      }
      
      // Get all calls for this campaign
      const campaignCalls = await calls.find({ 
        campaignId: new ObjectId(campaignId) 
      }).toArray();
      
      // Get converted leads for this campaign
      const convertedLeads = await leads.find({
        campaignId: new ObjectId(campaignId),
        status: 'converted'
      }).toArray();
      
      // Calculate metrics
      const totalCalls = campaignCalls.length;
      const totalDuration = campaignCalls.reduce((sum, call) => sum + (call.duration || 0), 0);
      const totalMinutes = totalDuration / 60;
      
      // Calculate costs
      const costPerMinute = campaign.costPerMinute || 0.10; // Default $0.10 per minute
      const totalCallCost = totalMinutes * costPerMinute;
      
      // Add fixed campaign costs
      const campaignFixedCost = campaign.fixedCost || 0;
      const totalCost = totalCallCost + campaignFixedCost;
      
      // Calculate revenue
      const averageLeadValue = campaign.averageLeadValue || 100; // Default $100 per lead
      const totalRevenue = convertedLeads.length * averageLeadValue;
      
      // Calculate ROI
      const profit = totalRevenue - totalCost;
      const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;
      
      return {
        campaignId,
        campaignName: campaign.name,
        metrics: {
          totalCalls,
          totalDuration: Math.round(totalMinutes),
          totalMinutes: Math.round(totalMinutes),
          convertedLeads: convertedLeads.length,
          conversionRate: totalCalls > 0 ? parseFloat(((convertedLeads.length / totalCalls) * 100).toFixed(2)) : 0
        },
        financial: {
          costPerMinute: parseFloat(costPerMinute.toFixed(2)),
          totalCallCost: parseFloat(totalCallCost.toFixed(2)),
          fixedCost: parseFloat(campaignFixedCost.toFixed(2)),
          totalCost: parseFloat(totalCost.toFixed(2)),
          averageLeadValue: parseFloat(averageLeadValue.toFixed(2)),
          totalRevenue: parseFloat(totalRevenue.toFixed(2)),
          profit: parseFloat(profit.toFixed(2)),
          roi: parseFloat(roi.toFixed(2)),
          costPerLead: convertedLeads.length > 0 
            ? parseFloat((totalCost / convertedLeads.length).toFixed(2)) 
            : 0
        }
      };
    } catch (error) {
      server.log.error(`Error calculating ROI: ${error}`);
      reply.code(500).send({ error: 'Failed to calculate ROI' });
    }
  });

  /**
   * Calculate ROI for all active campaigns
   */
  server.get('/roi/campaigns', async (request, reply) => {
    try {
      // Get collections
      const calls = db.collection('calls');
      const leads = db.collection('leads');
      const campaigns = db.collection('campaigns');
      
      // Get active campaigns
      const activeCampaigns = await campaigns.find({ 
        status: 'active' 
      }).toArray();
      
      if (activeCampaigns.length === 0) {
        return [];
      }
      
      // Calculate ROI for each campaign
      const campaignROIs = await Promise.all(
        activeCampaigns.map(async (campaign) => {
          // Get all calls for this campaign
          const campaignCalls = await calls.find({ 
            campaignId: campaign._id 
          }).toArray();
          
          // Get converted leads for this campaign
          const convertedLeads = await leads.find({
            campaignId: campaign._id,
            status: 'converted'
          }).toArray();
          
          // Calculate metrics
          const totalCalls = campaignCalls.length;
          const totalDuration = campaignCalls.reduce((sum, call) => sum + (call.duration || 0), 0);
          const totalMinutes = totalDuration / 60;
          
          // Calculate costs
          const costPerMinute = campaign.costPerMinute || 0.10;
          const totalCallCost = totalMinutes * costPerMinute;
          
          // Add fixed campaign costs
          const campaignFixedCost = campaign.fixedCost || 0;
          const totalCost = totalCallCost + campaignFixedCost;
          
          // Calculate revenue
          const averageLeadValue = campaign.averageLeadValue || 100;
          const totalRevenue = convertedLeads.length * averageLeadValue;
          
          // Calculate ROI
          const profit = totalRevenue - totalCost;
          const roi = totalCost > 0 ? (profit / totalCost) * 100 : 0;
          
          return {
            campaignId: campaign._id,
            campaignName: campaign.name,
            metrics: {
              totalCalls,
              totalMinutes: Math.round(totalMinutes),
              convertedLeads: convertedLeads.length,
              conversionRate: totalCalls > 0 ? parseFloat(((convertedLeads.length / totalCalls) * 100).toFixed(2)) : 0
            },
            financial: {
              totalCost: parseFloat(totalCost.toFixed(2)),
              totalRevenue: parseFloat(totalRevenue.toFixed(2)),
              profit: parseFloat(profit.toFixed(2)),
              roi: parseFloat(roi.toFixed(2))
            }
          };
        })
      );
      
      // Sort by ROI descending
      campaignROIs.sort((a, b) => b.financial.roi - a.financial.roi);
      
      return campaignROIs;
    } catch (error) {
      server.log.error(`Error calculating campaigns ROI: ${error}`);
      reply.code(500).send({ error: 'Failed to calculate campaigns ROI' });
    }
  });

  /**
   * Calculate ROI projection for a campaign with different parameters
   */
  server.post('/roi/projection', async (request, reply) => {
    try {
      const {
        campaignId,
        costPerMinute,
        averageLeadValue,
        conversionRateAdjustment,
        callVolumeAdjustment,
        fixedCost
      } = request.body as any;
      
      // Get collections
      const calls = db.collection('calls');
      const leads = db.collection('leads');
      const campaigns = db.collection('campaigns');
      
      // Get campaign details
      const campaign = await campaigns.findOne({ _id: new ObjectId(campaignId) }) as ICampaign | null;
      
      if (!campaign) {
        return reply.code(404).send({ error: 'Campaign not found' });
      }
      
      // Get historical campaign data
      const campaignCalls = await calls.find({ 
        campaignId: new ObjectId(campaignId) 
      }).toArray();
      
      const convertedLeads = await leads.countDocuments({
        campaignId: new ObjectId(campaignId),
        status: 'converted'
      });
      
      // Calculate baseline metrics
      const currentCallVolume = campaignCalls.length;
      const currentConversionRate = currentCallVolume > 0 
        ? (convertedLeads / currentCallVolume) 
        : 0;
      
      const avgCallDuration = campaignCalls.length > 0
        ? campaignCalls.reduce((sum, call) => sum + (call.duration || 0), 0) / campaignCalls.length
        : 180; // Default 3 minutes
      
      // Calculate projected metrics
      const projectedCallVolume = Math.round(currentCallVolume * (1 + (callVolumeAdjustment || 0)));
      const projectedConversionRate = Math.max(0, Math.min(1, currentConversionRate * (1 + (conversionRateAdjustment || 0))));
      const projectedConversions = Math.round(projectedCallVolume * projectedConversionRate);
      
      // Calculate financial projections
      const projectedCostPerMinute = costPerMinute || campaign.costPerMinute || 0.10;
      const projectedFixedCost = fixedCost !== undefined ? fixedCost : (campaign.fixedCost || 0);
      const projectedAverageLeadValue = averageLeadValue || campaign.averageLeadValue || 100;
      
      const projectedTotalMinutes = (projectedCallVolume * avgCallDuration) / 60;
      const projectedCallCost = projectedTotalMinutes * projectedCostPerMinute;
      const projectedTotalCost = projectedCallCost + projectedFixedCost;
      
      const projectedRevenue = projectedConversions * projectedAverageLeadValue;
      const projectedProfit = projectedRevenue - projectedTotalCost;
      const projectedROI = projectedTotalCost > 0 ? (projectedProfit / projectedTotalCost) * 100 : 0;
      
      // Return projection
      return {
        campaignId,
        campaignName: campaign.name,
        current: {
          callVolume: currentCallVolume,
          conversionRate: parseFloat((currentConversionRate * 100).toFixed(2)),
          conversions: convertedLeads
        },
        projected: {
          callVolume: projectedCallVolume,
          conversionRate: parseFloat((projectedConversionRate * 100).toFixed(2)),
          conversions: projectedConversions,
          avgCallDuration: Math.round(avgCallDuration),
          totalMinutes: Math.round(projectedTotalMinutes)
        },
        financials: {
          costPerMinute: parseFloat(projectedCostPerMinute.toFixed(2)),
          fixedCost: parseFloat(projectedFixedCost.toFixed(2)),
          callCost: parseFloat(projectedCallCost.toFixed(2)),
          totalCost: parseFloat(projectedTotalCost.toFixed(2)),
          averageLeadValue: parseFloat(projectedAverageLeadValue.toFixed(2)),
          revenue: parseFloat(projectedRevenue.toFixed(2)),
          profit: parseFloat(projectedProfit.toFixed(2)),
          roi: parseFloat(projectedROI.toFixed(2)),
          costPerAcquisition: projectedConversions > 0 
            ? parseFloat((projectedTotalCost / projectedConversions).toFixed(2)) 
            : 0
        }
      };
    } catch (error) {
      server.log.error(`Error calculating ROI projection: ${error}`);
      reply.code(500).send({ error: 'Failed to calculate ROI projection' });
    }
  });
}

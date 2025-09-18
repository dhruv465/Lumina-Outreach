/**
 * Predictive Analytics Routes for Analytics Service
 * 
 * Provides predictive models and forecasting for call performance
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { RedisClientType } from 'redis';
import { Db } from 'mongodb';
import SimpleLinearRegression from 'ml-regression-simple-linear';
import * as math from 'mathjs';
import { Server, IncomingMessage, ServerResponse } from 'http';

export function registerPredictiveRoutes(
  server: FastifyInstance<Server, IncomingMessage, ServerResponse, any, any>,
  db: Db,
  redisClient: RedisClientType
) {
  /**
   * Predict conversion probability based on call characteristics
   */
  server.post('/predictive/conversion', async (request, reply) => {
    try {
      const {
        duration,
        customerSpeakingRatio,
        interruptions,
        qualityScore,
        latency,
        scriptAdherence,
        emotion,
        timeOfDay,
        dayOfWeek
      } = request.body as any;
      
      // Simplified logistic regression model
      // In a real implementation, this would use a trained ML model
      
      // Base conversion rate from historical data
      const baseConversionRate = 0.15; // 15%
      
      // Adjust based on factors (these weights would come from an actual trained model)
      let adjustedScore = baseConversionRate;
      
      // Duration factor (longer calls up to a point are better)
      if (duration > 120 && duration < 600) {
        adjustedScore += 0.05;
      } else if (duration > 600) {
        adjustedScore -= 0.03;
      }
      
      // Customer speaking ratio (closer to 50/50 is better)
      const optimalRatio = 0.5;
      const ratioDiff = Math.abs(customerSpeakingRatio - optimalRatio);
      adjustedScore -= ratioDiff * 0.2;
      
      // Fewer interruptions are better
      if (interruptions < 2) {
        adjustedScore += 0.03;
      } else if (interruptions > 5) {
        adjustedScore -= 0.05;
      }
      
      // Quality score impact
      adjustedScore += (qualityScore - 70) * 0.005;
      
      // Low latency is better
      if (latency < 100) {
        adjustedScore += 0.02;
      } else if (latency > 300) {
        adjustedScore -= 0.03;
      }
      
      // Script adherence
      adjustedScore += (scriptAdherence - 80) * 0.003;
      
      // Emotion factor
      if (emotion === 'positive' || emotion === 'interested') {
        adjustedScore += 0.08;
      } else if (emotion === 'negative') {
        adjustedScore -= 0.1;
      }
      
      // Time of day factor (just examples, would be data-driven)
      if (timeOfDay >= 9 && timeOfDay <= 11) {
        adjustedScore += 0.02; // Morning calls
      } else if (timeOfDay >= 14 && timeOfDay <= 16) {
        adjustedScore += 0.01; // Afternoon calls
      }
      
      // Day of week factor
      if (dayOfWeek === 2 || dayOfWeek === 3) {
        adjustedScore += 0.02; // Tuesday or Wednesday
      } else if (dayOfWeek === 6 || dayOfWeek === 0) {
        adjustedScore -= 0.01; // Saturday or Sunday
      }
      
      // Ensure the score is between 0 and 1
      const predictionScore = Math.max(0, Math.min(1, adjustedScore));
      
      return {
        conversionProbability: predictionScore,
        factors: {
          durationImpact: duration > 120 && duration < 600 ? 'positive' : (duration > 600 ? 'negative' : 'neutral'),
          speakingRatioImpact: ratioDiff < 0.1 ? 'positive' : (ratioDiff > 0.3 ? 'negative' : 'neutral'),
          interruptionsImpact: interruptions < 2 ? 'positive' : (interruptions > 5 ? 'negative' : 'neutral'),
          qualityScoreImpact: qualityScore > 70 ? 'positive' : 'negative',
          latencyImpact: latency < 100 ? 'positive' : (latency > 300 ? 'negative' : 'neutral'),
          emotionImpact: emotion === 'positive' || emotion === 'interested' ? 'positive' : (emotion === 'negative' ? 'negative' : 'neutral'),
          timeImpact: (timeOfDay >= 9 && timeOfDay <= 11) || (timeOfDay >= 14 && timeOfDay <= 16) ? 'positive' : 'neutral',
          dayImpact: (dayOfWeek === 2 || dayOfWeek === 3) ? 'positive' : ((dayOfWeek === 6 || dayOfWeek === 0) ? 'negative' : 'neutral')
        }
      };
    } catch (error) {
      server.log.error(`Error predicting conversion: ${error}`);
      reply.code(500).send({ error: 'Failed to predict conversion' });
    }
  });

  /**
   * Get optimal calling times based on historical performance
   */
  server.get('/predictive/optimal-calling-times', async (request, reply) => {
    try {
      // Get calls collection
      const calls = db.collection('calls');
      
      // Determine date range - last 30 days
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      
      // Aggregate calls by hour and day to find optimal times
      const optimalTimes = await calls.aggregate([
        {
          $match: {
            startTime: { $gte: thirtyDaysAgo },
            status: 'completed'
          }
        },
        {
          $group: {
            _id: {
              hour: { $hour: '$startTime' },
              day: { $dayOfWeek: '$startTime' }
            },
            totalCalls: { $sum: 1 },
            conversions: {
              $sum: {
                $cond: [{ $eq: ['$outcome', 'converted'] }, 1, 0]
              }
            },
            avgDuration: { $avg: '$duration' },
            avgQualityScore: { $avg: '$qualityScore' }
          }
        },
        {
          $project: {
            hour: '$_id.hour',
            day: '$_id.day',
            totalCalls: 1,
            conversions: 1,
            conversionRate: {
              $multiply: [
                { $divide: ['$conversions', '$totalCalls'] },
                100
              ]
            },
            avgDuration: 1,
            avgQualityScore: 1
          }
        },
        {
          $sort: { conversionRate: -1 }
        },
        {
          $limit: 10
        }
      ]).toArray();
      
      // Convert day numbers to names
      const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
      
      const formattedResults = optimalTimes.map(time => ({
        ...time,
        dayName: dayNames[time.day % 7],
        conversionRate: parseFloat(time.conversionRate.toFixed(2)),
        avgDuration: Math.round(time.avgDuration || 0),
        avgQualityScore: parseFloat((time.avgQualityScore || 0).toFixed(2))
      }));
      
      return formattedResults;
    } catch (error) {
      server.log.error(`Error calculating optimal calling times: ${error}`);
      reply.code(500).send({ error: 'Failed to calculate optimal calling times' });
    }
  });

  /**
   * Forecast call volume and conversions for the next week
   */
  server.get('/predictive/forecast', async (request, reply) => {
    try {
      // Get calls collection
      const calls = db.collection('calls');
      
      // Get historical data for the past 4 weeks
      const fourWeeksAgo = new Date();
      fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
      
      // Aggregate daily call volume and conversions
      const dailyStats = await calls.aggregate([
        {
          $match: {
            startTime: { $gte: fourWeeksAgo }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$startTime' },
              month: { $month: '$startTime' },
              day: { $dayOfMonth: '$startTime' },
              dayOfWeek: { $dayOfWeek: '$startTime' }
            },
            callVolume: { $sum: 1 },
            conversions: {
              $sum: {
                $cond: [{ $eq: ['$outcome', 'converted'] }, 1, 0]
              }
            }
          }
        },
        {
          $sort: {
            '_id.year': 1,
            '_id.month': 1,
            '_id.day': 1
          }
        }
      ]).toArray();
      
      // Prepare data for the linear regression model
      // Group by day of week to identify weekly patterns
      const dayOfWeekStats: Record<number, any[]> = {};
      
      dailyStats.forEach(day => {
        const dayOfWeek = day._id.dayOfWeek;
        if (!dayOfWeekStats[dayOfWeek]) {
          dayOfWeekStats[dayOfWeek] = [];
        }
        dayOfWeekStats[dayOfWeek].push({
          day: new Date(day._id.year, day._id.month - 1, day._id.day).getTime(),
          callVolume: day.callVolume,
          conversions: day.conversions
        });
      });
      
      // Create forecasts for each day of the week
      const forecast = [];
      const today = new Date();
      
      for (let i = 1; i <= 7; i++) {
        const forecastDate = new Date(today);
        forecastDate.setDate(today.getDate() + i);
        const dayOfWeek = forecastDate.getDay() + 1; // 1-based day of week
        
        // Get historical data for this day of week
        const dayData = dayOfWeekStats[dayOfWeek] || [];
        
        let predictedVolume = 0;
        let predictedConversions = 0;
        
        if (dayData.length >= 2) {
          // Use linear regression to predict call volume
          const xVolume = dayData.map((d, idx) => idx + 1); // Simple sequence
          const yVolume = dayData.map(d => d.callVolume);
          
          const xConversions = dayData.map((d, idx) => idx + 1);
          const yConversions = dayData.map(d => d.conversions);
          
          try {
            const volumeRegression = new SimpleLinearRegression(xVolume, yVolume);
            const conversionRegression = new SimpleLinearRegression(xConversions, yConversions);
            
            // Predict for the next occurrence (next week)
            const volumePrediction = volumeRegression.predict(dayData.length + 1);
            const conversionPrediction = conversionRegression.predict(dayData.length + 1);
            
            predictedVolume = Math.max(0, Math.round(Array.isArray(volumePrediction) ? volumePrediction[0] : volumePrediction));
            predictedConversions = Math.max(0, Math.round(Array.isArray(conversionPrediction) ? conversionPrediction[0] : conversionPrediction));
          } catch (e) {
            // Fallback to average if regression fails
            const avgVolume = yVolume.reduce((sum, val) => sum + val, 0) / yVolume.length;
            const avgConversions = yConversions.reduce((sum, val) => sum + val, 0) / yConversions.length;
            predictedVolume = Math.round(avgVolume);
            predictedConversions = Math.round(avgConversions);
          }
        } else if (dayData.length === 1) {
          // Use the single data point if only one exists
          predictedVolume = dayData[0].callVolume;
          predictedConversions = dayData[0].conversions;
        } else {
          // No data for this day, use overall average
          const allCallVolumes = dailyStats.map(d => d.callVolume);
          const allConversions = dailyStats.map(d => d.conversions);
          
          predictedVolume = Math.round(allCallVolumes.reduce((sum, val) => sum + val, 0) / allCallVolumes.length || 0);
          predictedConversions = Math.round(allConversions.reduce((sum, val) => sum + val, 0) / allConversions.length || 0);
        }
        
        forecast.push({
          date: forecastDate.toISOString().split('T')[0],
          dayOfWeek: dayOfWeek,
          dayName: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][forecastDate.getDay()],
          predictedCallVolume: predictedVolume,
          predictedConversions: predictedConversions,
          predictedConversionRate: predictedVolume > 0 
            ? parseFloat(((predictedConversions / predictedVolume) * 100).toFixed(2)) 
            : 0,
          confidence: dayData.length > 3 ? 'high' : (dayData.length > 1 ? 'medium' : 'low')
        });
      }
      
      return {
        period: {
          start: forecast[0].date,
          end: forecast[6].date,
        },
        forecast
      };
    } catch (error) {
      server.log.error(`Error generating forecast: ${error}`);
      reply.code(500).send({ error: 'Failed to generate forecast' });
    }
  });
}

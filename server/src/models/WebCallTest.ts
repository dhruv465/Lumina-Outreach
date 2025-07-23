import mongoose from 'mongoose';
import logger from '../utils/logger';

export interface IWebCallTest extends mongoose.Document {
  campaignId: mongoose.Schema.Types.ObjectId;
  userId: mongoose.Schema.Types.ObjectId;
  startTime: Date;
  endTime: Date;
  duration: number;
  transcript: {
    speaker: 'agent' | 'user';
    text: string;
    timestamp: Date;
    isFinal: boolean;
  }[];
  metrics: {
    responseTime: {
      avg: number;
      min: number;
      max: number;
    };
    userSpeakingTime: number;
    agentSpeakingTime: number;
    interruptions: number;
    speechToTextLatency: number;
    textToSpeechLatency: number;
    llmLatency: number;
  };
  agentResponses: {
    input: string;
    response: string;
    responseTime: number;
    timestamp: Date;
  }[];
  analysis?: {
    evaluations?: {
      turnIndex: number;
      userInput: string;
      agentResponse: string;
      scores: {
        relevance: number;
        clarity: number;
        helpfulness: number;
        adherenceToPrompt: number;
        overall: number;
      };
      feedback: string;
      strengths: string[];
      weaknesses: string[];
    }[];
    comparison?: {
      matchPercentage: number;
      deviations: {
        description: string;
        severity: 'low' | 'medium' | 'high';
        impact: string;
      }[];
    };
    recommendations?: {
      items: {
        area: string;
        description: string;
        priority: 'low' | 'medium' | 'high';
        suggestedAction: string;
      }[];
      systemPromptSuggestions: string;
    };
  };
  status: 'completed' | 'error' | 'terminated';
  errorDetails?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface WebCallTestCreateOptions {
  campaignId: string | mongoose.Types.ObjectId;
  userId: string | mongoose.Types.ObjectId;
  startTime?: Date;
  initialTranscript?: {
    speaker: 'agent' | 'user';
    text: string;
    timestamp?: Date;
    isFinal?: boolean;
  }[];
}

export interface WebCallTestQueryOptions {
  campaignId?: string | mongoose.Types.ObjectId;
  userId?: string | mongoose.Types.ObjectId;
  startDate?: Date;
  endDate?: Date;
  status?: 'completed' | 'error' | 'terminated';
  limit?: number;
  skip?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

export interface WebCallTestMetricsResult {
  totalTests: number;
  averageDuration: number;
  averageResponseTime: number;
  averageUserSpeakingTime: number;
  averageAgentSpeakingTime: number;
  averageInterruptions: number;
  averageTurns: number;
  averageSpeechToTextLatency: number;
  averageTextToSpeechLatency: number;
  averageLlmLatency: number;
}

const WebCallTestSchema = new mongoose.Schema(
  {
    campaignId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Campaign',
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    startTime: {
      type: Date,
      required: true,
    },
    endTime: {
      type: Date,
    },
    duration: {
      type: Number,
    },
    transcript: [
      {
        speaker: {
          type: String,
          enum: ['agent', 'user'],
          required: true,
        },
        text: {
          type: String,
          required: true,
        },
        timestamp: {
          type: Date,
          required: true,
        },
        isFinal: {
          type: Boolean,
          default: true,
        },
      },
    ],
    metrics: {
      responseTime: {
        avg: Number,
        min: Number,
        max: Number,
      },
      userSpeakingTime: Number,
      agentSpeakingTime: Number,
      interruptions: Number,
      speechToTextLatency: Number,
      textToSpeechLatency: Number,
      llmLatency: Number,
    },
    agentResponses: [
      {
        input: String,
        response: String,
        responseTime: Number,
        timestamp: Date,
      },
    ],
    analysis: {
      evaluations: [
        {
          turnIndex: Number,
          userInput: String,
          agentResponse: String,
          scores: {
            relevance: Number,
            clarity: Number,
            helpfulness: Number,
            adherenceToPrompt: Number,
            overall: Number
          },
          feedback: String,
          strengths: [String],
          weaknesses: [String]
        }
      ],
      comparison: {
        matchPercentage: Number,
        deviations: [
          {
            description: String,
            severity: {
              type: String,
              enum: ['low', 'medium', 'high']
            },
            impact: String
          }
        ]
      },
      recommendations: {
        items: [
          {
            area: String,
            description: String,
            priority: {
              type: String,
              enum: ['low', 'medium', 'high']
            },
            suggestedAction: String
          }
        ],
        systemPromptSuggestions: String
      }
    },
    status: {
      type: String,
      enum: ['completed', 'error', 'terminated'],
      default: 'completed',
    },
    errorDetails: String,
  },
  { timestamps: true }
);

// Static methods for creating and retrieving tests

/**
 * Create a new web call test record
 * @param options Options for creating the test
 * @returns The created test record
 */
WebCallTestSchema.statics.createTest = async function(options: WebCallTestCreateOptions): Promise<IWebCallTest> {
  try {
    const { campaignId, userId, startTime = new Date(), initialTranscript = [] } = options;
    
    // Create the test record
    const test = new this({
      campaignId: campaignId,
      userId: userId,
      startTime,
      status: 'completed',
      transcript: initialTranscript.map(entry => ({
        ...entry,
        timestamp: entry.timestamp || new Date(),
        isFinal: entry.isFinal !== undefined ? entry.isFinal : true
      })),
      metrics: {
        responseTime: {
          avg: 0,
          min: 0,
          max: 0
        },
        userSpeakingTime: 0,
        agentSpeakingTime: 0,
        interruptions: 0,
        speechToTextLatency: 0,
        textToSpeechLatency: 0,
        llmLatency: 0
      },
      agentResponses: []
    });
    
    await test.save();
    logger.info(`Created new WebCallTest record with ID: ${test._id}`);
    
    return test;
  } catch (error) {
    logger.error(`Error creating WebCallTest: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

/**
 * Find tests by query options
 * @param options Query options
 * @returns Array of matching test records
 */
WebCallTestSchema.statics.findTests = async function(options: WebCallTestQueryOptions = {}): Promise<IWebCallTest[]> {
  try {
    const {
      campaignId,
      userId,
      startDate,
      endDate,
      status,
      limit = 50,
      skip = 0,
      sortBy = 'startTime',
      sortDirection = 'desc'
    } = options;
    
    // Build query
    const query: any = {};
    
    if (campaignId) {
      query.campaignId = campaignId;
    }
    
    if (userId) {
      query.userId = userId;
    }
    
    if (startDate || endDate) {
      query.startTime = {};
      
      if (startDate) {
        query.startTime.$gte = startDate;
      }
      
      if (endDate) {
        query.startTime.$lte = endDate;
      }
    }
    
    if (status) {
      query.status = status;
    }
    
    // Execute query
    const sortOrder = sortDirection === 'asc' ? 1 : -1;
    const tests = await this.find(query)
      .sort({ [sortBy]: sortOrder })
      .skip(skip)
      .limit(limit)
      .exec();
    
    return tests;
  } catch (error) {
    logger.error(`Error finding WebCallTests: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

/**
 * Get test by ID with campaign and user details
 * @param testId The test ID
 * @returns The test record with populated references
 */
WebCallTestSchema.statics.getTestWithDetails = async function(testId: string): Promise<IWebCallTest | null> {
  try {
    const test = await this.findById(testId)
      .populate('campaignId', 'name systemPrompt voiceId')
      .populate('userId', 'name email')
      .exec();
    
    return test;
  } catch (error) {
    logger.error(`Error getting WebCallTest details: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

/**
 * Calculate metrics for a campaign
 * @param campaignId The campaign ID
 * @returns Aggregated metrics for the campaign
 */
WebCallTestSchema.statics.calculateCampaignMetrics = async function(campaignId: string): Promise<WebCallTestMetricsResult> {
  try {
    const pipeline = [
      {
        $match: {
          campaignId: new mongoose.Types.ObjectId(campaignId),
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalTests: { $sum: 1 },
          totalDuration: { $sum: '$duration' },
          totalResponseTime: { $sum: '$metrics.responseTime.avg' },
          totalUserSpeakingTime: { $sum: '$metrics.userSpeakingTime' },
          totalAgentSpeakingTime: { $sum: '$metrics.agentSpeakingTime' },
          totalInterruptions: { $sum: '$metrics.interruptions' },
          totalSpeechToTextLatency: { $sum: '$metrics.speechToTextLatency' },
          totalTextToSpeechLatency: { $sum: '$metrics.textToSpeechLatency' },
          totalLlmLatency: { $sum: '$metrics.llmLatency' },
          totalTurns: { $sum: { $size: '$transcript' } }
        }
      },
      {
        $project: {
          _id: 0,
          totalTests: 1,
          averageDuration: { $divide: ['$totalDuration', '$totalTests'] },
          averageResponseTime: { $divide: ['$totalResponseTime', '$totalTests'] },
          averageUserSpeakingTime: { $divide: ['$totalUserSpeakingTime', '$totalTests'] },
          averageAgentSpeakingTime: { $divide: ['$totalAgentSpeakingTime', '$totalTests'] },
          averageInterruptions: { $divide: ['$totalInterruptions', '$totalTests'] },
          averageTurns: { $divide: ['$totalTurns', '$totalTests'] },
          averageSpeechToTextLatency: { $divide: ['$totalSpeechToTextLatency', '$totalTests'] },
          averageTextToSpeechLatency: { $divide: ['$totalTextToSpeechLatency', '$totalTests'] },
          averageLlmLatency: { $divide: ['$totalLlmLatency', '$totalTests'] }
        }
      }
    ];
    
    const results = await this.aggregate(pipeline).exec();
    
    if (results.length === 0) {
      return {
        totalTests: 0,
        averageDuration: 0,
        averageResponseTime: 0,
        averageUserSpeakingTime: 0,
        averageAgentSpeakingTime: 0,
        averageInterruptions: 0,
        averageTurns: 0,
        averageSpeechToTextLatency: 0,
        averageTextToSpeechLatency: 0,
        averageLlmLatency: 0
      };
    }
    
    return results[0];
  } catch (error) {
    logger.error(`Error calculating campaign metrics: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

/**
 * Calculate metrics for a user
 * @param userId The user ID
 * @returns Aggregated metrics for the user
 */
WebCallTestSchema.statics.calculateUserMetrics = async function(userId: string): Promise<WebCallTestMetricsResult> {
  try {
    const pipeline = [
      {
        $match: {
          userId: new mongoose.Types.ObjectId(userId),
          status: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          totalTests: { $sum: 1 },
          totalDuration: { $sum: '$duration' },
          totalResponseTime: { $sum: '$metrics.responseTime.avg' },
          totalUserSpeakingTime: { $sum: '$metrics.userSpeakingTime' },
          totalAgentSpeakingTime: { $sum: '$metrics.agentSpeakingTime' },
          totalInterruptions: { $sum: '$metrics.interruptions' },
          totalSpeechToTextLatency: { $sum: '$metrics.speechToTextLatency' },
          totalTextToSpeechLatency: { $sum: '$metrics.textToSpeechLatency' },
          totalLlmLatency: { $sum: '$metrics.llmLatency' },
          totalTurns: { $sum: { $size: '$transcript' } }
        }
      },
      {
        $project: {
          _id: 0,
          totalTests: 1,
          averageDuration: { $divide: ['$totalDuration', '$totalTests'] },
          averageResponseTime: { $divide: ['$totalResponseTime', '$totalTests'] },
          averageUserSpeakingTime: { $divide: ['$totalUserSpeakingTime', '$totalTests'] },
          averageAgentSpeakingTime: { $divide: ['$totalAgentSpeakingTime', '$totalTests'] },
          averageInterruptions: { $divide: ['$totalInterruptions', '$totalTests'] },
          averageTurns: { $divide: ['$totalTurns', '$totalTests'] },
          averageSpeechToTextLatency: { $divide: ['$totalSpeechToTextLatency', '$totalTests'] },
          averageTextToSpeechLatency: { $divide: ['$totalTextToSpeechLatency', '$totalTests'] },
          averageLlmLatency: { $divide: ['$totalLlmLatency', '$totalTests'] }
        }
      }
    ];
    
    const results = await this.aggregate(pipeline).exec();
    
    if (results.length === 0) {
      return {
        totalTests: 0,
        averageDuration: 0,
        averageResponseTime: 0,
        averageUserSpeakingTime: 0,
        averageAgentSpeakingTime: 0,
        averageInterruptions: 0,
        averageTurns: 0,
        averageSpeechToTextLatency: 0,
        averageTextToSpeechLatency: 0,
        averageLlmLatency: 0
      };
    }
    
    return results[0];
  } catch (error) {
    logger.error(`Error calculating user metrics: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

// Instance methods

/**
 * Calculate metrics for this test
 * Updates the metrics fields based on transcript and agent responses
 */
WebCallTestSchema.methods.calculateMetrics = async function(): Promise<void> {
  try {
    // Calculate duration if start and end times are available
    if (this.startTime && this.endTime) {
      this.duration = this.endTime.getTime() - this.startTime.getTime();
    }
    
    // Calculate response time metrics
    const responseTimes = this.agentResponses.map(r => r.responseTime).filter(t => t > 0);
    if (responseTimes.length > 0) {
      this.metrics.responseTime.avg = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
      this.metrics.responseTime.min = Math.min(...responseTimes);
      this.metrics.responseTime.max = Math.max(...responseTimes);
    }
    
    // Count turns by speaker
    const userTurns = this.transcript.filter(t => t.speaker === 'user').length;
    const agentTurns = this.transcript.filter(t => t.speaker === 'agent').length;
    
    // Save the updated metrics
    await this.save();
    
    logger.debug(`Calculated metrics for WebCallTest ${this._id}`);
  } catch (error) {
    logger.error(`Error calculating metrics for WebCallTest ${this._id}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

/**
 * Add a transcript entry to the test
 * @param entry The transcript entry to add
 */
WebCallTestSchema.methods.addTranscriptEntry = async function(entry: {
  speaker: 'agent' | 'user';
  text: string;
  timestamp?: Date;
  isFinal?: boolean;
}): Promise<void> {
  try {
    const transcriptEntry = {
      ...entry,
      timestamp: entry.timestamp || new Date(),
      isFinal: entry.isFinal !== undefined ? entry.isFinal : true
    };
    
    this.transcript.push(transcriptEntry);
    
    // If this is an agent response, also add to agentResponses
    if (entry.speaker === 'agent') {
      // Find the last user input if available
      const lastUserInput = [...this.transcript]
        .reverse()
        .find(t => t.speaker === 'user')?.text || '';
      
      this.agentResponses.push({
        input: lastUserInput,
        response: entry.text,
        responseTime: 0, // This would need to be updated separately
        timestamp: transcriptEntry.timestamp
      });
    }
    
    await this.save();
  } catch (error) {
    logger.error(`Error adding transcript entry to WebCallTest ${this._id}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

/**
 * Update the test status
 * @param status The new status
 * @param errorDetails Optional error details if status is 'error'
 */
WebCallTestSchema.methods.updateStatus = async function(
  status: 'completed' | 'error' | 'terminated',
  errorDetails?: string
): Promise<void> {
  try {
    this.status = status;
    
    if (status === 'error' && errorDetails) {
      this.errorDetails = errorDetails;
    }
    
    if (status === 'completed' || status === 'terminated') {
      // Set end time if not already set
      if (!this.endTime) {
        this.endTime = new Date();
      }
      
      // Calculate duration
      if (this.startTime && this.endTime) {
        this.duration = this.endTime.getTime() - this.startTime.getTime();
      }
    }
    
    await this.save();
  } catch (error) {
    logger.error(`Error updating status for WebCallTest ${this._id}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
};

const WebCallTest = mongoose.model<IWebCallTest>('WebCallTest', WebCallTestSchema);

export default WebCallTest;
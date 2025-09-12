import { EnhancedVoiceAIService, VoicePersonality } from './enhancedVoiceAIService';
import SpeechAnalysisService, { SpeechAnalysis, ConversationContext } from './speechAnalysisService';
import { LLMService } from './llm/service';
import { LLMConfig, LLMProvider, LLMMessage } from './llm/types';
import { logger, getErrorMessage } from '../index';
import { v4 as uuidv4 } from 'uuid';
import Configuration from '../models/Configuration';

export interface ConversationTurn {
  id: string;
  timestamp: Date;
  speaker: 'agent' | 'customer';
  content: string;
  analysis?: SpeechAnalysis;
  voicePersonality?: VoicePersonality;
}

export interface CallSession {
  id: string;
  leadId: string;
  campaignId: string;
  startTime: Date;
  language: 'English' | 'Hindi';
  currentPersonality: VoicePersonality;
  conversationHistory: ConversationTurn[];
  context: ConversationContext;
  status: 'active' | 'paused' | 'completed' | 'failed';
  openingMessageSent?: boolean; // Track if opening message was already sent
  metrics: {
    totalTurns: number;
    personalityChanges: number;
  };
  llmProvider?: LLMProvider;
}

export class ConversationEngineService {
  private voiceAI: EnhancedVoiceAIService;
  private speechAnalysis: SpeechAnalysisService;
  private llmService: LLMService;
  private activeSessions: Map<string, CallSession> = new Map();

  constructor(voiceAI: EnhancedVoiceAIService, speechAnalysis: SpeechAnalysisService, llmService: LLMService) {
    this.voiceAI = voiceAI;
    this.speechAnalysis = speechAnalysis;
    this.llmService = llmService;
    
    // LLM service is now initialized with values from configuration in index.ts
    // when the service is instantiated, so we don't need to configure it here
  }

  // Create a new conversation session
  async createSession(
    leadId: string,
    campaignId: string,
    language: 'English' | 'Hindi' = 'English',
    personalityId?: string,
    llmProvider?: LLMProvider
  ): Promise<CallSession> {
    try {
      const sessionId = uuidv4();
      
      // Get or create voice personality
      let personality: VoicePersonality;
      if (personalityId) {
        const configuration = await Configuration.findOne();
        const voiceSettings = configuration?.voiceAIConfig?.conversationalAI?.voiceSettings || {
          speed: 1.0,
          stability: 0.75,
          style: 0.0
        };
        personality = {
          id: uuidv4(),
          name: 'Dynamic Agent',
          description: 'A dynamically created agent',
          voiceId: personalityId,
          personality: 'professional',
          style: 'conversational',
          settings: {
            stability: voiceSettings.stability,
            similarityBoost: 0.75,
            style: voiceSettings.style,
            useSpeakerBoost: true
          },
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      } else {
        // Get configuration for voice settings
        const configuration = await Configuration.findOne();
        const voiceSettings = configuration?.voiceAIConfig?.conversationalAI?.voiceSettings || {
          speed: 1.0,
          stability: 0.75,
          style: 0.0
        };
        
        // Create default personality with configuration settings
        personality = {
          id: uuidv4(),
          name: 'Default Agent',
          description: 'Professional and friendly customer service agent',
          voiceId: configuration?.voiceAIConfig?.conversationalAI?.defaultVoiceId || 'default',
          personality: 'professional',
          style: 'conversational',
          settings: {
            stability: voiceSettings.stability,
            similarityBoost: 0.75,
            style: voiceSettings.style,
            useSpeakerBoost: true
          },
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }

      logger.info(`🔧 Session Creation Debug - personalityId: ${personalityId}`);
      logger.info(`🔧 Session Creation Debug - personality.voiceId: ${personality.voiceId}`);
      logger.info(`🔧 Session Creation Debug - personality.name: ${personality.name}`);

      const session: CallSession = {
        id: sessionId,
        leadId,
        campaignId,
        startTime: new Date(),
        language,
        currentPersonality: personality,
        conversationHistory: [],
        context: {
          currentTurn: 0,
          customerProfile: {
            mood: 'neutral',
            interests: [],
            objections: [],
            engagement_level: 0.5
          },
          callObjective: 'general_inquiry',
          progress: {
            stage: 'opening',
            completed_objectives: [],
            next_steps: []
          }
        },
        status: 'active',
        openingMessageSent: false, // Initialize opening message flag
        metrics: {
          totalTurns: 0,
          personalityChanges: 0
        },
        llmProvider
      };

      this.activeSessions.set(sessionId, session);
      logger.info(`Created conversation session: ${sessionId}`);
      return session;
    } catch (error) {
      logger.error('Error creating conversation session:', getErrorMessage(error));
      throw error;
    }
  }

  // Create a session with a specific conversation ID for persistence
  async createSessionWithId(
    conversationId: string,
    leadId: string,
    campaignId: string,
    personalityId?: string,
    language: 'English' | 'Hindi' = 'English',
    llmProvider?: LLMProvider
  ): Promise<boolean> {
    try {
      // Check if session already exists
      if (this.activeSessions.has(conversationId)) {
        logger.warn(`Session with ID ${conversationId} already exists`);
        return true;
      }

      // Get configuration for proper voice settings
      const configuration = await Configuration.findOne();
      const voiceSettings = configuration?.voiceAIConfig?.conversationalAI?.voiceSettings || {
        speed: 1.0,
        stability: 0.75,
        style: 0.0
      };

      // Get or create voice personality
      let personality: VoicePersonality;
      if (personalityId) {
        const matchingVoice = configuration?.elevenLabsConfig?.availableVoices?.find(
          voice => voice.voiceId === personalityId
        );
        
        personality = {
          id: uuidv4(),
          name: matchingVoice?.name || 'Dynamic Agent',
          description: 'A dynamically created agent',
          voiceId: personalityId,
          personality: 'professional',
          style: 'conversational',
          settings: {
            stability: voiceSettings.stability,
            similarityBoost: 0.75,
            style: voiceSettings.style,
            useSpeakerBoost: true
          },
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      } else {
        // Create default personality with configuration settings
        personality = {
          id: uuidv4(),
          name: 'Default Agent',
          description: 'Professional and friendly customer service agent',
          voiceId: configuration?.voiceAIConfig?.conversationalAI?.defaultVoiceId || 'default',
          personality: 'professional',
          style: 'conversational',
          settings: {
            stability: voiceSettings.stability,
            similarityBoost: 0.75,
            style: voiceSettings.style,
            useSpeakerBoost: true
          },
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        };
      }

      const session: CallSession = {
        id: conversationId, // Use the provided conversationId
        leadId,
        campaignId,
        startTime: new Date(),
        language,
        currentPersonality: personality,
        conversationHistory: [],
        context: {
          currentTurn: 0,
          customerProfile: {
            mood: 'neutral',
            interests: [],
            objections: [],
            engagement_level: 0.5
          },
          callObjective: 'general_inquiry',
          progress: {
            stage: 'opening',
            completed_objectives: [],
            next_steps: []
          }
        },
        status: 'active',
        openingMessageSent: false, // Initialize opening message flag
        metrics: {
          totalTurns: 0,
          personalityChanges: 0
        },
        llmProvider
      };

      this.activeSessions.set(conversationId, session);
      logger.info(`Created conversation session with persistent ID: ${conversationId}`);
      return true;
    } catch (error) {
      logger.error(`Error creating conversation session with ID ${conversationId}:`, getErrorMessage(error));
      return false;
    }
  }

  /**
   * Get the speech analysis service instance
   * Used by controllers that need direct access to transcription capabilities
   */
  getSpeechAnalysisService(): SpeechAnalysisService {
    return this.speechAnalysis;
  }

  // Process user input and generate response
  async processConversationTurn(
    sessionId: string,
    userInput: string,
    audioData?: string
  ): Promise<{
    response: string;
    audioUrl?: string;
    sessionUpdate: CallSession;
  }> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      // Get configuration for system prompt and other settings
      const configuration = await Configuration.findOne();
      if (!configuration) {
        throw new Error("System configuration not found. Please set up your system configuration first.");
      }

      // Analyze speech if audio data provided
      let speechAnalysis: SpeechAnalysis | undefined;
      if (audioData) {
        speechAnalysis = await this.speechAnalysis.analyzeSpeech(audioData, session.context);
      }

      // Add user turn to conversation
      const userTurn: ConversationTurn = {
        id: uuidv4(),
        timestamp: new Date(),
        speaker: 'customer',
        content: userInput,
        analysis: speechAnalysis,
        voicePersonality: session.currentPersonality
      };

      session.conversationHistory.push(userTurn);
      session.metrics.totalTurns++;

      // Get campaign with system prompt
      const Campaign = require('../models/Campaign').default;
      const campaign = await Campaign.findById(session.campaignId);
      
      // Add system prompt to the campaign's LLM configuration if not already present
      if (campaign && configuration.generalSettings.defaultSystemPrompt) {
        if (!campaign.llmConfiguration) {
          campaign.llmConfiguration = {};
        }
        if (!campaign.llmConfiguration.systemPrompt) {
          campaign.llmConfiguration.systemPrompt = configuration.generalSettings.defaultSystemPrompt;
          // Save the campaign with the system prompt
          await campaign.save();
          logger.info(`Updated campaign ${session.campaignId} with system prompt from configuration`);
        }
      }

      // Generate response using voice AI
      const response = await this.voiceAI.generateResponse({
        userInput: userInput,
        conversationLog: session.conversationHistory.map(turn => ({
          role: turn.speaker === 'agent' ? 'assistant' : 'user',
          content: turn.content,
          timestamp: turn.timestamp
        })),
        leadId: session.leadId,
        campaignId: session.campaignId,
        callContext: {
          complianceComplete: true,
          disclosureComplete: true,
          currentPhase: session.context.progress.stage,
          language: session.language
        }
      });

      // Generate audio using voice synthesis
      const audioUrl = await this.voiceAI.synthesizeVoice({
        text: response.text,
        personalityId: session.currentPersonality.id,
        language: session.language
      });

      // Add agent turn to conversation
      const agentTurn: ConversationTurn = {
        id: uuidv4(),
        timestamp: new Date(),
        speaker: 'agent',
        content: response.text,
        voicePersonality: session.currentPersonality
      };

      session.conversationHistory.push(agentTurn);
      session.metrics.totalTurns++;

      // Update session
      this.activeSessions.set(sessionId, session);

      return {
        response: response.text,
        audioUrl,
        sessionUpdate: session
      };
    } catch (error) {
      logger.error('Error processing conversation turn:', getErrorMessage(error));
      throw error;
    }
  }

  // Get session information
  getSession(sessionId: string): CallSession | undefined {
    return this.activeSessions.get(sessionId);
  }

  // End conversation session
  async endSession(sessionId: string): Promise<CallSession | null> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        return null;
      }

      session.status = 'completed';
      this.activeSessions.delete(sessionId);
      
      logger.info(`Ended conversation session: ${sessionId}`);
      return session;
    } catch (error) {
      logger.error('Error ending conversation session:', getErrorMessage(error));
      throw error;
    }
  }

  // Get all active sessions
  getActiveSessions(): CallSession[] {
    return Array.from(this.activeSessions.values());
  }

  // Update session personality
  async updateSessionPersonality(sessionId: string, personalityId: string): Promise<CallSession | null> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        return null;
      }

      const newPersonality = await this.voiceAI.getPersonality(personalityId);
      session.currentPersonality = newPersonality;
      session.metrics.personalityChanges++;

      this.activeSessions.set(sessionId, session);
      return session;
    } catch (error) {
      logger.error('Error updating session personality:', getErrorMessage(error));
      throw error;
    }
  }

  // Generate opening message for a conversation
  async generateOpeningMessage(
    sessionId: string,
    leadName: string,
    campaignName: string
  ): Promise<string> {
    try {
      const session = this.activeSessions.get(sessionId);
      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const { campaignId } = session;
      
      // Load campaign data to get the opening message
      const Campaign = require('../models/Campaign').default;
      const campaign = await Campaign.findById(campaignId);
      
      if (!campaign) {
        throw new Error(`Campaign not found: ${campaignId}`);
      }

      if (campaign.openingMessage) {
        return campaign.openingMessage;
      }

      // Fallback to generating from script if openingMessage is not set
      if (!campaign.script || !campaign.script.versions || campaign.script.versions.length === 0) {
        throw new Error(`Campaign ${campaignId} has no script configured. Please configure a script in the campaign settings.`);
      }

      // Find the active script version or use the first one
      const activeScript = campaign.script.versions.find(v => v.isActive) || campaign.script.versions[0];
      if (!activeScript.content || activeScript.content.trim() === '') {
        throw new Error(`Campaign ${campaignId} has empty script content. Please add script content in the campaign settings.`);
      }

      const campaignScript = activeScript.content;
      
      // Generate opening message using the campaign script and LLM
      // Get system configuration
      const configuration = await Configuration.findOne();
      if (!configuration) {
        throw new Error("System configuration not found. Please set up your system configuration first.");
      }
      
      // Get the system prompt from the campaign or the global configuration
      const finalSystemPrompt = campaign.llmConfiguration?.systemPrompt || configuration.generalSettings.defaultSystemPrompt;

      // If no system prompt is found, throw an error to enforce configuration
      if (!finalSystemPrompt) {
        throw new Error(`No system prompt configured for campaign ${campaignId} or in global settings. Please configure a system prompt.`);
      }
        
      const messages: LLMMessage[] = [
        {
          role: 'system',
          content: finalSystemPrompt
        },
        {
          role: 'user',
          content: `Generate an opening message for:
- Lead name: ${leadName}
- Campaign: ${campaignName}
- Language: ${session.language}
- Personality: ${session.currentPersonality.name}

Campaign Script:
${campaignScript}

Instructions:
- Use ONLY the provided script as your source
- Extract and personalize the opening/introduction part for ${leadName}
- Replace any placeholders like [Agent Name], [Company], [Lead Name] with appropriate values
- Make it sound natural and conversational
- Keep it brief (30-45 seconds when spoken)
- If the script doesn't have a clear opening, use the first meaningful paragraph`
        }
      ];

      const response = await this.llmService.chat({
        provider: configuration.llmConfig.defaultProvider as any,
        model: configuration.llmConfig.defaultModel || 'gpt-4o',
        messages: messages,
        options: {
          temperature: configuration.llmConfig.temperature || 0.7,
          maxTokens: configuration.llmConfig.maxTokens || 200
        }
      });

      const openingMessage = response.content.trim();
      
      if (!openingMessage || openingMessage.length < 10) {
        throw new Error(`LLM failed to generate proper opening message from campaign script. Please check campaign script content.`);
      }
      
      // Add to conversation history
      const turn: ConversationTurn = {
        id: uuidv4(),
        timestamp: new Date(),
        speaker: 'agent',
        content: openingMessage,
        voicePersonality: session.currentPersonality
      };

      session.conversationHistory.push(turn);
      session.metrics.totalTurns++;
      
      logger.info(`Opening message generated for session ${sessionId}`);
      
      return openingMessage;
    } catch (error) {
      logger.error(`Error generating opening message: ${getErrorMessage(error)}`);
      
      // NO FALLBACKS - throw error to force proper campaign configuration
      throw new Error(`Failed to generate opening message: ${getErrorMessage(error)}. Please ensure your campaign has a properly configured script with content.`);
    }
  }

  // Start a new conversation for a call
  async startConversation(callId: string, leadId: string, campaignId: string, voiceId?: string): Promise<string> {
    try {
      // Get configuration for proper language settings
      const configuration = await Configuration.findOne();
      if (!configuration) {
        logger.error('Configuration not found for starting conversation');
        throw new Error('System configuration not found');
      }
      
      // Use default language from configuration
      const defaultLanguage = configuration.generalSettings.defaultLanguage as 'English' | 'Hindi';
      
      const session = await this.createSession(leadId, campaignId, defaultLanguage, voiceId);
      
      logger.info(`Started new conversation ${session.id} for call ${callId}`);
      return session.id;
    } catch (error) {
      logger.error(`Error starting conversation for call ${callId}:`, error);
      throw error;
    }
  }
  
  // Process user input and generate AI response
  async processUserInput(conversationId: string, userInput: string): Promise<{
    text: string;
    intent: string;
  }> {
    try {
      const result = await this.processConversationTurn(conversationId, userInput);
      
      return {
        text: result.response,
        intent: "continue"
      };
    } catch (error) {
      logger.error(`Error processing user input for conversation ${conversationId}:`, error);
      
      // NO FALLBACKS - throw error to force proper configuration
      throw new Error(`Failed to process user input: ${getErrorMessage(error)}. Please ensure your system and campaign are properly configured.`);
    }
  }

  // Get conversation metrics
  getConversationMetrics(sessionId: string): any {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return null;
    }

    return {
      sessionId,
      duration: Date.now() - session.startTime.getTime(),
      totalTurns: session.metrics.totalTurns,
      personalityChanges: session.metrics.personalityChanges,
      conversationStage: session.context.progress.stage,
      status: session.status
    };
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      // Check if all required services are available
      const voiceAIHealth = await this.voiceAI.healthCheck();
      // The LLM service doesn't have a healthCheck method, so we'll test basic functionality
      const llmHealth = await this.testLLMConnection();
      
      return voiceAIHealth && llmHealth;
    } catch (error) {
      logger.error('Conversation engine health check failed:', getErrorMessage(error));
      return false;
    }
  }

  // Test LLM connection
  private async testLLMConnection(): Promise<boolean> {
    try {
      // Get configuration for proper LLM settings
      const configuration = await Configuration.findOne();
      if (!configuration) {
        logger.error('Configuration not found for LLM connection test');
        return false;
      }
      
      const defaultProvider = configuration.llmConfig.defaultProvider;
      const defaultModel = configuration.llmConfig.defaultModel;
      
      const testMessages: LLMMessage[] = [
        {
          role: 'user',
          content: 'test connection'
        }
      ];

      const response = await this.llmService.chat({
        provider: defaultProvider as any, // Type assertion to bypass typing issues
        model: defaultModel,
        messages: testMessages,
        options: {
          temperature: configuration.llmConfig.temperature || 0.1,
          maxTokens: 10
        }
      });

      return !!response.content;
    } catch (error) {
      logger.error('LLM connection test failed:', getErrorMessage(error));
      return false;
    }
  }

  /**
   * Update API keys for all services
   */
  updateApiKeys(
    openAIApiKey?: string,
    googleSpeechKey?: string,
    deepgramApiKey?: string,
    elevenLabsApiKey?: string
  ): void {
    // Update speech analysis service keys
    if (this.speechAnalysis && (openAIApiKey !== undefined || googleSpeechKey !== undefined || deepgramApiKey !== undefined)) {
      this.speechAnalysis.updateApiKeys(openAIApiKey, googleSpeechKey, deepgramApiKey);
      logger.info('Updated SpeechAnalysisService API keys');
    }

    // Note: EnhancedVoiceAIService doesn't have updateApiKeys method
    // It would need to be recreated with new API key if needed

    logger.info('ConversationEngine API keys updated');
  }
}

// Export default for compatibility
export default ConversationEngineService;

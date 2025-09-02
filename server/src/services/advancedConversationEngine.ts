import { logger } from '../index';
import { LLMService } from './llm/service';
import { LLMMessage } from './llm/types';
import { EnhancedVoiceAIService } from './enhancedVoiceAIService';
import Campaign from '../models/Campaign';
import Lead from '../models/Lead';

export interface ConversationState {
  phase: 'opening' | 'discovery' | 'presentation' | 'objection-handling' | 'closing' | 'follow-up';
  customerProfile: {
    engagementLevel: number;
    decisionMakingStyle: string;
    painPoints: string[];
    interests: string[];
  };
  conversationFlow: {
    completedPhases: string[];
    nextActions: string[];
    fallbackActions: string[];
  };
  contextData: {
    leadInfo: any;
    campaignInfo: any;
    previousInteractions: any[];
  };
}

export interface IntentAnalysis {
  primary: string;
  secondary?: string[];
  confidence: number;
  entities: { [key: string]: string };
  sentiment: 'positive' | 'negative' | 'neutral' | 'confused' | 'frustrated' | 'excited';
  urgency: 'low' | 'medium' | 'high';
  decisionIndicators: string[];
  conversationIndicators: string[];
  objectionType?: 'price' | 'timing' | 'authority' | 'need' | 'trust' | 'competitor' | 'quality' | 'comparison';
}

export interface ObjectionType {
  category: 'price' | 'timing' | 'authority' | 'need' | 'trust' | 'competitor';
  severity: 'low' | 'medium' | 'high';
  specificConcern: string;
  suggestedResponse: string;
  escalationNeeded: boolean;
}

export interface ConversationMetrics {
  engagementScore: number;
  sentimentProgression: number[];
  objectionCount: number;
  interruptionCount: number;
  responseTime: number[];
  conversionIndicators: string[];
}

export class AdvancedConversationEngine {
  private activeConversations: Map<string, ConversationState> = new Map();
  private intentPatterns: Map<string, RegExp[]> = new Map();
  private objectionHandlers: Map<string, Function> = new Map();
  private llmService: LLMService;
  private voiceAIService: EnhancedVoiceAIService;

  constructor(llmService: LLMService, voiceAIService: EnhancedVoiceAIService) {
    this.llmService = llmService;
    this.voiceAIService = voiceAIService;
    this.initializeIntentPatterns();
    this.initializeObjectionHandlers();
  }

  private initializeIntentPatterns(): void {
    // Enhanced Interest Patterns
    this.intentPatterns.set('interest', [
      /tell me more/i,
      /sounds interesting/i,
      /how does it work/i,
      /what are the benefits/i,
      /that's interesting/i,
      /i'm curious/i,
      /please explain/i,
      /can you elaborate/i,
      /i'd like to know/i,
      /what exactly/i,
      /how would that/i,
      /sounds good/i,
      /i'm listening/i,
      /go on/i,
      /continue/i,
      /what else/i,
      /show me/i,
      /demonstrate/i,
      /examples/i,
      /case stud(y|ies)/i,
      /more details/i,
      /learn more/i,
      /find out/i
    ]);

    // Enhanced Price Inquiry Patterns  
    this.intentPatterns.set('price_inquiry', [
      /how much/i,
      /cost/i,
      /price/i,
      /expensive/i,
      /budget/i,
      /what('s| is) the cost/i,
      /how much (does|would) (it|this) cost/i,
      /what('s| is) the price/i,
      /pricing/i,
      /what('s| is) the investment/i,
      /monthly fee/i,
      /yearly cost/i,
      /subscription/i,
      /payment/i,
      /affordable/i,
      /cheap/i,
      /roi/i,
      /return on investment/i,
      /worth it/i,
      /value for money/i,
      /budget friendly/i,
      /cost effective/i,
      /fee structure/i,
      /what do you charge/i
    ]);

    // Enhanced Objection Patterns with Types
    this.intentPatterns.set('objection', [
      /not interested/i,
      /don't need/i,
      /can't afford/i,
      /not right time/i,
      /already have/i,
      /no thanks/i,
      /not for us/i,
      /too busy/i,
      /satisfied with current/i,
      /happy with what we have/i,
      /not in the market/i,
      /maybe later/i,
      /not now/i,
      /call back/i,
      /remove from list/i,
      /stop calling/i,
      /not ready/i,
      /thinking about it/i,
      /need to research/i,
      /too complicated/i,
      /doesn't sound right/i
    ]);

    // Enhanced Ready to Buy Patterns
    this.intentPatterns.set('ready_to_buy', [
      /let's do it/i,
      /sign me up/i,
      /when can we start/i,
      /send me the contract/i,
      /i'm ready/i,
      /let's proceed/i,
      /move forward/i,
      /next steps/i,
      /get started/i,
      /sign up/i,
      /purchase/i,
      /buy/i,
      /order/i,
      /take it/i,
      /yes, i want/i,
      /sounds perfect/i,
      /exactly what we need/i,
      /where do i sign/i,
      /let's make it happen/i,
      /count me in/i,
      /i'm in/i,
      /done deal/i
    ]);

    // Enhanced Authority Patterns
    this.intentPatterns.set('need_authority', [
      /need to ask/i,
      /check with/i,
      /not my decision/i,
      /boss/i,
      /manager/i,
      /supervisor/i,
      /team/i,
      /committee/i,
      /board/i,
      /owner/i,
      /partner/i,
      /spouse/i,
      /need approval/i,
      /run it by/i,
      /discuss with/i,
      /talk to/i,
      /consult/i,
      /decision maker/i,
      /not authorized/i,
      /can't decide alone/i,
      /need permission/i,
      /get back to you/i,
      /joint decision/i
    ]);

    // New Intent: Clarification/Confusion
    this.intentPatterns.set('clarification', [
      /what do you mean/i,
      /i don't understand/i,
      /confused/i,
      /unclear/i,
      /explain again/i,
      /repeat that/i,
      /can you clarify/i,
      /not following/i,
      /lost me/i,
      /what exactly/i,
      /how so/i,
      /what does that mean/i,
      /i'm not sure/i,
      /could you rephrase/i,
      /break it down/i,
      /simpler terms/i,
      /give me an example/i
    ]);

    // New Intent: Urgency
    this.intentPatterns.set('urgency', [
      /urgent/i,
      /asap/i,
      /immediately/i,
      /right away/i,
      /as soon as possible/i,
      /quickly/i,
      /fast/i,
      /emergency/i,
      /critical/i,
      /time sensitive/i,
      /deadline/i,
      /today/i,
      /this week/i,
      /rushing/i,
      /hurry/i
    ]);

    // New Intent: Comparison/Competition
    this.intentPatterns.set('comparison', [
      /compared to/i,
      /versus/i,
      /vs/i,
      /competition/i,
      /competitor/i,
      /alternative/i,
      /other options/i,
      /similar products/i,
      /better than/i,
      /different from/i,
      /what makes you/i,
      /how are you different/i,
      /why should i choose/i,
      /advantages over/i,
      /looking at other/i,
      /comparing/i,
      /evaluating/i
    ]);

    // New Intent: Technical/Features
    this.intentPatterns.set('technical', [
      /how does it work/i,
      /technical/i,
      /features/i,
      /functionality/i,
      /capabilities/i,
      /specifications/i,
      /integration/i,
      /compatibility/i,
      /requirements/i,
      /platform/i,
      /system/i,
      /technology/i,
      /api/i,
      /setup/i,
      /implementation/i,
      /customization/i
    ]);

    // New Intent: Timeline/Process  
    this.intentPatterns.set('timeline', [
      /how long/i,
      /timeline/i,
      /when/i,
      /schedule/i,
      /timeframe/i,
      /duration/i,
      /quick/i,
      /fast/i,
      /soon/i,
      /process/i,
      /steps/i,
      /implementation/i,
      /onboarding/i,
      /setup time/i,
      /delivery/i,
      /launch/i
    ]);

    // New Intent: Support/Service
    this.intentPatterns.set('support', [
      /support/i,
      /help/i,
      /service/i,
      /assistance/i,
      /training/i,
      /onboarding/i,
      /customer service/i,
      /maintenance/i,
      /updates/i,
      /backup/i,
      /reliability/i,
      /uptime/i,
      /available/i,
      /responsive/i
    ]);
  }

  private initializeObjectionHandlers(): void {
    this.objectionHandlers.set('price', this.handlePriceObjection.bind(this));
    this.objectionHandlers.set('timing', this.handleTimingObjection.bind(this));
    this.objectionHandlers.set('authority', this.handleAuthorityObjection.bind(this));
    this.objectionHandlers.set('need', this.handleNeedObjection.bind(this));
    this.objectionHandlers.set('trust', this.handleTrustObjection.bind(this));
    this.objectionHandlers.set('competitor', this.handleCompetitorObjection.bind(this));
  }

  // Main conversation flow management
  async generateResponse(params: {
    callId: string;
    conversationState: string;
    customerInput?: string;
    campaignId: string;
    personalityId?: string;
    abTestVariantId?: string;
  }): Promise<any> {
    try {
      // Get or create conversation state
      let conversation = this.activeConversations.get(params.callId);
      if (!conversation) {
        conversation = await this.initializeConversation(params.callId, params.campaignId);
      }

      // Analyze customer input if provided
      let intentAnalysis: IntentAnalysis | null = null;
      if (params.customerInput) {
        intentAnalysis = await this.analyzeIntent(params.customerInput);
        await this.updateCustomerProfile(conversation, intentAnalysis);
      }

      // Determine next response based on conversation phase and analysis
      const response = await this.determineResponse(
        conversation,
        intentAnalysis,
        params.personalityId
      );

      // Update conversation state
      await this.updateConversationState(conversation, response, intentAnalysis);
      this.activeConversations.set(params.callId, conversation);

      return response;
    } catch (error) {
      logger.error('Error generating conversation response:', error);
      // NO HARDCODED RESPONSES - must be configured dynamically
      throw new Error(`Failed to generate conversation response: ${error.message}. Please ensure your campaign and system configuration are complete.`);
    }
  }

  private async initializeConversation(callId: string, campaignId: string): Promise<ConversationState> {
    try {
      // Fetch campaign and lead information
      const campaign = await Campaign.findById(campaignId);
      
      return {
        phase: 'opening',
        customerProfile: {
          engagementLevel: 0.5,
          decisionMakingStyle: 'unknown',
          painPoints: [],
          interests: []
        },
        conversationFlow: {
          completedPhases: [],
          nextActions: ['introduce', 'permission_to_continue'],
          fallbackActions: ['clarify', 'repeat']
        },
        contextData: {
          leadInfo: {},
          campaignInfo: campaign,
          previousInteractions: []
        }
      };
    } catch (error) {
      logger.error('Error initializing conversation:', error);
      throw error;
    }
  }

  // Intent Analysis
  async analyzeIntent(customerInput: string): Promise<IntentAnalysis> {
    try {
      let primaryIntent = 'unknown';
      let secondaryIntents: string[] = [];
      let confidence = 0;
      
      // Enhanced pattern matching for multiple intent detection
      const intentMatches: Array<{intent: string, confidence: number}> = [];
      
      for (const [intent, patterns] of this.intentPatterns.entries()) {
        let matchCount = 0;
        for (const pattern of patterns) {
          if (pattern.test(customerInput)) {
            matchCount++;
          }
        }
        
        if (matchCount > 0) {
          const intentConfidence = Math.min(0.9, 0.6 + (matchCount * 0.1));
          intentMatches.push({ intent, confidence: intentConfidence });
        }
      }
      
      // Sort by confidence and assign primary/secondary intents
      intentMatches.sort((a, b) => b.confidence - a.confidence);
      
      if (intentMatches.length > 0) {
        primaryIntent = intentMatches[0].intent;
        confidence = intentMatches[0].confidence;
        
        // Extract secondary intents with confidence > 0.6
        secondaryIntents = intentMatches
          .slice(1)
          .filter(match => match.confidence >= 0.6)
          .map(match => match.intent);
      }

      // Enhanced intent analysis using LLM if confidence is still low
      if (confidence < 0.7) {
        const llmAnalysis = await this.performLLMIntentAnalysis(customerInput);
        primaryIntent = llmAnalysis.intent;
        confidence = llmAnalysis.confidence;
      }

      // Extract entities and enhanced sentiment analysis
      const entities = await this.extractEntities(customerInput);
      const sentiment = await this.analyzeSentiment(customerInput);
      const urgency = this.determineUrgency(customerInput);
      const decisionIndicators = this.extractDecisionIndicators(customerInput);
      const conversationIndicators = this.extractConversationIndicators(customerInput);
      
      // Detect objection type if primary intent is objection
      let objectionType: 'price' | 'timing' | 'authority' | 'need' | 'trust' | 'competitor' | 'quality' | 'comparison' | undefined;
      if (primaryIntent === 'objection') {
        objectionType = this.detectObjectionType(customerInput);
      }

      return {
        primary: primaryIntent,
        secondary: secondaryIntents.length > 0 ? secondaryIntents : undefined,
        confidence,
        entities,
        sentiment,
        urgency,
        decisionIndicators,
        conversationIndicators,
        objectionType
      };
    } catch (error) {
      logger.error('Error analyzing intent:', error);
      return {
        primary: 'unknown',
        confidence: 0,
        entities: {},
        sentiment: 'neutral',
        urgency: 'low',
        decisionIndicators: [],
        conversationIndicators: []
      };
    }
  }

  private async performLLMIntentAnalysis(input: string): Promise<{ intent: string; confidence: number }> {
    const prompt = `
      Analyze the following customer response in a sales call context and determine the primary intent:
      
      Customer: "${input}"
      
      Possible intents: interest, price_inquiry, objection, ready_to_buy, need_authority, clarification, 
      urgency, comparison, technical, timeline, support, negative_response, confusion, frustration
      
      Consider these categories:
      - interest: Shows curiosity or desire to learn more
      - price_inquiry: Asking about cost, pricing, or budget
      - objection: Expressing resistance or concerns
      - ready_to_buy: Ready to proceed or purchase
      - need_authority: Need approval from someone else
      - clarification: Confused or need clarification
      - urgency: Time-sensitive or urgent needs
      - comparison: Comparing with alternatives or competitors
      - technical: Asking about features, functionality, or specifications
      - timeline: Asking about timing, process, or implementation
      - support: Asking about service, help, or maintenance
      
      Respond with JSON: {"intent": "detected_intent", "confidence": 0.0-1.0}
    `;

    try {
      const messages: LLMMessage[] = [
        { role: 'user', content: prompt }
      ];
      
      const llmResponse = await this.llmService.chat({
        provider: 'openai',
        model: 'gpt-4',
        messages: messages,
        options: { 
          temperature: 0.3, 
          maxTokens: 150 
        }
      });
      
      const parsed = JSON.parse(llmResponse.content);
      return {
        intent: parsed.intent || 'unknown',
        confidence: parsed.confidence || 0.5
      };
    } catch (error) {
      logger.error('LLM intent analysis failed:', error);
      return { intent: 'unknown', confidence: 0 };
    }
  }

  private async extractEntities(input: string): Promise<{ [key: string]: string }> {
    // Simple entity extraction - in production, use NER models
    const entities: { [key: string]: string } = {};
    
    // Extract common entities
    const timeRegex = /\b(\d{1,2}:\d{2}|\d{1,2}\s?(am|pm)|morning|afternoon|evening)\b/gi;
    const dateRegex = /\b(today|tomorrow|next week|monday|tuesday|wednesday|thursday|friday)\b/gi;
    const numberRegex = /\b\d+\b/g;
    
    const timeMatches = input.match(timeRegex);
    if (timeMatches) entities.time = timeMatches[0];
    
    const dateMatches = input.match(dateRegex);
    if (dateMatches) entities.date = dateMatches[0];
    
    const numberMatches = input.match(numberRegex);
    if (numberMatches) entities.number = numberMatches[0];

    return entities;
  }

  private async analyzeSentiment(input: string): Promise<'positive' | 'negative' | 'neutral' | 'confused' | 'frustrated' | 'excited'> {
    const sentimentWords = {
      positive: ['great', 'excellent', 'good', 'interested', 'yes', 'sure', 'definitely', 'love', 'like', 
                'amazing', 'fantastic', 'wonderful', 'perfect', 'awesome', 'brilliant', 'pleased', 'happy',
                'satisfied', 'impressed', 'excited', 'thrilled', 'delighted'],
      negative: ['no', 'not', 'bad', 'terrible', 'never', 'stop', 'don\'t', 'won\'t', 'can\'t', 'hate', 
                'dislike', 'awful', 'horrible', 'disappointing', 'unsatisfied', 'unhappy', 'annoyed',
                'frustrated', 'angry', 'upset', 'worried', 'concerned'],
      confused: ['confused', 'unsure', 'don\'t understand', 'unclear', 'what do you mean', 'lost', 
                'not following', 'puzzled', 'perplexed', 'baffled', 'mystified', 'bewildered'],
      frustrated: ['frustrated', 'annoying', 'irritating', 'fed up', 'sick of', 'tired of', 'enough',
                  'difficult', 'complicated', 'overwhelming', 'stressful', 'pain', 'hassle'],
      excited: ['excited', 'thrilled', 'eager', 'enthusiastic', 'pumped', 'motivated', 'energized',
               'passionate', 'keen', 'anxious to start', 'can\'t wait', 'looking forward']
    };
    
    const words = input.toLowerCase().split(/\s+/);
    const sentimentScores = {
      positive: 0,
      negative: 0,
      confused: 0,
      frustrated: 0,
      excited: 0
    };
    
    words.forEach(word => {
      Object.entries(sentimentWords).forEach(([sentiment, wordList]) => {
        if (wordList.some(sw => word.includes(sw) || sw.includes(word))) {
          sentimentScores[sentiment as keyof typeof sentimentScores]++;
        }
      });
    });
    
    // Find the highest scoring sentiment
    const maxScore = Math.max(...Object.values(sentimentScores));
    if (maxScore === 0) return 'neutral';
    
    const topSentiment = Object.entries(sentimentScores).find(([_, score]) => score === maxScore)?.[0];
    return topSentiment as 'positive' | 'negative' | 'neutral' | 'confused' | 'frustrated' | 'excited' || 'neutral';
  }

  private determineUrgency(input: string): 'low' | 'medium' | 'high' {
    const urgentWords = ['urgent', 'asap', 'immediately', 'now', 'quickly', 'today'];
    const mediumWords = ['soon', 'this week', 'next week'];
    
    const lowerInput = input.toLowerCase();
    
    if (urgentWords.some(word => lowerInput.includes(word))) return 'high';
    if (mediumWords.some(word => lowerInput.includes(word))) return 'medium';
    return 'low';
  }

  private extractDecisionIndicators(input: string): string[] {
    const indicators: string[] = [];
    const decisionSignals = {
      buyingSignals: [
        'how much', 'when can we start', 'what\'s the process', 'send me information', 
        'let\'s do it', 'sounds good', 'next steps', 'move forward', 'get started',
        'sign up', 'purchase', 'buy', 'order', 'ready to proceed', 'where do i sign'
      ],
      considerationSignals: [
        'thinking about it', 'considering', 'evaluating', 'looking into', 'exploring options',
        'need to research', 'want to learn more', 'interested in', 'might be good'
      ],
      urgencySignals: [
        'urgent', 'asap', 'immediately', 'quickly', 'soon', 'today', 'this week',
        'deadline', 'time sensitive', 'rushing', 'emergency'
      ],
      authoritySignals: [
        'need approval', 'ask my boss', 'check with team', 'run it by', 'decision maker',
        'not my call', 'need permission', 'consult with', 'discuss internally'
      ],
      objectionSignals: [
        'too expensive', 'can\'t afford', 'not interested', 'already have', 'satisfied with current',
        'not right time', 'too busy', 'need to think', 'maybe later'
      ],
      engagementSignals: [
        'tell me more', 'how does it work', 'show me', 'demonstrate', 'examples',
        'case studies', 'more details', 'explain', 'elaborate'
      ]
    };
    
    const lowerInput = input.toLowerCase();
    
    Object.entries(decisionSignals).forEach(([category, signals]) => {
      signals.forEach(signal => {
        if (lowerInput.includes(signal)) {
          indicators.push(`${category}:${signal}`);
        }
      });
    });
    
    return indicators;
  }

  private extractConversationIndicators(input: string): string[] {
    const indicators: string[] = [];
    const conversationSignals = {
      engagement: [
        'interesting', 'tell me more', 'go on', 'continue', 'elaborate', 'explain',
        'show me', 'demonstrate', 'examples', 'how so', 'really'
      ],
      resistance: [
        'but', 'however', 'although', 'not sure', 'skeptical', 'doubtful',
        'concerned', 'worried', 'hesitant', 'unsure'
      ],
      timeConstraints: [
        'busy', 'no time', 'quick', 'brief', 'short', 'hurry', 'rush',
        'tight schedule', 'limited time', 'in a meeting'
      ],
      informationSeeking: [
        'details', 'information', 'specifics', 'documentation', 'brochure',
        'website', 'references', 'testimonials', 'reviews'
      ],
      comparisonMode: [
        'compared to', 'versus', 'alternative', 'options', 'competitors',
        'similar', 'different', 'better', 'worse', 'evaluating'
      ]
    };
    
    const lowerInput = input.toLowerCase();
    
    Object.entries(conversationSignals).forEach(([category, signals]) => {
      signals.forEach(signal => {
        if (lowerInput.includes(signal)) {
          indicators.push(`${category}:${signal}`);
        }
      });
    });
    
    return indicators;
  }

  private detectObjectionType(input: string): 'price' | 'timing' | 'authority' | 'need' | 'trust' | 'competitor' | 'quality' | 'comparison' | undefined {
    const objectionTypes = {
      price: [
        'too expensive', 'can\'t afford', 'out of budget', 'costs too much', 'price',
        'cheap', 'cost', 'money', 'budget', 'expensive', 'affordable', 'investment'
      ],
      timing: [
        'not right time', 'too busy', 'maybe later', 'call back', 'not now',
        'busy', 'time', 'schedule', 'later', 'timing', 'when'
      ],
      authority: [
        'not my decision', 'ask my boss', 'need approval', 'boss', 'manager',
        'supervisor', 'team', 'committee', 'owner', 'decision maker'
      ],
      need: [
        'don\'t need', 'already have', 'not interested', 'satisfied with current',
        'happy with what we have', 'no need', 'unnecessary'
      ],
      trust: [
        'don\'t know you', 'sounds too good', 'scam', 'suspicious', 'doubt',
        'skeptical', 'trust', 'reliable', 'credible', 'legitimate'
      ],
      competitor: [
        'using competitor', 'happy with current', 'already working with',
        'current provider', 'existing solution', 'competitor', 'alternative'
      ],
      quality: [
        'not good enough', 'poor quality', 'doesn\'t work', 'unreliable',
        'problems', 'issues', 'concerns', 'quality', 'performance'
      ],
      comparison: [
        'comparing options', 'evaluating alternatives', 'looking at others',
        'shopping around', 'other vendors', 'competitors', 'alternatives'
      ]
    };
    
    const lowerInput = input.toLowerCase();
    
    for (const [type, keywords] of Object.entries(objectionTypes)) {
      if (keywords.some(keyword => lowerInput.includes(keyword))) {
        return type as 'price' | 'timing' | 'authority' | 'need' | 'trust' | 'competitor' | 'quality' | 'comparison';
      }
    }
    
    return undefined;
  }

  // Objection Handling
  async identifyObjection(customerInput: string): Promise<ObjectionType | null> {
    const objectionPatterns = {
      price: [/too expensive/i, /can't afford/i, /out of budget/i, /costs too much/i],
      timing: [/not right time/i, /too busy/i, /maybe later/i, /call back/i],
      authority: [/not my decision/i, /ask my boss/i, /need approval/i],
      need: [/don't need/i, /already have/i, /not interested/i],
      trust: [/don't know you/i, /sounds too good/i, /scam/i],
      competitor: [/using competitor/i, /happy with current/i, /already working with/i]
    };

    for (const [category, patterns] of Object.entries(objectionPatterns)) {
      for (const pattern of patterns) {
        if (pattern.test(customerInput)) {
          const severity = this.assessObjectionSeverity(customerInput);
          return {
            category: category as any,
            severity,
            specificConcern: customerInput,
            suggestedResponse: await this.generateObjectionResponse(category, customerInput),
            escalationNeeded: severity === 'high'
          };
        }
      }
    }

    return null;
  }

  private assessObjectionSeverity(input: string): 'low' | 'medium' | 'high' {
    const strongNegatives = ['never', 'absolutely not', 'definitely not', 'no way'];
    const mediumNegatives = ['not sure', 'maybe not', 'probably not'];
    
    const lowerInput = input.toLowerCase();
    
    if (strongNegatives.some(phrase => lowerInput.includes(phrase))) return 'high';
    if (mediumNegatives.some(phrase => lowerInput.includes(phrase))) return 'medium';
    return 'low';
  }

  private async generateObjectionResponse(category: string, concern: string): Promise<string> {
    const handler = this.objectionHandlers.get(category);
    if (handler) {
      return await handler(concern);
    }
    // NO HARDCODED RESPONSES - must be configured dynamically
    throw new Error(`Objection handler for category '${category}' not configured. Please set up objection handling templates in your campaign configuration.`);
  }

  // Objection Handlers
  private async handlePriceObjection(concern: string): Promise<string> {
    // NO HARDCODED RESPONSES - must be configured dynamically
    throw new Error('Price objection handler not configured. Please set up objection handling templates in your campaign configuration.');
  }

  private async handleTimingObjection(concern: string): Promise<string> {
    // NO HARDCODED RESPONSES - must be configured dynamically
    throw new Error('Timing objection handler not configured. Please set up objection handling templates in your campaign configuration.');
  }

  private async handleAuthorityObjection(concern: string): Promise<string> {
    // NO HARDCODED RESPONSES - must be configured dynamically
    throw new Error('Authority objection handler not configured. Please set up objection handling templates in your campaign configuration.');
  }

  private async handleNeedObjection(concern: string): Promise<string> {
    // NO HARDCODED RESPONSES - must be configured dynamically
    throw new Error('Need objection handler not configured. Please set up objection handling templates in your campaign configuration.');
  }

  private async handleTrustObjection(concern: string): Promise<string> {
    // NO HARDCODED RESPONSES - must be configured dynamically
    throw new Error('Trust objection handler not configured. Please set up objection handling templates in your campaign configuration.');
  }

  private async handleCompetitorObjection(concern: string): Promise<string> {
    // NO HARDCODED RESPONSES - must be configured dynamically
    throw new Error('Competitor objection handler not configured. Please set up objection handling templates in your campaign configuration.');
  }

  // Conversation Flow Management
  private async determineResponse(
    conversation: ConversationState,
    intentAnalysis: IntentAnalysis | null,
    personalityId?: string
  ): Promise<any> {
    try {
      // Check for objections first
      if (intentAnalysis?.primary === 'objection') {
        return await this.handleObjectionInConversation(conversation, intentAnalysis);
      }

      // Handle based on conversation phase
      switch (conversation.phase) {
        case 'opening':
          return await this.handleOpeningPhase(conversation, intentAnalysis);
        case 'discovery':
          return await this.handleDiscoveryPhase(conversation, intentAnalysis);
        case 'presentation':
          return await this.handlePresentationPhase(conversation, intentAnalysis);
        case 'closing':
          return await this.handleClosingPhase(conversation, intentAnalysis);
        default:
          return await this.generatePhaseResponse(conversation.phase, intentAnalysis);
      }
    } catch (error) {
      logger.error('Error determining response:', error);
      // NO HARDCODED RESPONSES - must be configured dynamically
      throw new Error(`Failed to determine conversation response: ${error.message}. Please ensure your campaign configuration includes all necessary response templates.`);
    }
  }

  private async handleOpeningPhase(conversation: ConversationState, intent: IntentAnalysis | null): Promise<any> {
    if (intent?.primary === 'interest') {
      conversation.phase = 'discovery';
      return {
        text: "Great! I'd love to learn more about your current situation. What challenges are you facing in your business right now?",
        action: 'gather',
        nextState: 'discovery'
      };
    }

    return {
      text: "",
      action: 'gather',
      nextState: 'opening'
    };
  }

  private async handleDiscoveryPhase(conversation: ConversationState, intent: IntentAnalysis | null): Promise<any> {
    // Extract pain points and interests
    if (intent?.entities) {
      Object.keys(intent.entities).forEach(key => {
        if (!conversation.customerProfile.painPoints.includes(intent.entities[key])) {
          conversation.customerProfile.painPoints.push(intent.entities[key]);
        }
      });
    }

    if (conversation.customerProfile.painPoints.length >= 2) {
      conversation.phase = 'presentation';
      return {
        text: "Based on what you've shared, I can see how our solution would specifically address those challenges. Let me show you how we've helped similar companies.",
        action: 'speak',
        nextState: 'presentation'
      };
    }

    return {
      text: "That's very insightful. Can you tell me more about how this impacts your daily operations?",
      action: 'gather',
      nextState: 'discovery'
    };
  }

  private async handlePresentationPhase(conversation: ConversationState, intent: IntentAnalysis | null): Promise<any> {
    if (intent?.primary === 'ready_to_buy' || intent?.decisionIndicators.length > 0) {
      conversation.phase = 'closing';
      return {
        text: "I'm glad you see the value! Let's discuss the next steps to get you started.",
        action: 'speak',
        nextState: 'closing'
      };
    }

    if (intent?.primary === 'price_inquiry') {
      return {
        text: "Great question about investment. The cost varies based on your specific needs, but I can tell you that our clients typically see ROI within 3-6 months. Would you like me to prepare a customized proposal for you?",
        action: 'gather',
        nextState: 'presentation'
      };
    }

    return {
      text: "Here's how this specifically solves the challenges you mentioned. What questions do you have about this approach?",
      action: 'gather',
      nextState: 'presentation'
    };
  }

  private async handleClosingPhase(conversation: ConversationState, intent: IntentAnalysis | null): Promise<any> {
    if (intent?.primary === 'ready_to_buy') {
      return {
        text: "Excellent! I'll send you the agreement and we can schedule a kickoff call. What's the best email address to send this to?",
        action: 'gather',
        nextState: 'follow-up'
      };
    }

    return {
      text: "Based on everything we've discussed, this seems like a perfect fit for your needs. Are you ready to move forward?",
      action: 'gather',
      nextState: 'closing'
    };
  }

  private async handleObjectionInConversation(conversation: ConversationState, intent: IntentAnalysis): Promise<any> {
    const objection = await this.identifyObjection(intent.entities.concern || '');
    
    if (objection) {
      const response = await this.generateObjectionResponse(objection.category, objection.specificConcern);
      return {
        text: response,
        action: 'gather',
        nextState: conversation.phase,
        objectionHandled: objection.category
      };
    }

    // NO HARDCODED RESPONSES - must be configured dynamically
    throw new Error('Objection detected but no handler configured. Please set up objection handling templates in your campaign configuration.');
  }

  private async generatePhaseResponse(phase: string, intent: IntentAnalysis | null): Promise<any> {
    // NO HARDCODED RESPONSES - must be configured dynamically
    throw new Error(`Phase response for '${phase}' not configured. Please set up phase-specific templates in your campaign configuration.`);
  }

  private generateFallbackResponse(): any {
    // NO HARDCODED RESPONSES - must be configured dynamically
    throw new Error('Fallback response requested but not configured. Please ensure your campaign configuration includes comprehensive response templates.');
  }

  // Conversation State Management
  private async updateCustomerProfile(
    conversation: ConversationState,
    intent: IntentAnalysis
  ): Promise<void> {
    // Update engagement level based on responses
    if (intent.primary === 'interest') {
      conversation.customerProfile.engagementLevel = Math.min(1, conversation.customerProfile.engagementLevel + 0.2);
    } else if (intent.primary === 'objection') {
      conversation.customerProfile.engagementLevel = Math.max(0, conversation.customerProfile.engagementLevel - 0.1);
    }

    // Extract and store pain points
    if (intent.entities && Object.keys(intent.entities).length > 0) {
      Object.values(intent.entities).forEach(entity => {
        if (!conversation.customerProfile.painPoints.includes(entity)) {
          conversation.customerProfile.painPoints.push(entity);
        }
      });
    }
  }

  private async updateConversationState(
    conversation: ConversationState,
    response: any,
    intent: IntentAnalysis | null
  ): Promise<void> {
    // Mark phase as completed if moving to next phase
    if (response.nextState && response.nextState !== conversation.phase) {
      if (!conversation.conversationFlow.completedPhases.includes(conversation.phase)) {
        conversation.conversationFlow.completedPhases.push(conversation.phase);
      }
    }

    // Update next actions based on response
    conversation.conversationFlow.nextActions = this.determineNextActions(response, intent);
  }

  private determineNextActions(response: any, intent: IntentAnalysis | null): string[] {
    const actions = [];
    
    if (response.objectionHandled) {
      actions.push('follow_up_objection', 'continue_presentation');
    } else if (intent?.primary === 'interest') {
      actions.push('provide_details', 'ask_qualifying_questions');
    } else if (intent?.primary === 'ready_to_buy') {
      actions.push('close_deal', 'schedule_follow_up');
    } else {
      actions.push('clarify', 'provide_value');
    }
    
    return actions;
  }

  // Conversation Flow Adaptation
  async adaptConversationFlow(params: {
    conversationId: string;
    conversationHistory: any[];
    currentScript: string;
    language: string;
  }): Promise<any> {
    try {
      const conversation = this.activeConversations.get(params.conversationId);
      if (!conversation) {
        throw new Error('Conversation not found');
      }

      // Analyze conversation effectiveness
      const effectiveness = this.analyzeConversationEffectiveness(params.conversationHistory);
      
      // Adapt based on conversation effectiveness
      const adaptation = await this.generateAdaptation(
        conversation,
        effectiveness,
        params.language
      );

      return adaptation;
    } catch (error) {
      logger.error('Error adapting conversation flow:', error);
      throw error;
    }
  }

  private analyzeConversationEffectiveness(history: any[]): number {
    if (history.length === 0) return 0.5;
    
    let positiveResponses = 0;
    let totalResponses = history.length;
    
    history.forEach(turn => {
      if (turn.sentiment === 'positive' || turn.intent === 'interest') {
        positiveResponses++;
      }
    });
    
    return positiveResponses / totalResponses;
  }

  private async generateAdaptation(
    conversation: ConversationState,
    effectiveness: number,
    language: string
  ): Promise<any> {
    const adaptations = {
      script: '',
      voiceAdjustments: {},
      personalityShift: null,
      recommendations: []
    };

    // Adapt script based on effectiveness
    if (effectiveness < 0.3) {
      adaptations.script = await this.generateRecoveryScript(conversation);
      adaptations.recommendations.push('Switch to recovery mode');
    } else if (effectiveness > 0.7) {
      adaptations.script = await this.generateAcceleratedScript(conversation);
      adaptations.recommendations.push('Accelerate to closing');
    }

    // Standard voice adjustments based on conversation stage
    adaptations.voiceAdjustments = {
      speed: 1.0,
      tone: 'professional',
      energy: 'balanced'
    };

    return adaptations;
  }
  private async generateRecoveryScript(conversation: ConversationState): Promise<string> {
    return "I can sense this might not be resonating with you. Let me take a step back - what would be most valuable for you to hear about right now?";
  }

  private async generateAcceleratedScript(conversation: ConversationState): Promise<string> {
    return "I can see you're engaged with this solution. Would you like me to prepare a proposal so we can move forward quickly?";
  }

  // Public API Methods
  async getConversationMetrics(conversationId: string): Promise<ConversationMetrics> {
    const conversation = this.activeConversations.get(conversationId);
    if (!conversation) {
      throw new Error('Conversation not found');
    }

    return {
      engagementScore: conversation.customerProfile.engagementLevel,
      sentimentProgression: [], // Would track sentiment over time
      objectionCount: 0, // Would count objections handled
      interruptionCount: 0, // Would track customer interruptions
      responseTime: [], // Would track AI response times
      conversionIndicators: conversation.customerProfile.interests
    };
  }

  async endConversation(conversationId: string): Promise<void> {
    this.activeConversations.delete(conversationId);
  }

  async getAllActiveConversations(): Promise<ConversationState[]> {
    return Array.from(this.activeConversations.values());
  }
}

// Export the class for use with dependency injection
// Instances should be created in services/index.ts

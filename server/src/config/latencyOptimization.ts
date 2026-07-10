/**
 * Latency Optimization Configuration
 * 
 * Centralized configuration for all latency optimization settings
 * across the audio pipeline, WebSocket handling, and external services.
 */

import logger from '../utils/logger';

export interface LatencyOptimizationConfig {
  // Audio Processing
  audio: {
    sampleRate: number;
    frameSize: number;
    bufferSize: number;
    maxBufferCount: number;
    enableMemoryPooling: boolean;
    poolSize: number;
    enableBufferReuse: boolean;
  };

  // WebSocket Optimization
  websocket: {
    keepAliveInterval: number;
    healthCheckInterval: number;
    pingTimeout: number;
    connectionTimeout: number;
    audioChunkSize: number;
    enableBinaryWebSocket: boolean;
    enableCompression: boolean;
    maxPayloadSize: number;
  };

  // Provider Timeouts
  providers: {
    sttTimeout: number;
    ttsTimeout: number;
    llmTimeout: number;
    fallbackTimeout: number;
    maxRetries: number;
    retryDelay: number;
  };

  // Processing Optimization
  processing: {
    maxProcessingLatency: number;
    enableParallelProcessing: boolean;
    maxConcurrentTasks: number;
    enableStreamingSTT: boolean;
    enableStreamingTTS: boolean;
    streamingChunkSize: number;
  };

  // LLM Optimization
  llm: {
    maxTokens: number;
    temperature: number;
    enableStreaming: boolean;
    responseFormat: string;
    enableCaching: boolean;
    cacheTTL: number;
  };

  // Network Optimization
  network: {
    maxConnections: number;
    maxConnectionsPerHost: number;
    keepAlive: boolean;
    keepAliveMsecs: number;
    enableHTTP2: boolean;
    enableCompression: boolean;
    timeout: number;
  };

  // Monitoring
  monitoring: {
    enableLatencyTracking: boolean;
    enableAlerts: boolean;
    alertThresholds: {
      [stage: string]: number;
    };
    metricsRetention: number;
    alertCooldown: number;
  };
}

export const ULTRA_LOW_LATENCY_CONFIG: LatencyOptimizationConfig = {
  audio: {
    sampleRate: 16000,           // 16kHz for faster processing
    frameSize: 5,                // 5ms frames for ultra-low latency
    bufferSize: 320,             // 5ms at 16kHz, 16-bit = 160 bytes per frame, 2 frames = 320
    maxBufferCount: 2,           // Only 2 buffers in queue
    enableMemoryPooling: true,
    poolSize: 100,
    enableBufferReuse: true
  },

  websocket: {
    keepAliveInterval: 5000,     // 5 seconds for faster detection
    healthCheckInterval: 10000,  // 10 seconds for frequent monitoring
    pingTimeout: 2000,           // 2 seconds timeout for ping responses
    connectionTimeout: 10000,    // 10 seconds for initial connection timeout
    audioChunkSize: 1024,        // 1KB chunks for faster processing
    enableBinaryWebSocket: true,
    enableCompression: false,    // Disabled for latency
    maxPayloadSize: 1024         // 1KB max payload
  },

  providers: {
    sttTimeout: 200,             // 200ms for STT
    ttsTimeout: 300,             // 300ms for TTS
    llmTimeout: 500,             // 500ms for LLM
    fallbackTimeout: 200,        // 200ms for faster fallback
    maxRetries: 1,               // Reduced retries for faster failure handling
    retryDelay: 100              // 100ms retry delay
  },

  processing: {
    maxProcessingLatency: 100,   // 100ms max for ultra-low latency
    enableParallelProcessing: true,
    maxConcurrentTasks: 5,       // 5 parallel tasks
    enableStreamingSTT: true,
    enableStreamingTTS: true,
    streamingChunkSize: 512      // 512 bytes for faster processing
  },

  llm: {
    maxTokens: 50,               // Shorter responses for faster generation
    temperature: 0.1,            // Lower temperature for faster, more deterministic responses
    enableStreaming: true,       // Enable streaming responses
    responseFormat: 'json',      // Structured responses
    enableCaching: true,         // Enable response caching
    cacheTTL: 300                // 5 minutes cache TTL
  },

  network: {
    maxConnections: 50,
    maxConnectionsPerHost: 10,
    keepAlive: true,
    keepAliveMsecs: 1000,
    enableHTTP2: false,          // Disabled for now due to complexity
    enableCompression: false,    // Disabled for latency
    timeout: 5000                // 5 seconds timeout
  },

  monitoring: {
    enableLatencyTracking: true,
    enableAlerts: true,
    alertThresholds: {
      'audio_processing': 50,      // 50ms for audio processing
      'stt_processing': 200,       // 200ms for STT
      'llm_processing': 500,       // 500ms for LLM
      'tts_processing': 300,       // 300ms for TTS
      'total_roundtrip': 1000,     // 1000ms total roundtrip
      'websocket_send': 10,        // 10ms for WebSocket send
      'websocket_receive': 10,     // 10ms for WebSocket receive
      'database_query': 100,       // 100ms for database queries
      'provider_fallback': 1000    // 1000ms for provider fallback
    },
    metricsRetention: 3600000,    // 1 hour
    alertCooldown: 30000          // 30 seconds
  }
};

export type LatencyProfile = 'ultra-low' | 'balanced' | 'high-quality';

export const getLatencyConfig = (profile: LatencyProfile): LatencyOptimizationConfig => {
  switch (profile) {
    case 'ultra-low':
      return ULTRA_LOW_LATENCY_CONFIG;
    default:
      return ULTRA_LOW_LATENCY_CONFIG;
  }
};

export const applyLatencyConfig = (config: LatencyOptimizationConfig): void => {
  logger.info('Applying latency optimization configuration:', {
    profile: config.audio.sampleRate === 16000 && config.audio.frameSize === 5 ? 'ultra-low' : 'other',
    audioFrameSize: config.audio.frameSize,
    maxProcessingLatency: config.processing.maxProcessingLatency,
    llmMaxTokens: config.llm.maxTokens,
    enableStreaming: config.llm.enableStreaming
  });
};

// Voice Settings for different latency profiles
export const voiceSettings = {
  ultraLow: {
    stability: 0.3,
    similarityBoost: 0.8,
    style: 0.1,
    model: 'eleven_turbo_v2_5'
  },
  low: {
    stability: 0.5,
    similarityBoost: 0.75,
    style: 0.2,
    model: 'eleven_turbo_v2_5'
  },
  balanced: {
    stability: 0.75,
    similarityBoost: 0.75,
    style: 0.3,
    model: 'eleven_multilingual_v2'
  },
  highQuality: {
    stability: 0.8,
    similarityBoost: 0.8,
    style: 0.4,
    model: 'eleven_multilingual_v2'
  }
};

// Common phrases for cache preloading
export const commonPhrases = {
  acknowledgments: [
    "I understand",
    "That makes sense",
    "I see",
    "Absolutely",
    "Of course",
    "Right",
    "Exactly",
    "Got it",
    "I hear you",
    "That's interesting"
  ],
  thinking: [
    "Let me think about that",
    "Hmm, that's a good point",
    "Let me consider that",
    "That's something to think about",
    "I need to process that",
    "That's worth considering",
    "Let me reflect on that",
    "That's an interesting perspective"
  ],
  GREETINGS: [
    "Hello, this is",
    "Hi there, I'm calling from",
    "Good morning, this is",
    "Good afternoon, I'm",
    "Hello, my name is",
    "Hi, I'm calling about",
    "Good day, this is",
    "Hello, I'm reaching out from"
  ],
  transitions: [
    "Now, let me ask you",
    "Speaking of which",
    "That reminds me",
    "On that note",
    "By the way",
    "I should mention",
    "Let me also ask",
    "Another thing I wanted to discuss"
  ]
};

// Cache settings for response preloading
export const cacheSettings = {
  maxSizeMB: 100, // 100MB cache size
  ttl: 300000, // 5 minutes TTL
  preload: {
    enabled: true,
    concurrency: 3,
    timeout: 30000 // 30 seconds timeout for preloading
  }
};

// Parallel processing settings
export const parallelProcessingSettings = {
  maxConcurrentTasks: 5,
  taskTimeout: 10000,
  retryAttempts: 2,
  retryDelay: 1000,
  acknowledgmentDelay: 50,        // 50ms delay for acknowledgments
  thinkingDelay: 200,             // 200ms delay for thinking sounds
  streamPartialResponses: true,   // Enable streaming partial responses
  thinkingSoundInterval: 1000,    // 1 second between thinking sounds
  maxThinkingSounds: 3            // Maximum 3 thinking sounds per response
};

export default {
  ULTRA_LOW_LATENCY_CONFIG,
  getLatencyConfig,
  applyLatencyConfig,
  voiceSettings,
  commonPhrases,
  cacheSettings,
  parallelProcessingSettings
};
/**
 * Enhanced Conversational AI WebSocket Client
 * 
 * Features:
 * - Low-latency WebSocket audio streaming
 * - Real-time metrics collection
 * - Audio visualization support
 * - Optimized audio processing pipeline
 * - Advanced monitoring integration
 */

// Initialize the WebSocket connection
function initializeConversationalAI(voiceId, conversationId = null, campaignId = null, options = {}) {
  // Default options
  const defaultOptions = {
    enableMetrics: true,
    enableWaveform: true,
    enableEmotionDetection: true,
    audioBufferSize: 4096,
    useAdvancedPipeline: true,
    monitoringCallbacks: null
  };
  
  // Merge options
  const config = { ...defaultOptions, ...options };
  
  // Construct WebSocket URL with query parameters
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const baseUrl = window.location.hostname === 'localhost' ? 
    `${wsProtocol}//${window.location.hostname}:3001` : 
    `${wsProtocol}//${window.location.hostname}`;
  
  const queryParams = new URLSearchParams();
  if (voiceId) queryParams.append('voiceId', voiceId);
  if (conversationId) queryParams.append('conversationId', conversationId);
  if (campaignId) queryParams.append('campaignId', campaignId);
  if (config.useAdvancedPipeline) queryParams.append('useAdvancedPipeline', 'true');
  
  const wsUrl = `${baseUrl}/voice/conversational-ai?${queryParams.toString()}`;
  
  // Create WebSocket connection
  const socket = new WebSocket(wsUrl);
  let activeConversationId = conversationId;
  
  // Create audio context for playing audio
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const audioQueue = [];
  let isPlaying = false;
  
  // Metrics collection
  const metrics = {
    latency: {
      stt: 0,
      llm: 0,
      tts: 0,
      total: 0
    },
    state: 'connecting',
    waveformData: [],
    emotions: [],
    qualityScore: {
      overall: 0,
      relevance: 0,
      empathy: 0,
      clarity: 0
    },
    interruptions: 0,
    startTime: Date.now()
  };
  
  // WebSocket event handlers
  socket.onopen = () => {
    console.log('WebSocket connection established');
    metrics.state = 'connecting';
    updateMetrics();
  };
  
  socket.onmessage = async (event) => {
    try {
      // Check if the message is JSON or binary audio data
      if (event.data instanceof Blob) {
        // Handle binary audio data
        const audioBuffer = await event.data.arrayBuffer();
        queueAudioForPlayback(audioBuffer);
        
        // Update waveform data if enabled
        if (config.enableWaveform) {
          updateWaveformData(new Float32Array(audioBuffer));
        }
      } else {
        // Handle JSON control messages
        const message = JSON.parse(event.data);
        
        switch (message.type) {
          case 'ready':
            // WebSocket is ready to accept messages
            activeConversationId = message.conversationId;
            console.log('Conversational AI ready', message);
            metrics.state = 'ready';
            updateMetrics();
            break;
            
          case 'initialScript':
            // Initial script message from campaign
            console.log('Received initial script:', message);
            metrics.state = 'speaking';
            updateMetrics();
            
            // After receiving the initial script, make sure we properly transition
            // to listening state once audio playback is complete
            if (message.text) {
              console.log('Initial script text:', message.text);
              // The audio will be sent separately as binary data
            }
            break;
            
          case 'processing':
            // AI is processing the request
            console.log('Processing input...');
            metrics.state = 'processing';
            updateMetrics();
            
            // Record latency metrics if available
            if (message.metrics) {
              if (message.metrics.stt) metrics.latency.stt = message.metrics.stt;
              if (message.metrics.llm) metrics.latency.llm = message.metrics.llm;
              updateMetrics();
            }
            break;
            
          case 'speaking':
            // AI is speaking
            metrics.state = 'speaking';
            updateMetrics();
            break;
            
          case 'listening':
            // AI is listening for user input
            metrics.state = 'listening';
            updateMetrics();
            break;
            
          case 'completed':
            // Response generation completed
            console.log('Response completed', message);
            
            // Record total latency
            if (message.metrics && message.metrics.total) {
              metrics.latency.total = message.metrics.total;
              updateMetrics();
            }
            break;
            
          case 'interrupted':
            // Response was interrupted
            console.log('Response interrupted', message);
            // Clear audio queue when interrupted
            clearAudioQueue();
            
            // Record interruption
            metrics.interruptions++;
            updateMetrics();
            break;
            
          case 'emotion':
            // Emotion detection result
            if (config.enableEmotionDetection && message.emotion) {
              metrics.emotions.push({
                ...message.emotion,
                timestamp: Date.now()
              });
              updateMetrics();
            }
            break;
            
          case 'quality':
            // Conversation quality score
            if (message.qualityScore) {
              metrics.qualityScore = message.qualityScore;
              updateMetrics();
            }
            break;
            
          case 'error':
            // Error occurred
            console.error('Conversational AI error:', message.message);
            metrics.state = 'error';
            updateMetrics();
            break;
            
          default:
            console.log('Unknown message type:', message);
        }
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  };
  
  socket.onclose = (event) => {
    console.log('WebSocket connection closed:', event.code, event.reason);
    metrics.state = 'closed';
    updateMetrics();
  };
  
  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
    metrics.state = 'error';
    updateMetrics();
  };
  
  // Function to send text input to the conversational AI
  function sendText(text, language = 'English') {
    if (socket.readyState !== WebSocket.OPEN) {
      console.error('WebSocket is not open');
      return false;
    }
    
    // Update metrics
    metrics.state = 'processing';
    updateMetrics();
    
    socket.send(JSON.stringify({
      type: 'text',
      text,
      language
    }));
    
    return true;
  }
  
  // Function to interrupt the current response
  function interrupt() {
    if (socket.readyState !== WebSocket.OPEN) {
      console.error('WebSocket is not open');
      return false;
    }
    
    socket.send(JSON.stringify({
      type: 'interrupt'
    }));
    
    // Update metrics
    metrics.interruptions++;
    updateMetrics();
    
    return true;
  }
  
  // Function to close the WebSocket connection
  function close() {
    socket.close();
    metrics.state = 'closed';
    updateMetrics();
  }
  
  // Helper function to queue audio for playback
  function queueAudioForPlayback(audioBuffer) {
    audioQueue.push(audioBuffer);
    if (!isPlaying) {
      playNextInQueue();
    }
  }
  
  // Helper function to play the next audio chunk in the queue
  async function playNextInQueue() {
    if (audioQueue.length === 0) {
      isPlaying = false;
      
      // Update metrics when playback ends
      if (metrics.state === 'speaking') {
        metrics.state = 'listening';
        updateMetrics();
        
        // Signal the server that we're ready for listening mode
        // This ensures the conversation continues after initial script
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'readyToListen'
          }));
          console.log('Sent readyToListen signal');
        }
      }
      
      return;
    }
    
    isPlaying = true;
    const buffer = audioQueue.shift();
    
    try {
      // Decode the audio data
      const audioBuffer = await audioContext.decodeAudioData(buffer);
      
      // Create source node
      const source = audioContext.createBufferSource();
      source.buffer = audioBuffer;
      
      // Create analyzer for waveform data if enabled
      if (config.enableWaveform) {
        const analyzer = audioContext.createAnalyser();
        analyzer.fftSize = 256;
        
        source.connect(analyzer);
        analyzer.connect(audioContext.destination);
        
        // Start collecting waveform data
        collectWaveformData(analyzer);
      } else {
        source.connect(audioContext.destination);
      }
      
      // Play the audio
      source.start(0);
      
      // When playback ends, play the next chunk
      source.onended = () => {
        playNextInQueue();
      };
    } catch (error) {
      console.error('Error playing audio:', error);
      playNextInQueue(); // Skip to next chunk on error
    }
  }
  
  // Helper function to clear the audio queue
  function clearAudioQueue() {
    audioQueue.length = 0;
    isPlaying = false;
  }
  
  // Helper function to collect waveform data from analyzer
  function collectWaveformData(analyzer) {
    if (!config.enableWaveform) return;
    
    const dataArray = new Uint8Array(analyzer.frequencyBinCount);
    analyzer.getByteTimeDomainData(dataArray);
    
    // Convert to normalized array (-1 to 1)
    const normalizedData = Array.from(dataArray).map(value => (value / 128) - 1);
    
    // Update metrics
    metrics.waveformData = normalizedData;
    updateMetrics();
    
    // Continue collecting if playing
    if (isPlaying) {
      requestAnimationFrame(() => collectWaveformData(analyzer));
    }
  }
  
  // Helper function to update waveform data from raw audio
  function updateWaveformData(audioData) {
    if (!config.enableWaveform) return;
    
    // Downsample to reduce data size (take every Nth sample)
    const downsampleFactor = Math.floor(audioData.length / 64);
    const samples = [];
    
    for (let i = 0; i < audioData.length; i += downsampleFactor) {
      samples.push(audioData[i]);
    }
    
    // Update metrics
    metrics.waveformData = samples;
    updateMetrics();
  }
  
  // Helper function to update metrics and call callbacks
  function updateMetrics() {
    if (!config.enableMetrics) return;
    
    // Call monitoring callbacks if provided
    if (config.monitoringCallbacks) {
      const currentMetrics = {
        ...metrics,
        conversationId: activeConversationId,
        timestamp: Date.now()
      };
      
      // Call specific callbacks based on what changed
      if (config.monitoringCallbacks.onStateChange && metrics.state) {
        config.monitoringCallbacks.onStateChange({
          callId: activeConversationId,
          state: metrics.state,
          timestamp: Date.now()
        });
      }
      
      if (config.monitoringCallbacks.onWaveformUpdate && metrics.waveformData) {
        config.monitoringCallbacks.onWaveformUpdate({
          callId: activeConversationId,
          waveformData: metrics.waveformData,
          timestamp: Date.now()
        });
      }
      
      if (config.monitoringCallbacks.onLatencyUpdate && metrics.latency) {
        config.monitoringCallbacks.onLatencyUpdate({
          callId: activeConversationId,
          latency: metrics.latency,
          timestamp: Date.now()
        });
      }
      
      // Call general callback with all metrics
      if (config.monitoringCallbacks.onMetricsUpdate) {
        config.monitoringCallbacks.onMetricsUpdate(currentMetrics);
      }
    }
  }
  
  // Return the public API
  return {
    // Core functions
    sendText,
    interrupt,
    close,
    getConversationId: () => activeConversationId,
    
    // Metrics and monitoring
    getMetrics: () => ({ ...metrics }),
    getState: () => metrics.state,
    getLatency: () => ({ ...metrics.latency }),
    getWaveformData: () => [...metrics.waveformData],
    
    // Audio control
    clearAudio: clearAudioQueue,
    
    // Socket access (for advanced usage)
    getSocket: () => socket
  };
}

// Example usage:
/*
// Initialize with monitoring callbacks
const conversationalAI = initializeConversationalAI(
  'voice-id-here', 
  null, 
  'campaign-id-here',
  {
    enableMetrics: true,
    enableWaveform: true,
    monitoringCallbacks: {
      onStateChange: (data) => {
        console.log('Call state changed:', data.state);
        // Update UI with new state
      },
      onWaveformUpdate: (data) => {
        // Update waveform visualization
        updateWaveformVisualization(data.waveformData);
      },
      onLatencyUpdate: (data) => {
        // Update latency display
        updateLatencyMetrics(data.latency);
      },
      onMetricsUpdate: (allMetrics) => {
        // Update comprehensive dashboard
        updateDashboard(allMetrics);
      }
    }
  }
);

// Send a message
document.getElementById('sendButton').addEventListener('click', () => {
  const text = document.getElementById('userInput').value;
  conversationalAI.sendText(text);
});

// Interrupt the response
document.getElementById('interruptButton').addEventListener('click', () => {
  conversationalAI.interrupt();
});

// Close the connection when done
document.getElementById('closeButton').addEventListener('click', () => {
  conversationalAI.close();
});

// Get current metrics for display
const displayMetrics = () => {
  const metrics = conversationalAI.getMetrics();
  console.log('Current metrics:', metrics);
};
*/

// Export the function for use in other modules
export default initializeConversationalAI;

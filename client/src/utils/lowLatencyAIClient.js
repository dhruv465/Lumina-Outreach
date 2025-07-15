/**
 * Low-Latency Conversational AI WebSocket Client
 * 
 * Optimized for human-like interactions with reduced latency
 * Uses parallel processing and chunked responses for more natural conversations
 */

// Initialize the WebSocket connection with low-latency endpoint
function initializeLowLatencyAI(voiceId, callId = null, conversationId = null) {
  // Construct WebSocket URL with query parameters
  const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const baseUrl = window.location.hostname === 'localhost' ? 
    `${wsProtocol}//${window.location.hostname}:3001` : 
    `${wsProtocol}//${window.location.hostname}`;
  
  const queryParams = new URLSearchParams();
  if (voiceId) queryParams.append('voiceId', voiceId);
  if (callId) queryParams.append('callId', callId);
  if (conversationId) queryParams.append('conversationId', conversationId);
  
  // Use the new low-latency endpoint
  const wsUrl = `${baseUrl}/voice/low-latency?${queryParams.toString()}`;
  
  // Create WebSocket connection
  const socket = new WebSocket(wsUrl);
  let activeConversationId = conversationId;
  
  // Create audio context for playing audio
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const audioQueue = [];
  let isPlaying = false;
  let currentAudioSource = null;
  
  // State for tracking voice activity
  let isListening = false;
  let thinkingSoundPlayed = false;
  let lastActivityTime = Date.now();
  
  // Event callbacks
  const eventCallbacks = {
    onReady: null,
    onThinking: null,
    onSpeaking: null,
    onInterrupted: null,
    onError: null,
    onClose: null,
    onProcessingStart: null,
    onProcessingComplete: null
  };
  
  // WebSocket event handlers
  socket.onopen = () => {
    console.log('Low-latency WebSocket connection established');
    if (eventCallbacks.onReady) eventCallbacks.onReady();
  };
  
  socket.onmessage = async (event) => {
    try {
      lastActivityTime = Date.now();
      
      // Check if the message is binary audio data
      if (event.data instanceof Blob) {
        // Handle binary audio data
        const audioBuffer = await event.data.arrayBuffer();
        
        // If this is the first chunk, signal that speaking has started
        if (audioQueue.length === 0 && !isPlaying) {
          if (eventCallbacks.onSpeaking) eventCallbacks.onSpeaking();
        }
        
        // Queue audio for immediate playback
        queueAudioForPlayback(audioBuffer);
        
        // Reset thinking sound flag when we get actual speech
        thinkingSoundPlayed = false;
      } else {
        // Handle JSON control messages (if any)
        try {
          const message = JSON.parse(event.data);
          
          switch (message.type) {
            case 'thinking':
              // AI is thinking about the response
              thinkingSoundPlayed = true;
              if (eventCallbacks.onThinking) eventCallbacks.onThinking();
              break;
              
            case 'processing_start':
              // AI has started processing the input
              if (eventCallbacks.onProcessingStart) eventCallbacks.onProcessingStart();
              break;
              
            case 'processing_complete':
              // AI has completed processing
              if (eventCallbacks.onProcessingComplete) eventCallbacks.onProcessingComplete(message.text);
              break;
              
            case 'error':
              // Error occurred
              console.error('Low-latency AI error:', message.message);
              if (eventCallbacks.onError) eventCallbacks.onError(message.message);
              break;
              
            default:
              console.log('Unknown message type:', message);
          }
        } catch (jsonError) {
          // Not JSON data, might be plain text or other format
          console.log('Non-JSON message received:', event.data);
        }
      }
    } catch (error) {
      console.error('Error processing WebSocket message:', error);
    }
  };
  
  socket.onclose = (event) => {
    console.log('WebSocket connection closed:', event.code, event.reason);
    if (eventCallbacks.onClose) eventCallbacks.onClose(event);
  };
  
  socket.onerror = (error) => {
    console.error('WebSocket error:', error);
    if (eventCallbacks.onError) eventCallbacks.onError(error);
  };
  
  // Function to send text input to the conversational AI
  function sendText(text, language = 'English') {
    if (socket.readyState !== WebSocket.OPEN) {
      console.error('WebSocket is not open');
      return false;
    }
    
    // If currently playing audio, stop it to prioritize new input
    if (isPlaying && currentAudioSource) {
      currentAudioSource.stop();
      clearAudioQueue();
    }
    
    socket.send(JSON.stringify({
      type: 'text',
      text: text,
      language: language
    }));
    
    return true;
  }
  
  // Function to send audio input to the conversational AI
  function sendAudio(audioBlob) {
    if (socket.readyState !== WebSocket.OPEN) {
      console.error('WebSocket is not open');
      return false;
    }
    
    socket.send(audioBlob);
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
    
    // Clear audio queue when interrupted
    clearAudioQueue();
    
    if (eventCallbacks.onInterrupted) eventCallbacks.onInterrupted();
    
    return true;
  }
  
  // Queue audio for immediate playback with reduced latency
  function queueAudioForPlayback(audioBuffer) {
    audioQueue.push(audioBuffer);
    
    // Start playback if not already playing
    if (!isPlaying) {
      playNextInQueue();
    }
  }
  
  // Play the next audio chunk in the queue
  function playNextInQueue() {
    if (audioQueue.length === 0) {
      isPlaying = false;
      currentAudioSource = null;
      
      // After all audio has finished playing, indicate we're ready to listen
      // This helps ensure proper state transitions, especially after the opening message
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'readyToListen'
        }));
        console.log('Sent readyToListen signal');
        
        // Notify the event handler that we're now listening
        if (eventCallbacks.onProcessingComplete) {
          eventCallbacks.onProcessingComplete();
        }
      }
      
      return;
    }
    
    isPlaying = true;
    const audioBuffer = audioQueue.shift();
    
    // Decode the audio data
    audioContext.decodeAudioData(audioBuffer, (decodedData) => {
      // Create audio source
      const source = audioContext.createBufferSource();
      source.buffer = decodedData;
      source.connect(audioContext.destination);
      
      // Store current source for potential interruption
      currentAudioSource = source;
      
      // Play the audio
      source.start(0);
      
      // When finished, play the next chunk
      source.onended = () => {
        currentAudioSource = null;
        playNextInQueue();
      };
    }, (error) => {
      console.error('Error decoding audio data:', error);
      playNextInQueue(); // Skip to next chunk
    });
  }
  
  // Clear the audio queue
  function clearAudioQueue() {
    audioQueue.length = 0;
    isPlaying = false;
  }
  
  // Set up voice activity detection to auto-interrupt when user speaks
  function setupVoiceActivityDetection(stream, threshold = 0.05) {
    if (!stream) return null;
    
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const analyser = audioContext.createAnalyser();
    const microphone = audioContext.createMediaStreamSource(stream);
    microphone.connect(analyser);
    
    analyser.fftSize = 256;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    let voiceActivityDetector = setInterval(() => {
      // If we're already listening or there's no activity to detect, skip
      if (!isPlaying || !currentAudioSource) return;
      
      analyser.getByteFrequencyData(dataArray);
      
      // Calculate average volume level
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
      }
      
      const average = sum / bufferLength / 255; // Normalize to 0-1
      
      // If volume exceeds threshold, interrupt current speech
      if (average > threshold) {
        console.log('Voice activity detected, interrupting AI speech');
        interrupt();
        isListening = true;
      }
    }, 100); // Check every 100ms
    
    return {
      stop: () => {
        if (voiceActivityDetector) {
          clearInterval(voiceActivityDetector);
          voiceActivityDetector = null;
        }
      }
    };
  }
  
  // Close the WebSocket connection
  function close() {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  }
  
  // Register event handlers
  function on(event, callback) {
    if (eventCallbacks.hasOwnProperty(`on${event}`)) {
      eventCallbacks[`on${event}`] = callback;
    } else {
      console.warn(`Unknown event: ${event}`);
    }
  }
  
  // Check for inactivity and automatically clean up resources
  const inactivityTimer = setInterval(() => {
    const inactiveTime = Date.now() - lastActivityTime;
    if (inactiveTime > 5 * 60 * 1000) { // 5 minutes
      console.log('Connection inactive for 5 minutes, closing automatically');
      close();
      clearInterval(inactivityTimer);
    }
  }, 60 * 1000); // Check every minute
  
  // Return public interface
  return {
    sendText,
    sendAudio,
    interrupt,
    close,
    on,
    setupVoiceActivityDetection,
    getConversationId: () => activeConversationId
  };
}

export default initializeLowLatencyAI;

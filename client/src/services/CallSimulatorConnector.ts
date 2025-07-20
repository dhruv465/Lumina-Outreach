// CallSimulatorConnector.ts
// This utility handles the WebSocket connection for the call simulator with built-in fallback mechanisms

import api from '@/services/api';

interface CallSimulatorConnectorOptions {
  onLog: (message: string) => void;
  onConnectionStatus: (status: string) => void;
  onTranscription: (text: string) => void;
  onAgentResponse: (text: string, audioUrl?: string) => void;
  onCallEnded: () => void;
  onError: (message: string) => void;
}

export class CallSimulatorConnector {
  private socket: WebSocket | null = null;
  private options: CallSimulatorConnectorOptions;
  private connectionAttemptTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 3;
  private campaignId: string | null = null;
  private agentId: string | null = null;
  private language: string = 'en';
  private model: string = 'nova-3';
  private systemPrompt: string = '';

  constructor(options: CallSimulatorConnectorOptions) {
    this.options = options;
  }

  // Configure the call simulator with necessary parameters
  public configure(params: {
    campaignId?: string | null;
    agentId?: string | null;
    language?: string;
    model?: string;
    systemPrompt?: string;
  }) {
    this.campaignId = params.campaignId || null;
    this.agentId = params.agentId || null;
    this.language = params.language || 'en';
    this.model = params.model || 'nova-3';
    this.systemPrompt = params.systemPrompt || '';
    
    return this;
  }

  // Initialize WebSocket connection with fallback options
  public connect(): Promise<boolean> {
    return new Promise((resolve) => {
      this.reconnectAttempts = 0;
      this.attemptWebSocketConnection(resolve);
    });
  }

  // Send audio data via WebSocket or HTTP fallback
  public sendAudio(audioBlob: Blob): Promise<boolean> {
    return new Promise(async (resolve) => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        // If WebSocket is connected, send directly
        this.socket.send(audioBlob);
        this.options.onLog('Audio sent via WebSocket');
        resolve(true);
      } else {
        // Otherwise use HTTP fallback
        this.options.onLog('Using HTTP fallback for audio processing');
        
        try {
          const success = await this.sendAudioViaHttp(audioBlob);
          resolve(success);
        } catch (err) {
          this.options.onError(`Error sending audio: ${err}`);
          resolve(false);
        }
      }
    });
  }

  // Start a call
  public startCall(): Promise<boolean> {
    return new Promise(async (resolve) => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        // Start call via WebSocket
        const startCallMessage = JSON.stringify({
          type: 'start_call'
        });
        this.socket.send(startCallMessage);
        this.options.onLog('Call initiated via WebSocket');
        resolve(true);
      } else {
        // Start call via HTTP fallback
        this.options.onLog('Starting call via HTTP fallback');
        
        try {
          const response = await api.post('/call-simulator/fallback/start', {
            campaignId: this.campaignId,
            agentId: this.agentId,
            language: this.language,
            model: this.model,
            systemPrompt: this.systemPrompt
          });
          
          if (response.data.success) {
            this.options.onAgentResponse(
              response.data.greeting || "Hello, this is an AI assistant. How can I help you today?", 
              response.data.audioUrl
            );
            this.options.onLog(`Call started via HTTP fallback with greeting: ${response.data.greeting}`);
            resolve(true);
          } else {
            this.options.onError(`Failed to start call: ${response.data.error || 'Unknown error'}`);
            resolve(false);
          }
        } catch (err: any) {
          this.options.onError(`Error starting call: ${err.message || err}`);
          
          // Still provide a fallback greeting even if the API fails
          this.options.onAgentResponse(
            "Hello, this is an AI assistant. I'm having some connection issues, but I'll do my best to help you.",
            null
          );
          this.options.onLog('Using emergency fallback greeting due to API failure');
          
          resolve(true);
        }
      }
    });
  }

  // End an active call
  public endCall(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const endCallMessage = JSON.stringify({
        type: 'end_call'
      });
      this.socket.send(endCallMessage);
      this.options.onLog('Call ended via WebSocket');
    }
    
    this.disconnect();
  }

  // Disconnect and clean up resources
  public disconnect(): void {
    if (this.connectionAttemptTimeout) {
      clearTimeout(this.connectionAttemptTimeout);
      this.connectionAttemptTimeout = null;
    }
    
    if (this.socket) {
      try {
        this.socket.close();
      } catch (err) {
        console.error('Error closing WebSocket:', err);
      }
      this.socket = null;
    }
    
    this.options.onConnectionStatus('disconnected');
  }

  // Private method to attempt WebSocket connection
  private attemptWebSocketConnection(resolve: (success: boolean) => void): void {
    try {
      // Try multiple possible WebSocket URLs
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      
      // Primary URL from environment variable
      const primaryBaseUrl = import.meta.env.VITE_API_URL || `${wsProtocol}//${window.location.host}/api`;
      const primaryWsUrl = primaryBaseUrl.replace(/^https?:\/\//, `${wsProtocol}//`) + '/call-simulator/ws';
      
      // Alternative URL formats to try (direct localhost connection)
      const alternativeWsUrl = `${wsProtocol}//localhost:3000/api/call-simulator/ws`;
      
      // Select URL based on connection attempt
      const wsUrl = this.reconnectAttempts === 0 ? primaryWsUrl : alternativeWsUrl;
      
      this.options.onLog(`Connecting to WebSocket at ${wsUrl} (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts + 1})...`);
      this.options.onConnectionStatus('connecting');
      
      this.socket = new WebSocket(wsUrl);
      
      // Set up event handlers
      this.socket.onopen = () => {
        if (this.connectionAttemptTimeout) {
          clearTimeout(this.connectionAttemptTimeout);
          this.connectionAttemptTimeout = null;
        }
        
        this.options.onConnectionStatus('connected');
        this.options.onLog('WebSocket connection established');
        
        // Send configuration message
        const configMessage = JSON.stringify({
          type: 'config',
          language: this.language,
          model: this.model,
          campaignId: this.campaignId,
          agentId: this.agentId
        });
        this.socket?.send(configMessage);
        
        resolve(true);
      };
      
      this.socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          switch (data.type) {
            case 'transcription':
              this.options.onTranscription(data.text);
              this.options.onLog(`Received transcription: ${data.text}`);
              break;
              
            case 'agent_response':
              this.options.onAgentResponse(data.text, data.audioUrl);
              this.options.onLog(`Received agent response: ${data.text}`);
              break;
              
            case 'greeting':
              this.options.onAgentResponse(data.text, data.audioUrl);
              this.options.onLog(`Agent greeting: ${data.text}`);
              break;
              
            case 'call_ended':
              this.options.onCallEnded();
              this.options.onLog('Call ended');
              break;
              
            case 'error':
              this.options.onError(data.message);
              this.options.onLog(`Error: ${data.message}`);
              break;
              
            default:
              this.options.onLog(`Received unknown message type: ${data.type}`);
          }
        } catch (err) {
          this.options.onLog(`Error parsing WebSocket message: ${err}`);
        }
      };
      
      this.socket.onclose = () => {
        this.options.onConnectionStatus('disconnected');
        this.options.onLog('WebSocket connection closed');
      };
      
      this.socket.onerror = (error) => {
        this.options.onLog(`WebSocket error: ${error}`);
        
        // Try to reconnect if we haven't exceeded max attempts
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          this.options.onLog(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          this.attemptWebSocketConnection(resolve);
        } else {
          this.options.onConnectionStatus('error');
          this.options.onLog('Failed to establish WebSocket connection after multiple attempts');
          
          // We still resolve as true, and will use HTTP fallback for operations
          resolve(true);
        }
      };
      
      // Set a timeout for the connection attempt
      this.connectionAttemptTimeout = setTimeout(() => {
        if (this.socket && this.socket.readyState !== WebSocket.OPEN) {
          this.options.onLog('WebSocket connection timeout');
          
          // Try to reconnect if we haven't exceeded max attempts
          if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            this.options.onLog(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
            
            // Close the timed-out socket
            this.socket.close();
            
            // Try to connect again
            this.attemptWebSocketConnection(resolve);
          } else {
            this.options.onConnectionStatus('error');
            this.options.onLog('Failed to establish WebSocket connection after multiple attempts');
            
            // We still resolve as true, and will use HTTP fallback for operations
            resolve(true);
          }
        }
      }, 5000); // 5 second timeout
    } catch (err) {
      this.options.onLog(`Error initializing WebSocket: ${err}`);
      this.options.onConnectionStatus('error');
      
      // If we encounter an error during initialization, we still resolve true and will use HTTP fallback
      resolve(true);
    }
  }

  // Private method to send audio via HTTP fallback
  private async sendAudioViaHttp(audioBlob: Blob): Promise<boolean> {
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.wav');
      formData.append('language', this.language);
      formData.append('model', this.model);
      
      if (this.campaignId) {
        formData.append('campaignId', this.campaignId);
      }
      
      if (this.agentId) {
        formData.append('agentId', this.agentId);
      }
      
      const response = await api.post('/call-simulator/transcribe-file', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        }
      });
      
      if (response.data.success) {
        const transcriptText = response.data.transcript || '';
        this.options.onTranscription(transcriptText);
        this.options.onLog(`HTTP fallback transcription: ${transcriptText}`);
        
        // Handle agent response if available
        if (response.data.agentResponse) {
          this.options.onAgentResponse(response.data.agentResponse, response.data.audioUrl);
          this.options.onLog(`HTTP fallback agent response: ${response.data.agentResponse}`);
        }
        
        return true;
      } else {
        this.options.onError(`Transcription failed: ${response.data.error}`);
        return false;
      }
    } catch (err: any) {
      this.options.onError(`Error in HTTP fallback: ${err.message || err}`);
      
      // Generate a generic response when HTTP fails
      const genericResponse = "I'm having trouble connecting to my systems right now. Could you please try again or check your connection?";
      this.options.onAgentResponse(genericResponse);
      
      return false;
    }
  }
}

export default CallSimulatorConnector;

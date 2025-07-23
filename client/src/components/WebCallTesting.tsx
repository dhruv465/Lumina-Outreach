import React, { useState, useEffect, useRef, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import WebCallAudioProcessor, { AudioProcessorErrorType, AudioProcessorError } from './WebCallAudioProcessor';
import WebCallAudioPlayer from './WebCallAudioPlayer';
import WebCallTranscript from './WebCallTranscript';
import WebCallControls from './WebCallControls';
import WebCallTranscriptExport from './WebCallTranscriptExport';
import RealTimeCallMonitoring from './RealTimeCallMonitoring';
import WebCallDebugPanel from './WebCallDebugPanel';
import { Card } from './ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Skeleton } from './ui/skeleton';
import { Badge } from './ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from './ui/button';

// Types
interface WebCallTestingProps {
  campaignId?: string;
  onCallEnd?: (callData: WebCallResult) => void;
  height?: string | number;
  width?: string | number;
  className?: string;
}

interface Campaign {
  _id: string;
  name: string;
  description: string;
  status: 'Draft' | 'Active' | 'Paused' | 'Completed';
}

interface WebCallState {
  status: 'idle' | 'connecting' | 'connected' | 'speaking' | 'listening' | 'processing' | 'ended' | 'error';
  transcript: TranscriptEntry[];
  currentSpeaker: 'agent' | 'user' | null;
  error?: string;
}

interface WebCallError {
  type: 'connection' | 'audio_permission' | 'audio_playback' | 'server' | 'unknown';
  message: string;
  timestamp: number;
  recoverable: boolean;
  details?: string;
}

interface TranscriptEntry {
  id: string;
  speaker: 'agent' | 'user';
  text: string;
  timestamp: number;
  isFinal: boolean;
}

interface WebCallResult {
  callId: string;
  duration: number;
  transcript: TranscriptEntry[];
  metrics: {
    responseTime: number;
    userSpeakingTime: number;
    agentSpeakingTime: number;
    interruptions: number;
  };
  campaignId: string;
  startTime: Date;
  endTime: Date;
}

/**
 * WebCallTesting Component
 * 
 * Provides a web-based interface for testing campaign agents without making actual phone calls
 */
const WebCallTesting: React.FC<WebCallTestingProps> = ({
  campaignId: initialCampaignId,
  onCallEnd,
  height = '100%',
  width = '100%',
  className = ''
}) => {
  // State
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | undefined>(initialCampaignId);
  const [callState, setCallState] = useState<WebCallState>({
    status: 'idle',
    transcript: [],
    currentSpeaker: null
  });
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [currentAudioBuffer, setCurrentAudioBuffer] = useState<ArrayBuffer | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<any>({});
  const [activeTab, setActiveTab] = useState<string>('transcript');
  const [error, setError] = useState<WebCallError | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  
  // Refs
  const audioProcessorRef = useRef<WebCallAudioProcessor | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const socketUrlRef = useRef<string>('');
  
  // Error handling methods
  const handleError = useCallback((
    errorType: WebCallError['type'], 
    message: string, 
    recoverable: boolean = true, 
    details?: string
  ) => {
    const newError: WebCallError = {
      type: errorType,
      message,
      timestamp: Date.now(),
      recoverable,
      details
    };
    
    setError(newError);
    
    // Update call state
    setCallState(prev => ({
      ...prev,
      status: 'error',
      error: message
    }));
    
    // Log error for debugging
    console.error(`WebCallTesting error (${errorType}):`, message, details || '');
    
    return newError;
  }, []);
  
  // Connection recovery
  const attemptReconnect = useCallback(() => {
    if (reconnectAttempts >= 3 || !error?.recoverable) {
      return;
    }
    
    setIsRecovering(true);
    
    // Clear any existing timeout
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
    }
    
    // Exponential backoff for reconnection attempts
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
    
    reconnectTimeoutRef.current = window.setTimeout(() => {
      setReconnectAttempts(prev => prev + 1);
      
      // Attempt to reconnect based on error type
      if (error?.type === 'connection') {
        // Try to reconnect socket
        if (socketUrlRef.current) {
          const newSocket = io(socketUrlRef.current, {
            path: '/webcall',
            transports: ['websocket'],
            reconnectionAttempts: 3,
            reconnectionDelay: 1000,
            timeout: 10000
          });
          
          setupSocketEventHandlers(newSocket);
          setSocket(newSocket);
        }
      } else if (error?.type === 'audio_permission') {
        // Try to restart audio processor
        if (audioProcessorRef.current) {
          audioProcessorRef.current.attemptRecovery()
            .then(() => {
              setError(null);
              setIsRecovering(false);
              setReconnectAttempts(0);
            })
            .catch(() => {
              setIsRecovering(false);
            });
        }
      } else if (error?.type === 'audio_playback') {
        // Reset audio state
        setCurrentAudioBuffer(null);
        setIsRecovering(false);
      } else {
        // Generic recovery - try to restart the call
        if (callState.status !== 'idle') {
          endCall();
        }
        setIsRecovering(false);
      }
    }, delay);
    
  }, [error, reconnectAttempts, callState.status]);
  
  // Reset error state
  const resetErrorState = useCallback(() => {
    setError(null);
    setIsRecovering(false);
    setReconnectAttempts(0);
    
    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);
  
  // Fetch available campaigns
  const { data: campaignsData, isLoading: isLoadingCampaigns } = useQuery({
    queryKey: ['campaigns-for-testing'],
    queryFn: async () => {
      try {
        const response = await api.get('/campaigns?status=Active,Draft,Paused');
        return response.data?.campaigns || [];
      } catch (err) {
        console.error('Error fetching campaigns for testing:', err);
        return [];
      }
    },
    staleTime: 30000, // 30 seconds
  });
  
  // Initialize audio processor
  useEffect(() => {
    audioProcessorRef.current = new WebCallAudioProcessor({
      onAudioData: handleAudioData,
      onSilence: handleSilence,
      onSpeaking: handleSpeaking,
      onError: handleAudioError,
      onRecoveryAttempt: handleRecoveryAttempt,
      onRecoverySuccess: handleRecoverySuccess,
      silenceThreshold: 0.05,
      silenceTimeout: 1500,
      autoRecovery: true,
      maxRecoveryAttempts: 3
    });
    
    return () => {
      // Clean up audio processor
      if (audioProcessorRef.current) {
        audioProcessorRef.current.destroy();
        audioProcessorRef.current = null;
      }
      
      // Clear any reconnect timeout
      if (reconnectTimeoutRef.current !== null) {
        window.clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, []);
  
  // Handle campaign ID changes from props
  useEffect(() => {
    if (initialCampaignId && initialCampaignId !== selectedCampaignId) {
      setSelectedCampaignId(initialCampaignId);
    }
  }, [initialCampaignId]);
  
  // Audio handlers
  const handleAudioData = useCallback((audioBuffer: ArrayBuffer) => {
    if (socket && isConnected && !isMuted) {
      try {
        socket.emit('webcall:audio', { 
          callId, 
          audio: audioBuffer 
        });
      } catch (error) {
        // Handle socket emit errors
        handleError(
          'connection',
          'Failed to send audio data to server',
          true,
          error instanceof Error ? error.message : String(error)
        );
      }
    }
  }, [socket, isConnected, isMuted, callId, handleError]);
  
  const handleSilence = useCallback((duration: number) => {
    if (socket && isConnected && callState.currentSpeaker === 'user') {
      try {
        socket.emit('webcall:silence', { 
          callId, 
          duration 
        });
        
        // Update state to show we're no longer speaking
        setCallState(prev => ({
          ...prev,
          currentSpeaker: null
        }));
      } catch (error) {
        // Non-critical error, just log it
        console.warn('Failed to send silence event:', error);
      }
    }
  }, [socket, isConnected, callState.currentSpeaker, callId]);
  
  const handleSpeaking = useCallback(() => {
    if (socket && isConnected && callState.currentSpeaker !== 'user') {
      setCallState(prev => ({
        ...prev,
        currentSpeaker: 'user'
      }));
    }
  }, [socket, isConnected, callState.currentSpeaker]);
  
  const handleAudioError = useCallback((error: AudioProcessorError) => {
    console.error('Audio processor error:', error);
    
    // Map audio processor error types to WebCallError types
    let errorType: WebCallError['type'] = 'unknown';
    let recoverable = error.recoverable;
    
    switch (error.type) {
      case AudioProcessorErrorType.PERMISSION_DENIED:
        errorType = 'audio_permission';
        break;
      case AudioProcessorErrorType.DEVICE_NOT_FOUND:
        errorType = 'audio_permission';
        break;
      case AudioProcessorErrorType.PLAYBACK_ERROR:
        errorType = 'audio_playback';
        break;
      case AudioProcessorErrorType.RECORDING_ERROR:
        errorType = 'audio_permission';
        break;
      case AudioProcessorErrorType.CONTEXT_ERROR:
        errorType = 'audio_playback';
        break;
      default:
        errorType = 'unknown';
    }
    
    handleError(
      errorType,
      error.message,
      recoverable,
      error.originalError?.message
    );
  }, [handleError]);
  
  const handleRecoveryAttempt = useCallback((error: AudioProcessorError) => {
    setIsRecovering(true);
    console.log(`Attempting to recover from ${error.type} error: ${error.message}`);
  }, []);
  
  const handleRecoverySuccess = useCallback(() => {
    setIsRecovering(false);
    setError(null);
    setReconnectAttempts(0);
    
    // Update call state if it was in error
    if (callState.status === 'error') {
      setCallState(prev => ({
        ...prev,
        status: isConnected ? 'connected' : 'idle',
        error: undefined
      }));
    }
    
    console.log('Successfully recovered from audio error');
  }, [isConnected, callState.status]);
  
  // Set up socket event handlers
  const setupSocketEventHandlers = useCallback((newSocket: Socket) => {
    // Clear any previous event listeners if socket is being reused
    newSocket.removeAllListeners();
    
    newSocket.on('connect', () => {
      console.log('Connected to web call server');
      setIsConnected(true);
      resetErrorState();
      
      // Initialize web call session via API first to get testId
      api.post('/webcall/initialize', { campaignId: selectedCampaignId })
        .then(response => {
          if (response.data.success) {
            setTestId(response.data.testId);
            // Then initialize the WebSocket connection with the session ID
            newSocket.emit('webcall:initialize', { 
              sessionId: response.data.sessionId,
              campaignId: selectedCampaignId,
              userId: response.data.userId || 'current-user',
              testId: response.data.testId
            });
          }
        })
        .catch(error => {
          console.error('Failed to initialize web call:', error);
          handleError(
            'server',
            'Failed to initialize web call session',
            true,
            error.response?.data?.message || error.message
          );
        });
    });
    
    newSocket.on('connect_error', (error) => {
      console.error('Connection error:', error);
      handleError(
        'connection',
        'Failed to connect to web call server',
        true,
        error.message
      );
    });
    
    newSocket.on('connect_timeout', () => {
      handleError(
        'connection',
        'Connection to web call server timed out',
        true
      );
    });
    
    newSocket.on('disconnect', (reason) => {
      console.log('Disconnected from web call server:', reason);
      setIsConnected(false);
      
      // Update state if call was active
      if (callState.status !== 'idle' && callState.status !== 'ended') {
        // Different handling based on disconnect reason
        if (reason === 'io server disconnect') {
          // Server disconnected us
          handleError(
            'server',
            'Server closed the connection',
            false
          );
        } else if (reason === 'transport close' || reason === 'ping timeout') {
          // Network issue, potentially recoverable
          handleError(
            'connection',
            'Connection to server lost',
            true,
            `Reason: ${reason}`
          );
          
          // Auto-attempt reconnect
          attemptReconnect();
        } else {
          // Other disconnect reasons
          handleError(
            'connection',
            'Disconnected from web call server',
            true,
            `Reason: ${reason}`
          );
        }
      }
    });
    
    // Handle call state updates
    newSocket.on('webcall:state', (data: { callId: string; state: WebCallState['status'] }) => {
      setCallId(data.callId);
      setCallState(prev => ({
        ...prev,
        status: data.state
      }));
      
      // Start recording when connected
      if (data.state === 'connected' && audioProcessorRef.current) {
        audioProcessorRef.current.startRecording().catch(error => {
          // Error is handled by the audio processor's onError callback
          console.error('Failed to start recording:', error);
        });
      }
    });
    
    // Handle transcript updates
    newSocket.on('webcall:transcript', (data: TranscriptEntry) => {
      setCallState(prev => ({
        ...prev,
        transcript: [...prev.transcript, data]
      }));
    });
    
    // Handle agent audio
    newSocket.on('webcall:agentAudio', (data: { audio: ArrayBuffer }) => {
      setCurrentAudioBuffer(data.audio);
      setCallState(prev => ({
        ...prev,
        currentSpeaker: 'agent'
      }));
    });
    
    // Handle call end
    newSocket.on('webcall:end', (data: WebCallResult) => {
      // Stop recording
      if (audioProcessorRef.current) {
        audioProcessorRef.current.stopRecording();
      }
      
      // Update state
      setCallState(prev => ({
        ...prev,
        status: 'ended',
        currentSpeaker: null
      }));
      
      // Reset error state
      resetErrorState();
      
      // Call onCallEnd callback if provided
      if (onCallEnd) {
        onCallEnd(data);
      }
    });
    
    // Handle metrics updates
    newSocket.on('webcall:metrics', (data: any) => {
      setMetrics(data);
    });
    
    // Handle errors
    newSocket.on('webcall:error', (error: { message: string; type?: string; recoverable?: boolean }) => {
      console.error('Web call error:', error);
      
      handleError(
        error.type as WebCallError['type'] || 'server',
        error.message,
        error.recoverable !== undefined ? error.recoverable : true
      );
    });
    
    // Handle reconnect events
    newSocket.io.on('reconnect', (attempt) => {
      console.log(`Reconnected to server after ${attempt} attempts`);
      resetErrorState();
      
      // Update call state
      setCallState(prev => ({
        ...prev,
        status: 'connected',
        error: undefined
      }));
    });
    
    newSocket.io.on('reconnect_attempt', (attempt) => {
      console.log(`Reconnection attempt ${attempt}`);
      setIsRecovering(true);
    });
    
    newSocket.io.on('reconnect_error', (error) => {
      console.error('Reconnection error:', error);
    });
    
    newSocket.io.on('reconnect_failed', () => {
      handleError(
        'connection',
        'Failed to reconnect to server after multiple attempts',
        false
      );
      setIsRecovering(false);
    });
  }, [selectedCampaignId, callState.status, handleError, resetErrorState, attemptReconnect]);
  
  // Call control handlers
  const startCall = async () => {
    if (!selectedCampaignId) {
      handleError(
        'unknown',
        'Please select a campaign before starting a call',
        true
      );
      return;
    }
    
    try {
      // Reset state
      resetErrorState();
      
      // Update state to connecting
      setCallState({
        status: 'connecting',
        transcript: [],
        currentSpeaker: null
      });
      
      // Initialize WebSocket connection
      const socketUrl = window.location.hostname === 'localhost' 
        ? `${window.location.protocol}//${window.location.hostname}:3001` 
        : `${window.location.protocol}//${window.location.hostname}`;
      
      // Store socket URL for reconnection attempts
      socketUrlRef.current = socketUrl;
      
      const newSocket = io(socketUrl, {
        path: '/webcall',
        transports: ['websocket'],
        reconnectionAttempts: 3,
        reconnectionDelay: 1000,
        timeout: 10000
      });
      
      // Set up event handlers
      setupSocketEventHandlers(newSocket);
      
      // Save socket reference
      setSocket(newSocket);
    } catch (error) {
      console.error('Error starting call:', error);
      handleError(
        'unknown',
        `Failed to start call: ${error instanceof Error ? error.message : 'Unknown error'}`,
        false
      );
    }
  };
  
  const endCall = () => {
    // Reset error state
    resetErrorState();
    
    // Emit end call event
    if (socket && isConnected) {
      try {
        socket.emit('webcall:end', { callId, testId });
      } catch (error) {
        console.error('Error emitting end call event:', error);
      }
      
      // Also call the API to ensure the test is properly ended
      if (callId && testId) {
        api.post(`/webcall/end/${callId}`, { testId })
          .catch(error => {
            console.error('Error ending web call via API:', error);
          });
      }
    }
    
    // Stop recording
    if (audioProcessorRef.current) {
      try {
        audioProcessorRef.current.stopRecording();
      } catch (error) {
        console.error('Error stopping recording:', error);
      }
    }
    
    // Disconnect socket
    if (socket) {
      try {
        socket.disconnect();
      } catch (error) {
        console.error('Error disconnecting socket:', error);
      }
      setSocket(null);
      setIsConnected(false);
    }
    
    // Update state to ended (not idle) so export functionality is available
    setCallState(prev => ({
      ...prev,
      status: 'ended',
      currentSpeaker: null,
      error: undefined
    }));
    
    // Keep callId and testId for export functionality
  };
  
  const toggleMute = () => {
    setIsMuted(!isMuted);
    
    // Pause or resume recording based on mute state
    if (audioProcessorRef.current) {
      if (!isMuted) {
        audioProcessorRef.current.pauseRecording();
      } else {
        audioProcessorRef.current.resumeRecording();
      }
    }
  };
  
  // Get status indicator color
  const getStatusColor = () => {
    switch (callState.status) {
      case 'idle':
        return 'bg-gray-400';
      case 'connecting':
        return 'bg-yellow-500';
      case 'connected':
        return 'bg-blue-500';
      case 'speaking':
        return 'bg-green-500';
      case 'listening':
        return 'bg-blue-500';
      case 'processing':
        return 'bg-purple-500';
      case 'ended':
        return 'bg-gray-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-400';
    }
  };
  
  // Get status label
  const getStatusLabel = () => {
    switch (callState.status) {
      case 'idle':
        return 'Ready';
      case 'connecting':
        return 'Connecting...';
      case 'connected':
        return 'Connected';
      case 'speaking':
        return 'Agent Speaking';
      case 'listening':
        return 'Listening';
      case 'processing':
        return 'Processing';
      case 'ended':
        return 'Call Ended';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  };
  
  // Determine if call is active
  const isCallActive = callState.status !== 'idle' && callState.status !== 'ended' && callState.status !== 'error';
  
  // Render loading state
  if (isLoadingCampaigns) {
    return (
      <div className={`web-call-testing ${className}`} style={{ width, height }}>
        <Card className="p-4 h-full">
          <div className="flex flex-col h-full">
            <div className="mb-4">
              <h3 className="text-lg font-medium mb-2">Web Call Testing</h3>
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="flex-grow flex items-center justify-center">
              <Skeleton className="h-32 w-32 rounded-full" />
            </div>
            <div className="mt-4">
              <Skeleton className="h-10 w-full" />
            </div>
          </div>
        </Card>
      </div>
    );
  }
  
  return (
    <div className={`web-call-testing ${className}`} style={{ width, height }}>
      <Card className="p-4 h-full">
        <div className="flex flex-col h-full">
          {/* Header with campaign selector */}
          <div className="mb-4">
            <h3 className="text-lg font-medium mb-2">Web Call Testing</h3>
            <Select
              value={selectedCampaignId}
              onValueChange={setSelectedCampaignId}
              disabled={isCallActive}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select a campaign to test" />
              </SelectTrigger>
              <SelectContent>
                {campaignsData && campaignsData.length > 0 ? (
                  campaignsData.map((campaign: Campaign) => (
                    <SelectItem key={campaign._id} value={campaign._id}>
                      {campaign.name} <Badge variant="outline" className="ml-2">{campaign.status}</Badge>
                    </SelectItem>
                  ))
                ) : (
                  <SelectItem value="no-campaigns" disabled>
                    No campaigns available
                  </SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          
          {/* Main content area with transcript and controls */}
          <div className="flex-grow flex flex-col">
            {/* Status indicator */}
            <div className="mb-4 text-center">
              <div className="flex items-center justify-center gap-2">
                <div className={`w-3 h-3 rounded-full ${getStatusColor()}`}></div>
                <div className="font-medium">{getStatusLabel()}</div>
              </div>
            </div>
            
            {/* Error display */}
            {error && (
              <Alert variant="destructive" className="mb-4">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error: {error.type.replace('_', ' ')}</AlertTitle>
                <AlertDescription>
                  <p>{error.message}</p>
                  {error.details && (
                    <details className="mt-2 text-xs">
                      <summary>Technical details</summary>
                      <p className="mt-1">{error.details}</p>
                    </details>
                  )}
                  {error.recoverable && (
                    <div className="mt-2 flex items-center">
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="flex items-center gap-1"
                        onClick={attemptReconnect}
                        disabled={isRecovering || reconnectAttempts >= 3}
                      >
                        <RefreshCw className={`h-3 w-3 ${isRecovering ? 'animate-spin' : ''}`} />
                        {isRecovering ? 'Reconnecting...' : 'Try again'}
                      </Button>
                      {reconnectAttempts > 0 && !isRecovering && (
                        <span className="text-xs ml-2">
                          Attempt {reconnectAttempts}/3
                        </span>
                      )}
                    </div>
                  )}
                </AlertDescription>
              </Alert>
            )}
            
            {/* Tabs for transcript and metrics */}
            <div className="flex-grow mb-4">
              <Tabs defaultValue="transcript" value={activeTab} onValueChange={setActiveTab}>
                <TabsList className="mb-2">
                  <TabsTrigger value="transcript">Transcript</TabsTrigger>
                  <TabsTrigger value="metrics" disabled={!isCallActive}>Metrics</TabsTrigger>
                  <TabsTrigger value="debug" disabled={!isCallActive}>Debug</TabsTrigger>
                </TabsList>
                <TabsContent value="transcript" className="h-full">
                  <div className="flex flex-col h-full">
                    {testId && callState.status === 'ended' && (
                      <div className="mb-2 flex justify-end">
                        <WebCallTranscriptExport testId={testId} />
                      </div>
                    )}
                    <WebCallTranscript 
                      transcript={callState.transcript}
                      currentSpeaker={callState.currentSpeaker}
                      height={testId && callState.status === 'ended' ? 'calc(100% - 40px)' : '100%'}
                    />
                  </div>
                </TabsContent>
                <TabsContent value="metrics" className="h-full">
                  <RealTimeCallMonitoring metrics={metrics} />
                </TabsContent>
                <TabsContent value="debug" className="h-full">
                  <WebCallDebugPanel 
                    socket={socket}
                    isConnected={isConnected}
                  />
                </TabsContent>
              </Tabs>
            </div>
            
            {/* Audio visualization */}
            <div className="w-full mb-4">
              <WebCallAudioPlayer
                audioBuffer={currentAudioBuffer}
                autoPlay={true}
                showControls={false}
                showVisualization={true}
                onPlaybackStart={() => {
                  setCallState(prev => ({
                    ...prev,
                    currentSpeaker: 'agent'
                  }));
                }}
                onPlaybackEnd={() => {
                  setCallState(prev => ({
                    ...prev,
                    currentSpeaker: null
                  }));
                }}
              />
            </div>
            
            {/* Call controls */}
            <WebCallControls
              isCallActive={isCallActive}
              isMuted={isMuted}
              onStartCall={startCall}
              onEndCall={endCall}
              onToggleMute={toggleMute}
              onVolumeChange={(newVolume) => setVolume(newVolume)}
              disableStartButton={!selectedCampaignId || campaignsData?.length === 0}
            />
          </div>
        </div>
      </Card>
    </div>
  );
};

export default WebCallTesting;
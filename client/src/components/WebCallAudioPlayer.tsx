import React, { useEffect, useRef, useState } from 'react';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import * as LucideIcons from 'lucide-react';

interface WebCallAudioPlayerProps {
  audioBuffer?: ArrayBuffer | null;
  autoPlay?: boolean;
  onPlaybackStart?: () => void;
  onPlaybackEnd?: () => void;
  onPlaybackInterrupted?: () => void;
  className?: string;
  showControls?: boolean;
  showVisualization?: boolean;
}

/**
 * WebCallAudioPlayer Component
 * 
 * Handles playback of agent audio responses with visualization and controls
 */
export const WebCallAudioPlayer: React.FC<WebCallAudioPlayerProps> = ({
  audioBuffer,
  autoPlay = false,
  onPlaybackStart,
  onPlaybackEnd,
  onPlaybackInterrupted,
  className = '',
  showControls = true,
  showVisualization = true,
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const decodedBufferRef = useRef<AudioBuffer | null>(null);
  const startTimeRef = useRef<number>(0);
  const pausedAtRef = useRef<number>(0);

  // Initialize audio context
  useEffect(() => {
    audioContextRef.current = new AudioContext();
    gainNodeRef.current = audioContextRef.current.createGain();
    analyserRef.current = audioContextRef.current.createAnalyser();
    
    analyserRef.current.fftSize = 256;
    gainNodeRef.current.connect(audioContextRef.current.destination);
    analyserRef.current.connect(gainNodeRef.current);
    
    return () => {
      if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
        audioContextRef.current.close();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Handle volume changes
  useEffect(() => {
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // State for error handling
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const recoveryAttemptsRef = useRef(0);
  const maxRecoveryAttempts = 3;
  
  // Process new audio buffer when it changes
  useEffect(() => {
    if (!audioBuffer || !audioContextRef.current) return;
    
    // Reset error state
    setPlaybackError(null);
    
    // Stop any current playback
    stopPlayback();
    
    // Decode the audio buffer
    try {
      audioContextRef.current.decodeAudioData(
        audioBuffer.slice(0),
        (decodedBuffer) => {
          decodedBufferRef.current = decodedBuffer;
          setDuration(decodedBuffer.duration);
          recoveryAttemptsRef.current = 0;
          
          // Auto-play if enabled
          if (autoPlay) {
            playAudio();
          }
        },
        (error) => {
          console.error('Error decoding audio data:', error);
          setPlaybackError(`Failed to decode audio: ${error?.message || 'Unknown error'}`);
          
          // Attempt recovery if this is a new buffer
          if (recoveryAttemptsRef.current < maxRecoveryAttempts) {
            attemptPlaybackRecovery();
          }
          
          if (onPlaybackInterrupted) {
            onPlaybackInterrupted();
          }
        }
      );
    } catch (error) {
      console.error('Exception decoding audio:', error);
      setPlaybackError(`Failed to process audio: ${error instanceof Error ? error.message : 'Unknown error'}`);
      
      if (onPlaybackInterrupted) {
        onPlaybackInterrupted();
      }
    }
  }, [audioBuffer, autoPlay]);
  
  // Attempt to recover from playback errors
  const attemptPlaybackRecovery = () => {
    if (recoveryAttemptsRef.current >= maxRecoveryAttempts || !audioBuffer) {
      return;
    }
    
    setIsRecovering(true);
    recoveryAttemptsRef.current++;
    
    // Exponential backoff
    const delay = Math.min(1000 * Math.pow(2, recoveryAttemptsRef.current - 1), 5000);
    
    setTimeout(() => {
      try {
        // Try to close and recreate audio context
        if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close().catch(console.error);
        }
        
        audioContextRef.current = new AudioContext();
        gainNodeRef.current = audioContextRef.current.createGain();
        analyserRef.current = audioContextRef.current.createAnalyser();
        
        analyserRef.current.fftSize = 256;
        gainNodeRef.current.connect(audioContextRef.current.destination);
        analyserRef.current.connect(gainNodeRef.current);
        
        // Try decoding again
        if (audioBuffer) {
          audioContextRef.current.decodeAudioData(
            audioBuffer.slice(0),
            (decodedBuffer) => {
              decodedBufferRef.current = decodedBuffer;
              setDuration(decodedBuffer.duration);
              setPlaybackError(null);
              
              // Auto-play if enabled
              if (autoPlay) {
                playAudio();
              }
              
              setIsRecovering(false);
            },
            (error) => {
              console.error(`Recovery attempt ${recoveryAttemptsRef.current} failed:`, error);
              setIsRecovering(false);
              
              // Try again if under max attempts
              if (recoveryAttemptsRef.current < maxRecoveryAttempts) {
                attemptPlaybackRecovery();
              }
            }
          );
        }
      } catch (error) {
        console.error(`Recovery attempt ${recoveryAttemptsRef.current} failed with exception:`, error);
        setIsRecovering(false);
        
        // Try again if under max attempts
        if (recoveryAttemptsRef.current < maxRecoveryAttempts) {
          attemptPlaybackRecovery();
        }
      }
    }, delay);
  };

  // Draw visualization
  const drawVisualization = () => {
    if (!analyserRef.current || !canvasRef.current || !isPlaying) return;
    
    const canvas = canvasRef.current;
    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;
    
    const bufferLength = analyserRef.current.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    analyserRef.current.getByteFrequencyData(dataArray);
    analyserRef.current.getByteFrequencyData(dataArray);
    
    // Clear canvas
    
    // Draw visualization
    const width = canvas.width;
    const height = canvas.height;
    const barWidth = (width / bufferLength) * 2.5;
    let x = 0;
    
    canvasCtx.fillStyle = 'rgb(0, 0, 0, 0)';
    canvasCtx.fillRect(0, 0, width, height);
    
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (dataArray[i] / 255) * height;
      
      canvasCtx.fillStyle = `rgb(66, 135, 245, ${barHeight / height})`;
      canvasCtx.fillRect(x, height - barHeight, barWidth, barHeight);
      
      x += barWidth + 1;
    }
    
    // Update current time
    if (audioContextRef.current && startTimeRef.current > 0) {
      const elapsed = audioContextRef.current.currentTime - startTimeRef.current;
      setCurrentTime(Math.min(elapsed, duration));
    }
    
    animationFrameRef.current = requestAnimationFrame(drawVisualization);
  };

  // Play audio
  const playAudio = () => {
    if (!audioContextRef.current || !decodedBufferRef.current) {
      setPlaybackError('Audio context or buffer not available');
      return;
    }
    
    try {
      // Check if context is in suspended state (common in Safari and mobile browsers)
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume().catch(error => {
          console.error('Failed to resume audio context:', error);
          setPlaybackError(`Failed to resume audio playback: ${error.message}`);
          
          if (recoveryAttemptsRef.current < maxRecoveryAttempts) {
            attemptPlaybackRecovery();
          }
          return;
        });
      }
      
      // Create new source node
      audioSourceRef.current = audioContextRef.current.createBufferSource();
      audioSourceRef.current.buffer = decodedBufferRef.current;
      audioSourceRef.current.connect(analyserRef.current!);
      
      // Set up playback end handler
      audioSourceRef.current.onended = () => {
        setIsPlaying(false);
        startTimeRef.current = 0;
        pausedAtRef.current = 0;
        setCurrentTime(0);
        if (onPlaybackEnd) onPlaybackEnd();
      };
      
      // Add error handler
      const errorHandler = (event: Event) => {
        console.error('Audio playback error:', event);
        setPlaybackError('Audio playback failed');
        setIsPlaying(false);
        
        if (onPlaybackInterrupted) onPlaybackInterrupted();
        
        if (recoveryAttemptsRef.current < maxRecoveryAttempts) {
          attemptPlaybackRecovery();
        }
      };
      
      audioSourceRef.current.addEventListener('error', errorHandler);
      
      // Start playback
      const offset = pausedAtRef.current;
      audioSourceRef.current.start(0, offset);
      startTimeRef.current = audioContextRef.current.currentTime - offset;
      setIsPlaying(true);
      setPlaybackError(null);
      
      // Start visualization
      if (showVisualization) {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        animationFrameRef.current = requestAnimationFrame(drawVisualization);
      }
      
      if (onPlaybackStart) onPlaybackStart();
    } catch (error) {
      console.error('Error starting audio playback:', error);
      setPlaybackError(`Failed to start audio playback: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setIsPlaying(false);
      
      if (onPlaybackInterrupted) onPlaybackInterrupted();
      
      if (recoveryAttemptsRef.current < maxRecoveryAttempts) {
        attemptPlaybackRecovery();
      }
    }
  };

  // Pause audio
  const pauseAudio = () => {
    if (!audioContextRef.current || !audioSourceRef.current) return;
    
    // Calculate current position
    pausedAtRef.current = currentTime;
    
    // Stop current source
    audioSourceRef.current.stop();
    audioSourceRef.current = null;
    
    setIsPlaying(false);
    
    // Stop visualization
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  // Stop playback
  const stopPlayback = () => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
        audioSourceRef.current.disconnect();
        audioSourceRef.current = null;
      } catch (error) {
        // Ignore errors if already stopped
      }
    }
    
    setIsPlaying(false);
    startTimeRef.current = 0;
    pausedAtRef.current = 0;
    setCurrentTime(0);
    
    // Stop visualization
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    if (onPlaybackInterrupted) onPlaybackInterrupted();
  };

  // Toggle mute
  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  // Format time display
  const formatTime = (time: number): string => {
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  return (
    <div className={`flex flex-col w-full ${className}`}>
      {/* Visualization */}
      {showVisualization && (
        <div className="w-full h-16 bg-slate-100 dark:bg-slate-800 rounded-md overflow-hidden mb-2">
          {playbackError ? (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-xs text-red-500 p-2 text-center">
                <div className="flex items-center justify-center gap-1 mb-1">
                  <LucideIcons.AlertCircle size={12} />
                  <span>Audio playback error</span>
                </div>
                {isRecovering ? (
                  <div className="flex items-center justify-center gap-1">
                    <LucideIcons.RefreshCw className="h-3 w-3 animate-spin" />
                    <span>Attempting recovery...</span>
                  </div>
                ) : (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="text-xs py-0 h-6"
                    onClick={attemptPlaybackRecovery}
                  >
                    Try again
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <canvas
              ref={canvasRef}
              width={300}
              height={60}
              className="w-full h-full"
            />
          )}
        </div>
      )}
      
      {/* Controls */}
      {showControls && (
        <div className="flex items-center space-x-2">
          {/* Play/Pause Button */}
          <Button
            variant="outline"
            size="icon"
            onClick={isPlaying ? pauseAudio : playAudio}
            disabled={!decodedBufferRef.current || isRecovering}
          >
            {isPlaying ? <LucideIcons.PauseIcon size={16} /> : <LucideIcons.PlayIcon size={16} />}
          </Button>
          
          {/* Stop Button */}
          <Button
            variant="outline"
            size="icon"
            onClick={stopPlayback}
            disabled={!isPlaying || isRecovering}
          >
            <LucideIcons.Square size={16} />
          </Button>
          
          {/* Time Display */}
          <div className="text-xs text-slate-500 dark:text-slate-400 w-20">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>
          
          {/* Volume Control */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleMute}
            disabled={isRecovering}
          >
            {isMuted ? <LucideIcons.VolumeXIcon size={16} /> : <LucideIcons.Volume2Icon size={16} />}
          </Button>
          
          <Slider
            className="w-24"
            value={[volume * 100]}
            min={0}
            max={100}
            step={1}
            onValueChange={(value) => setVolume(value[0] / 100)}
            disabled={isRecovering}
          />
        </div>
      )}
    </div>
  );
};

export default WebCallAudioPlayer;
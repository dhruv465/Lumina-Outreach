/**
 * WebCallAudioProcessor
 * 
 * A utility class for handling audio recording, streaming, and silence detection
 * in web call testing scenarios.
 */

export enum AudioProcessorErrorType {
  PERMISSION_DENIED = 'permission_denied',
  DEVICE_NOT_FOUND = 'device_not_found',
  RECORDING_ERROR = 'recording_error',
  PLAYBACK_ERROR = 'playback_error',
  CONTEXT_ERROR = 'context_error',
  UNKNOWN_ERROR = 'unknown_error'
}

export interface AudioProcessorError extends Error {
  type: AudioProcessorErrorType;
  originalError?: Error;
  recoverable: boolean;
  recoveryAction?: () => Promise<void>;
}

export interface AudioProcessorOptions {
  onAudioData: (audioBuffer: ArrayBuffer) => void;
  onSilence?: (duration: number) => void;
  onSpeaking?: () => void;
  onError?: (error: AudioProcessorError) => void;
  onRecoveryAttempt?: (error: AudioProcessorError) => void;
  onRecoverySuccess?: () => void;
  silenceThreshold?: number; // Amplitude threshold to detect silence (0-1)
  silenceTimeout?: number; // Time in ms to wait before triggering silence event
  sampleRate?: number; // Audio sample rate
  channelCount?: number; // Number of audio channels
  autoRecovery?: boolean; // Whether to automatically attempt recovery
  maxRecoveryAttempts?: number; // Maximum number of recovery attempts
}

export class WebCallAudioProcessor {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private analyserNode: AnalyserNode | null = null;
  private silenceDetector: number | null = null;
  private silenceStart: number | null = null;
  private isRecording = false;
  private isPaused = false;
  private audioQueue: AudioBuffer[] = [];
  private audioSource: AudioBufferSourceNode | null = null;
  private options: Required<AudioProcessorOptions>;
  private audioChunks: Blob[] = [];

  private recoveryAttempts: number = 0;
  private maxRecoveryAttempts: number = 3;
  private autoRecovery: boolean = true;
  private lastError: AudioProcessorError | null = null;
  private recoveryTimeout: number | null = null;

  constructor(options: AudioProcessorOptions) {
    // Set default options
    this.options = {
      onAudioData: options.onAudioData,
      onSilence: options.onSilence || (() => {}),
      onSpeaking: options.onSpeaking || (() => {}),
      onError: options.onError || console.error,
      onRecoveryAttempt: options.onRecoveryAttempt || (() => {}),
      onRecoverySuccess: options.onRecoverySuccess || (() => {}),
      silenceThreshold: options.silenceThreshold || 0.05,
      silenceTimeout: options.silenceTimeout || 1500,
      sampleRate: options.sampleRate || 16000,
      channelCount: options.channelCount || 1,
      autoRecovery: options.autoRecovery !== undefined ? options.autoRecovery : true,
      maxRecoveryAttempts: options.maxRecoveryAttempts || 3
    };
    
    this.autoRecovery = this.options.autoRecovery!;
    this.maxRecoveryAttempts = this.options.maxRecoveryAttempts!;
  }
  
  /**
   * Create a standardized error object
   */
  private createError(
    message: string, 
    type: AudioProcessorErrorType, 
    originalError?: Error,
    recoverable: boolean = true,
    recoveryAction?: () => Promise<void>
  ): AudioProcessorError {
    const error = new Error(message) as AudioProcessorError;
    error.type = type;
    error.originalError = originalError;
    error.recoverable = recoverable;
    error.recoveryAction = recoveryAction;
    return error;
  }
  
  /**
   * Handle errors with recovery attempts if enabled
   */
  private handleError(error: AudioProcessorError): void {
    this.lastError = error;
    
    // Call the error callback
    if (this.options.onError) {
      this.options.onError(error);
    }
    
    // Attempt recovery if enabled and error is recoverable
    if (this.autoRecovery && error.recoverable && this.recoveryAttempts < this.maxRecoveryAttempts) {
      this.recoveryAttempts++;
      
      if (this.options.onRecoveryAttempt) {
        this.options.onRecoveryAttempt(error);
      }
      
      // Clear any existing recovery timeout
      if (this.recoveryTimeout !== null) {
        window.clearTimeout(this.recoveryTimeout);
      }
      
      // Attempt recovery after a delay
      this.recoveryTimeout = window.setTimeout(async () => {
        try {
          if (error.recoveryAction) {
            await error.recoveryAction();
          } else {
            // Default recovery action is to restart recording
            if (this.isRecording) {
              await this.startRecording();
            }
          }
          
          // Reset recovery attempts on success
          this.recoveryAttempts = 0;
          this.lastError = null;
          
          if (this.options.onRecoverySuccess) {
            this.options.onRecoverySuccess();
          }
        } catch (recoveryError) {
          // Recovery failed, increment attempts and try again if under max
          if (this.recoveryAttempts < this.maxRecoveryAttempts) {
            const nextError = this.createError(
              `Recovery attempt ${this.recoveryAttempts} failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
              error.type,
              recoveryError instanceof Error ? recoveryError : undefined,
              true,
              error.recoveryAction
            );
            this.handleError(nextError);
          }
        }
      }, 1000 * this.recoveryAttempts); // Exponential backoff
    }
  }
  
  /**
   * Manually attempt recovery from the last error
   */
  public async attemptRecovery(): Promise<boolean> {
    if (!this.lastError || !this.lastError.recoverable) {
      return false;
    }
    
    try {
      if (this.lastError.recoveryAction) {
        await this.lastError.recoveryAction();
      } else {
        // Default recovery action is to restart recording
        if (this.isRecording) {
          await this.startRecording();
        }
      }
      
      // Reset recovery state
      this.recoveryAttempts = 0;
      this.lastError = null;
      
      if (this.options.onRecoverySuccess) {
        this.options.onRecoverySuccess();
      }
      
      return true;
    } catch (error) {
      const recoveryError = this.createError(
        `Manual recovery failed: ${error instanceof Error ? error.message : String(error)}`,
        this.lastError.type,
        error instanceof Error ? error : undefined,
        true,
        this.lastError.recoveryAction
      );
      
      this.handleError(recoveryError);
      return false;
    }
  }
  
  /**
   * Get the last error that occurred
   */
  public getLastError(): AudioProcessorError | null {
    return this.lastError;
  }
  
  /**
   * Reset recovery attempts counter
   */
  public resetRecoveryAttempts(): void {
    this.recoveryAttempts = 0;
  }
  
  /**
   * Set auto recovery option
   */
  public setAutoRecovery(enabled: boolean): void {
    this.autoRecovery = enabled;
  }

  /**
   * Start recording audio from the user's microphone
   */
  public async startRecording(): Promise<void> {
    try {
      // Clean up any existing resources first
      this.cleanupResources();
      
      // Request microphone access
      try {
        this.stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
            sampleRate: this.options.sampleRate,
            channelCount: this.options.channelCount
          },
          video: false
        });
      } catch (error) {
        // Handle specific permission errors
        if (error instanceof DOMException) {
          if (error.name === 'NotAllowedError' || error.message.includes('Permission denied')) {
            const permissionError = this.createError(
              'Microphone access denied. Please allow microphone access in your browser settings.',
              AudioProcessorErrorType.PERMISSION_DENIED,
              error,
              true,
              async () => {
                // Recovery action: try again after user potentially changes permissions
                await this.startRecording();
              }
            );
            this.handleError(permissionError);
            throw permissionError;
          } else if (error.name === 'NotFoundError' || error.message.includes('Requested device not found')) {
            const deviceError = this.createError(
              'No microphone found. Please connect a microphone and try again.',
              AudioProcessorErrorType.DEVICE_NOT_FOUND,
              error,
              true,
              async () => {
                // Recovery action: try again after user potentially connects a device
                await this.startRecording();
              }
            );
            this.handleError(deviceError);
            throw deviceError;
          }
        }
        
        // Generic error
        const genericError = this.createError(
          `Failed to access microphone: ${error instanceof Error ? error.message : String(error)}`,
          AudioProcessorErrorType.UNKNOWN_ERROR,
          error instanceof Error ? error : undefined,
          true,
          async () => {
            // Recovery action: try again
            await this.startRecording();
          }
        );
        this.handleError(genericError);
        throw genericError;
      }

      // Create audio context
      try {
        this.audioContext = new AudioContext({
          sampleRate: this.options.sampleRate
        });
      } catch (error) {
        const contextError = this.createError(
          `Failed to create audio context: ${error instanceof Error ? error.message : String(error)}`,
          AudioProcessorErrorType.CONTEXT_ERROR,
          error instanceof Error ? error : undefined,
          true,
          async () => {
            // Recovery action: try again with default sample rate
            this.options.sampleRate = 44100; // Default sample rate
            await this.startRecording();
          }
        );
        this.handleError(contextError);
        throw contextError;
      }

      // Create audio source from stream
      const source = this.audioContext.createMediaStreamSource(this.stream);
      
      // Create analyser node for silence detection
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 2048;
      source.connect(this.analyserNode);

      // Create media recorder with error handling
      try {
        const mimeType = MediaRecorder.isTypeSupported('audio/webm') 
          ? 'audio/webm' 
          : MediaRecorder.isTypeSupported('audio/mp4') 
            ? 'audio/mp4' 
            : '';
            
        this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });
      } catch (error) {
        const recorderError = this.createError(
          `Failed to create media recorder: ${error instanceof Error ? error.message : String(error)}`,
          AudioProcessorErrorType.RECORDING_ERROR,
          error instanceof Error ? error : undefined,
          true,
          async () => {
            // Recovery action: try again with default options
            await this.startRecording();
          }
        );
        this.handleError(recorderError);
        throw recorderError;
      }
      
      // Handle data available event
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          
          // Convert blob to array buffer and send to callback
          event.data.arrayBuffer().then(buffer => {
            this.options.onAudioData(buffer);
          }).catch(error => {
            const dataError = this.createError(
              `Failed to convert audio data: ${error.message}`,
              AudioProcessorErrorType.RECORDING_ERROR,
              error,
              false // Not recoverable for individual chunks
            );
            this.handleError(dataError);
          });
        }
      };
      
      // Handle recording errors
      this.mediaRecorder.onerror = (event) => {
        const recError = this.createError(
          `Recording error: ${event.error.message || 'Unknown error'}`,
          AudioProcessorErrorType.RECORDING_ERROR,
          event.error,
          true,
          async () => {
            // Recovery action: restart recording
            await this.startRecording();
          }
        );
        this.handleError(recError);
      };

      // Start recording
      this.mediaRecorder.start(100); // Capture in 100ms chunks
      this.isRecording = true;
      this.isPaused = false;
      
      // Start silence detection
      this.startSilenceDetection();
      
      // Reset recovery attempts on successful start
      this.recoveryAttempts = 0;
    } catch (error) {
      // If error wasn't already handled, create a generic error
      if (!(error as AudioProcessorError).type) {
        const genericError = this.createError(
          `Failed to start recording: ${error instanceof Error ? error.message : String(error)}`,
          AudioProcessorErrorType.UNKNOWN_ERROR,
          error instanceof Error ? error : undefined,
          true,
          async () => {
            // Recovery action: try again
            await this.startRecording();
          }
        );
        this.handleError(genericError);
        throw genericError;
      } else {
        // Re-throw already handled errors
        throw error;
      }
    }
  }
  
  /**
   * Clean up resources before starting new recording
   */
  private cleanupResources(): void {
    // Stop any existing recording
    if (this.mediaRecorder && this.isRecording) {
      try {
        this.mediaRecorder.stop();
      } catch (e) {
        // Ignore errors when stopping
      }
    }
    
    // Stop all tracks on any existing stream
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    // Close any existing audio context
    if (this.audioContext && this.audioContext.state !== 'closed') {
      try {
        this.audioContext.close();
      } catch (e) {
        // Ignore errors when closing
      }
      this.audioContext = null;
    }
    
    this.analyserNode = null;
    this.stopSilenceDetection();
  }

  /**
   * Stop recording audio
   */
  public stopRecording(): void {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
      this.isRecording = false;
    }
    
    this.stopSilenceDetection();
    
    // Stop all tracks on the stream
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    // Close audio context
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close().catch(error => {
        this.options.onError(new Error(`Failed to close audio context: ${error.message}`));
      });
      this.audioContext = null;
    }
    
    this.analyserNode = null;
    this.audioChunks = [];
  }

  /**
   * Pause recording
   */
  public pauseRecording(): void {
    if (this.mediaRecorder && this.isRecording && !this.isPaused) {
      this.mediaRecorder.pause();
      this.isPaused = true;
      this.stopSilenceDetection();
    }
  }

  /**
   * Resume recording
   */
  public resumeRecording(): void {
    if (this.mediaRecorder && this.isRecording && this.isPaused) {
      this.mediaRecorder.resume();
      this.isPaused = false;
      this.startSilenceDetection();
    }
  }

  /**
   * Play audio from an array buffer
   */
  public async playAudio(audioBuffer: ArrayBuffer): Promise<void> {
    try {
      // Create audio context if it doesn't exist
      if (!this.audioContext) {
        try {
          this.audioContext = new AudioContext({
            sampleRate: this.options.sampleRate
          });
        } catch (error) {
          const contextError = this.createError(
            `Failed to create audio context for playback: ${error instanceof Error ? error.message : String(error)}`,
            AudioProcessorErrorType.CONTEXT_ERROR,
            error instanceof Error ? error : undefined,
            true,
            async () => {
              // Recovery action: try again with default sample rate
              this.options.sampleRate = 44100; // Default sample rate
              await this.playAudio(audioBuffer);
            }
          );
          this.handleError(contextError);
          throw contextError;
        }
      }
      
      // Check if audio context is in suspended state (common in Safari and mobile browsers)
      if (this.audioContext.state === 'suspended') {
        try {
          await this.audioContext.resume();
        } catch (error) {
          const resumeError = this.createError(
            `Failed to resume audio context: ${error instanceof Error ? error.message : String(error)}`,
            AudioProcessorErrorType.CONTEXT_ERROR,
            error instanceof Error ? error : undefined,
            true,
            async () => {
              // Recovery action: create a new context
              if (this.audioContext) {
                try {
                  await this.audioContext.close();
                } catch (e) {
                  // Ignore close errors
                }
                this.audioContext = null;
              }
              await this.playAudio(audioBuffer);
            }
          );
          this.handleError(resumeError);
          throw resumeError;
        }
      }
      
      // Decode the audio data
      let decodedBuffer: AudioBuffer;
      try {
        decodedBuffer = await this.audioContext.decodeAudioData(audioBuffer.slice(0));
      } catch (error) {
        const decodeError = this.createError(
          `Failed to decode audio data: ${error instanceof Error ? error.message : String(error)}`,
          AudioProcessorErrorType.PLAYBACK_ERROR,
          error instanceof Error ? error : undefined,
          false, // Not recoverable for this specific buffer
        );
        this.handleError(decodeError);
        throw decodeError;
      }
      
      // Create a source node
      this.audioSource = this.audioContext.createBufferSource();
      this.audioSource.buffer = decodedBuffer;
      
      // Connect to destination (speakers)
      this.audioSource.connect(this.audioContext.destination);
      
      // Handle playback errors
      const playbackErrorHandler = (event: Event) => {
        const playbackError = this.createError(
          'Audio playback failed',
          AudioProcessorErrorType.PLAYBACK_ERROR,
          new Error('Playback error event triggered'),
          true,
          async () => {
            // Recovery action: try again
            await this.playAudio(audioBuffer);
          }
        );
        this.handleError(playbackError);
      };
      
      // Start playback
      try {
        this.audioSource.start();
      } catch (error) {
        const startError = this.createError(
          `Failed to start audio playback: ${error instanceof Error ? error.message : String(error)}`,
          AudioProcessorErrorType.PLAYBACK_ERROR,
          error instanceof Error ? error : undefined,
          true,
          async () => {
            // Recovery action: try again with a new context
            if (this.audioContext) {
              try {
                await this.audioContext.close();
              } catch (e) {
                // Ignore close errors
              }
              this.audioContext = null;
            }
            await this.playAudio(audioBuffer);
          }
        );
        this.handleError(startError);
        throw startError;
      }
      
      // Return a promise that resolves when playback is complete
      return new Promise((resolve, reject) => {
        if (!this.audioSource) {
          reject(new Error('Audio source was unexpectedly null'));
          return;
        }
        
        this.audioSource.onended = () => {
          this.audioSource = null;
          resolve();
        };
        
        // Add error handler
        this.audioSource.addEventListener('error', (event) => {
          playbackErrorHandler(event);
          reject(new Error('Playback error occurred'));
        });
      });
    } catch (error) {
      // If error wasn't already handled, create a generic error
      if (!(error as AudioProcessorError).type) {
        const genericError = this.createError(
          `Failed to play audio: ${error instanceof Error ? error.message : String(error)}`,
          AudioProcessorErrorType.PLAYBACK_ERROR,
          error instanceof Error ? error : undefined,
          true,
          async () => {
            // Recovery action: try again
            await this.playAudio(audioBuffer);
          }
        );
        this.handleError(genericError);
        throw genericError;
      } else {
        // Re-throw already handled errors
        throw error;
      }
    }
  }

  /**
   * Stop current audio playback
   */
  public stopPlayback(): void {
    if (this.audioSource) {
      try {
        this.audioSource.stop();
        this.audioSource = null;
      } catch (error) {
        this.options.onError(new Error(`Failed to stop playback: ${error instanceof Error ? error.message : String(error)}`));
      }
    }
  }

  /**
   * Check if currently recording
   */
  public getRecordingState(): { isRecording: boolean; isPaused: boolean } {
    return {
      isRecording: this.isRecording,
      isPaused: this.isPaused
    };
  }

  /**
   * Clean up resources
   */
  public destroy(): void {
    this.stopRecording();
    this.stopPlayback();
    this.stopSilenceDetection();
    
    // Clear any recovery timeout
    if (this.recoveryTimeout !== null) {
      window.clearTimeout(this.recoveryTimeout);
      this.recoveryTimeout = null;
    }
    
    // Reset state
    this.lastError = null;
    this.recoveryAttempts = 0;
    this.audioChunks = [];
  }

  /**
   * Start silence detection process
   */
  private startSilenceDetection(): void {
    if (!this.analyserNode) return;
    
    const bufferLength = this.analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    this.silenceDetector = window.setInterval(() => {
      if (!this.analyserNode) return;
      
      // Get audio data
      this.analyserNode.getByteTimeDomainData(dataArray);
      
      // Calculate average volume
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        // Convert from 0-255 to -1 to 1
        const amplitude = ((dataArray[i] / 128.0) - 1.0);
        sum += Math.abs(amplitude);
      }
      
      const averageVolume = sum / bufferLength;
      
      // Check if below threshold (silence)
      if (averageVolume < this.options.silenceThreshold) {
        if (this.silenceStart === null) {
          this.silenceStart = Date.now();
        } else {
          const silenceDuration = Date.now() - this.silenceStart;
          if (silenceDuration >= this.options.silenceTimeout) {
            this.options.onSilence(silenceDuration);
          }
        }
      } else {
        // Reset silence detection if sound detected
        if (this.silenceStart !== null) {
          this.silenceStart = null;
          this.options.onSpeaking();
        }
      }
    }, 100); // Check every 100ms
  }

  /**
   * Stop silence detection process
   */
  private stopSilenceDetection(): void {
    if (this.silenceDetector !== null) {
      window.clearInterval(this.silenceDetector);
      this.silenceDetector = null;
      this.silenceStart = null;
    }
  }

  /**
   * Get the current audio data as a blob
   */
  public getAudioBlob(): Blob | null {
    if (this.audioChunks.length === 0) return null;
    return new Blob(this.audioChunks, { type: 'audio/webm' });
  }

  /**
   * Get audio context
   */
  public getAudioContext(): AudioContext | null {
    return this.audioContext;
  }
}

export default WebCallAudioProcessor;
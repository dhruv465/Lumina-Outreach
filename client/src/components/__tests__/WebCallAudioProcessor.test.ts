import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import WebCallAudioProcessor, { AudioProcessorErrorType } from '../WebCallAudioProcessor';

// Mock browser APIs
const mockMediaDevices = {
  getUserMedia: vi.fn()
};

const mockMediaRecorder = {
  start: vi.fn(),
  stop: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  ondataavailable: null as any,
  onerror: null as any
};

const mockAudioContext = {
  createMediaStreamSource: vi.fn(),
  createAnalyser: vi.fn(),
  createBufferSource: vi.fn(),
  decodeAudioData: vi.fn(),
  close: vi.fn(),
  destination: {},
  state: 'running'
};

const mockAnalyserNode = {
  fftSize: 0,
  frequencyBinCount: 1024,
  getByteTimeDomainData: vi.fn((array) => {
    // Fill with "silence" by default (128 is middle value in byte range)
    for (let i = 0; i < array.length; i++) {
      array[i] = 128;
    }
  }),
  connect: vi.fn()
};

const mockAudioBufferSourceNode = {
  buffer: null as any,
  connect: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  onended: null as any,
  addEventListener: vi.fn()
};

const mockMediaStream = {
  getTracks: vi.fn().mockReturnValue([{ stop: vi.fn() }])
};

// Setup global mocks
global.MediaRecorder = vi.fn().mockImplementation(() => mockMediaRecorder);
global.AudioContext = vi.fn().mockImplementation(() => mockAudioContext);
global.navigator = {
  ...global.navigator,
  mediaDevices: mockMediaDevices
} as any;

describe('WebCallAudioProcessor', () => {
  let processor: WebCallAudioProcessor;
  let onAudioData: vi.Mock;
  let onSilence: vi.Mock;
  let onSpeaking: vi.Mock;
  let onError: vi.Mock;
  let onRecoveryAttempt: vi.Mock;
  let onRecoverySuccess: vi.Mock;
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset mocks
    mockMediaDevices.getUserMedia.mockResolvedValue(mockMediaStream);
    mockAudioContext.createMediaStreamSource.mockReturnValue({ connect: vi.fn() });
    mockAudioContext.createAnalyser.mockReturnValue(mockAnalyserNode);
    mockAudioContext.createBufferSource.mockReturnValue(mockAudioBufferSourceNode);
    mockAudioContext.decodeAudioData.mockResolvedValue({});
    
    // Setup callback mocks
    onAudioData = vi.fn();
    onSilence = vi.fn();
    onSpeaking = vi.fn();
    onError = vi.fn();
    onRecoveryAttempt = vi.fn();
    onRecoverySuccess = vi.fn();
    
    // Create processor instance
    processor = new WebCallAudioProcessor({
      onAudioData,
      onSilence,
      onSpeaking,
      onError,
      onRecoveryAttempt,
      onRecoverySuccess,
      silenceThreshold: 0.05,
      silenceTimeout: 100, // Short timeout for testing
      autoRecovery: true,
      maxRecoveryAttempts: 3
    });
    
    // Mock setInterval and setTimeout
    vi.spyOn(global, 'setInterval').mockImplementation((callback) => {
      callback();
      return 123 as any;
    });
    vi.spyOn(global, 'setTimeout').mockImplementation((callback) => {
      callback();
      return 456 as any;
    });
    vi.spyOn(global, 'clearInterval').mockImplementation(() => {});
    vi.spyOn(global, 'clearTimeout').mockImplementation(() => {});
  });
  
  afterEach(() => {
    processor.destroy();
  });
  
  describe('startRecording', () => {
    it('should request microphone access', async () => {
      await processor.startRecording();
      
      expect(mockMediaDevices.getUserMedia).toHaveBeenCalledWith({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 16000,
          channelCount: 1
        },
        video: false
      });
    });
    
    it('should create audio context and media recorder', async () => {
      await processor.startRecording();
      
      expect(AudioContext).toHaveBeenCalled();
      expect(mockAudioContext.createMediaStreamSource).toHaveBeenCalled();
      expect(mockAudioContext.createAnalyser).toHaveBeenCalled();
      expect(MediaRecorder).toHaveBeenCalled();
    });
    
    it('should start recording', async () => {
      await processor.startRecording();
      
      expect(mockMediaRecorder.start).toHaveBeenCalledWith(100);
    });
    
    it('should handle permission denied error', async () => {
      const permissionError = new DOMException('Permission denied', 'NotAllowedError');
      mockMediaDevices.getUserMedia.mockRejectedValueOnce(permissionError);
      
      await expect(processor.startRecording()).rejects.toThrow();
      
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        type: AudioProcessorErrorType.PERMISSION_DENIED,
        recoverable: true
      }));
    });
    
    it('should handle device not found error', async () => {
      const deviceError = new DOMException('Device not found', 'NotFoundError');
      mockMediaDevices.getUserMedia.mockRejectedValueOnce(deviceError);
      
      await expect(processor.startRecording()).rejects.toThrow();
      
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        type: AudioProcessorErrorType.DEVICE_NOT_FOUND,
        recoverable: true
      }));
    });
  });
  
  describe('stopRecording', () => {
    it('should stop media recorder and tracks', async () => {
      await processor.startRecording();
      processor.stopRecording();
      
      expect(mockMediaRecorder.stop).toHaveBeenCalled();
      expect(mockMediaStream.getTracks).toHaveBeenCalled();
      expect(mockMediaStream.getTracks()[0].stop).toHaveBeenCalled();
    });
    
    it('should close audio context', async () => {
      await processor.startRecording();
      processor.stopRecording();
      
      expect(mockAudioContext.close).toHaveBeenCalled();
    });
  });
  
  describe('pauseRecording and resumeRecording', () => {
    it('should pause and resume media recorder', async () => {
      await processor.startRecording();
      processor.pauseRecording();
      
      expect(mockMediaRecorder.pause).toHaveBeenCalled();
      
      processor.resumeRecording();
      
      expect(mockMediaRecorder.resume).toHaveBeenCalled();
    });
  });
  
  describe('playAudio', () => {
    it('should decode and play audio buffer', async () => {
      const audioBuffer = new ArrayBuffer(1024);
      
      await processor.playAudio(audioBuffer);
      
      expect(mockAudioContext.decodeAudioData).toHaveBeenCalled();
      expect(mockAudioContext.createBufferSource).toHaveBeenCalled();
      expect(mockAudioBufferSourceNode.connect).toHaveBeenCalledWith(mockAudioContext.destination);
      expect(mockAudioBufferSourceNode.start).toHaveBeenCalled();
    });
    
    it('should handle decode error', async () => {
      const audioBuffer = new ArrayBuffer(1024);
      const decodeError = new Error('Failed to decode audio data');
      mockAudioContext.decodeAudioData.mockRejectedValueOnce(decodeError);
      
      await expect(processor.playAudio(audioBuffer)).rejects.toThrow();
      
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        type: AudioProcessorErrorType.PLAYBACK_ERROR,
        recoverable: false
      }));
    });
    
    it('should handle playback error', async () => {
      const audioBuffer = new ArrayBuffer(1024);
      const playbackError = new Error('Failed to start playback');
      mockAudioBufferSourceNode.start.mockImplementationOnce(() => {
        throw playbackError;
      });
      
      await expect(processor.playAudio(audioBuffer)).rejects.toThrow();
      
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({
        type: AudioProcessorErrorType.PLAYBACK_ERROR,
        recoverable: true
      }));
    });
  });
  
  describe('silence detection', () => {
    it('should detect silence and call onSilence', async () => {
      await processor.startRecording();
      
      // Simulate silence detection interval
      const silenceDetectionCallback = (global.setInterval as jest.Mock).mock.calls[0][0];
      
      // First call sets silenceStart
      silenceDetectionCallback();
      
      // Second call should trigger onSilence after timeout
      vi.advanceTimersByTime(200);
      silenceDetectionCallback();
      
      expect(onSilence).toHaveBeenCalled();
    });
    
    it('should detect speaking and call onSpeaking', async () => {
      await processor.startRecording();
      
      // Simulate non-silent audio data
      mockAnalyserNode.getByteTimeDomainData.mockImplementationOnce((array) => {
        for (let i = 0; i < array.length; i++) {
          array[i] = 200; // Values far from 128 indicate sound
        }
      });
      
      // Simulate silence detection interval
      const silenceDetectionCallback = (global.setInterval as jest.Mock).mock.calls[0][0];
      silenceDetectionCallback();
      
      expect(onSpeaking).toHaveBeenCalled();
    });
  });
  
  describe('error handling and recovery', () => {
    it('should attempt recovery for recoverable errors', async () => {
      const recoveryAction = vi.fn().mockResolvedValue(undefined);
      
      const error = {
        message: 'Test error',
        type: AudioProcessorErrorType.RECORDING_ERROR,
        recoverable: true,
        recoveryAction
      };
      
      // Manually trigger error handling
      (processor as any).handleError(error);
      
      expect(onError).toHaveBeenCalledWith(error);
      expect(onRecoveryAttempt).toHaveBeenCalled();
      expect(recoveryAction).toHaveBeenCalled();
      expect(onRecoverySuccess).toHaveBeenCalled();
    });
    
    it('should not attempt recovery for non-recoverable errors', async () => {
      const error = {
        message: 'Test error',
        type: AudioProcessorErrorType.PLAYBACK_ERROR,
        recoverable: false
      };
      
      // Manually trigger error handling
      (processor as any).handleError(error);
      
      expect(onError).toHaveBeenCalledWith(error);
      expect(onRecoveryAttempt).not.toHaveBeenCalled();
    });
    
    it('should allow manual recovery attempt', async () => {
      const recoveryAction = vi.fn().mockResolvedValue(undefined);
      
      const error = {
        message: 'Test error',
        type: AudioProcessorErrorType.RECORDING_ERROR,
        recoverable: true,
        recoveryAction
      };
      
      // Set last error
      (processor as any).lastError = error;
      
      // Attempt manual recovery
      const result = await processor.attemptRecovery();
      
      expect(result).toBe(true);
      expect(recoveryAction).toHaveBeenCalled();
      expect(onRecoverySuccess).toHaveBeenCalled();
    });
  });
  
  describe('cleanup', () => {
    it('should clean up resources on destroy', async () => {
      await processor.startRecording();
      processor.destroy();
      
      expect(mockMediaRecorder.stop).toHaveBeenCalled();
      expect(mockMediaStream.getTracks).toHaveBeenCalled();
      expect(mockMediaStream.getTracks()[0].stop).toHaveBeenCalled();
      expect(mockAudioContext.close).toHaveBeenCalled();
      expect(global.clearInterval).toHaveBeenCalled();
    });
  });
});
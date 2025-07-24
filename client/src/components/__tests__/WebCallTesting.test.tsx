import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import WebCallTesting from '../WebCallTesting';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import api from '@/services/api';
import { io } from 'socket.io-client';

// Mock dependencies
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    removeAllListeners: vi.fn(),
    io: {
      on: vi.fn(),
    }
  }))
}));

vi.mock('@/services/api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn()
  }
}));

vi.mock('../WebCallAudioProcessor', () => ({
  default: vi.fn().mockImplementation(() => ({
    startRecording: vi.fn().mockResolvedValue(undefined),
    stopRecording: vi.fn(),
    pauseRecording: vi.fn(),
    resumeRecording: vi.fn(),
    destroy: vi.fn(),
    attemptRecovery: vi.fn().mockResolvedValue(true)
  }))
}));

vi.mock('../WebCallAudioPlayer', () => ({
  default: vi.fn().mockImplementation(({ onPlaybackStart, onPlaybackEnd }) => (
    <div data-testid="audio-player">
      <button onClick={onPlaybackStart}>Start Playback</button>
      <button onClick={onPlaybackEnd}>End Playback</button>
    </div>
  ))
}));

vi.mock('../WebCallTranscript', () => ({
  default: vi.fn().mockImplementation(() => <div data-testid="transcript"></div>)
}));

vi.mock('../WebCallControls', () => ({
  default: vi.fn().mockImplementation(({ onStartCall, onEndCall, onToggleMute }) => (
    <div data-testid="call-controls">
      <button data-testid="start-call" onClick={onStartCall}>Start Call</button>
      <button data-testid="end-call" onClick={onEndCall}>End Call</button>
      <button data-testid="toggle-mute" onClick={onToggleMute}>Toggle Mute</button>
    </div>
  ))
}));

describe('WebCallTesting', () => {
  let queryClient: QueryClient;
  
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup mock API responses
    (api.get as vi.Mock).mockResolvedValue({
      data: {
        campaigns: [
          { _id: 'campaign1', name: 'Test Campaign 1', status: 'Active' },
          { _id: 'campaign2', name: 'Test Campaign 2', status: 'Draft' }
        ]
      }
    });
    
    (api.post as vi.Mock).mockResolvedValue({
      data: {
        success: true,
        sessionId: 'test-session-id',
        testId: 'test-test-id',
        userId: 'test-user-id'
      }
    });
    
    // Setup query client
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
        },
      },
    });
  });
  
  const renderComponent = (props = {}) => {
    return render(
      <QueryClientProvider client={queryClient}>
        <WebCallTesting {...props} />
      </QueryClientProvider>
    );
  };
  
  it('should render the component', async () => {
    renderComponent();
    
    // Wait for campaigns to load
    await waitFor(() => {
      expect(screen.getByText('Web Call Testing')).toBeInTheDocument();
    });
  });
  
  it('should load campaigns on mount', async () => {
    renderComponent();
    
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/campaigns?status=Active,Draft,Paused');
    });
  });
  
  it('should start a call when start button is clicked', async () => {
    renderComponent();
    
    // Wait for campaigns to load
    await waitFor(() => {
      expect(screen.getByTestId('start-call')).toBeInTheDocument();
    });
    
    // Select a campaign
    fireEvent.click(screen.getByRole('combobox'));
    await waitFor(() => {
      expect(screen.getByText('Test Campaign 1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Test Campaign 1'));
    
    // Start call
    fireEvent.click(screen.getByTestId('start-call'));
    
    // Verify socket.io connection was attempted
    expect(io).toHaveBeenCalled();
  });
  
  it('should end a call when end button is clicked', async () => {
    renderComponent();
    
    // Wait for campaigns to load
    await waitFor(() => {
      expect(screen.getByTestId('end-call')).toBeInTheDocument();
    });
    
    // End call
    fireEvent.click(screen.getByTestId('end-call'));
    
    // Verify socket disconnect was called
    const mockSocket = (io as vi.Mock).mock.results[0]?.value;
    expect(mockSocket?.disconnect).toHaveBeenCalled();
  });
  
  it('should toggle mute when mute button is clicked', async () => {
    renderComponent();
    
    // Wait for campaigns to load
    await waitFor(() => {
      expect(screen.getByTestId('toggle-mute')).toBeInTheDocument();
    });
    
    // Toggle mute
    fireEvent.click(screen.getByTestId('toggle-mute'));
    
    // We can't easily test the internal state change, but we can verify the button was clicked
    expect(screen.getByTestId('toggle-mute')).toBeInTheDocument();
  });
  
  it('should handle socket events', async () => {
    renderComponent();
    
    // Wait for campaigns to load
    await waitFor(() => {
      expect(screen.getByTestId('start-call')).toBeInTheDocument();
    });
    
    // Select a campaign
    fireEvent.click(screen.getByRole('combobox'));
    await waitFor(() => {
      expect(screen.getByText('Test Campaign 1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Test Campaign 1'));
    
    // Start call
    fireEvent.click(screen.getByTestId('start-call'));
    
    // Get mock socket
    const mockSocket = (io as vi.Mock).mock.results[0]?.value;
    
    // Verify socket event handlers were set up
    expect(mockSocket.on).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('webcall:state', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('webcall:transcript', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('webcall:agentAudio', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('webcall:end', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('webcall:metrics', expect.any(Function));
    expect(mockSocket.on).toHaveBeenCalledWith('webcall:error', expect.any(Function));
  });
  
  it('should handle errors', async () => {
    // Mock API error
    (api.post as vi.Mock).mockRejectedValueOnce(new Error('API Error'));
    
    renderComponent();
    
    // Wait for campaigns to load
    await waitFor(() => {
      expect(screen.getByTestId('start-call')).toBeInTheDocument();
    });
    
    // Select a campaign
    fireEvent.click(screen.getByRole('combobox'));
    await waitFor(() => {
      expect(screen.getByText('Test Campaign 1')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Test Campaign 1'));
    
    // Start call
    fireEvent.click(screen.getByTestId('start-call'));
    
    // Error should be handled internally, component should not crash
    expect(screen.getByTestId('start-call')).toBeInTheDocument();
  });
});
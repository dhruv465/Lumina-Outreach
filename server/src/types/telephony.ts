/**
 * Types for the telephony service
 */

// Call status types from Twilio
export type TwilioCallStatus = 
  | 'queued'
  | 'initiated'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled';

// Structure for recording metadata
export interface RecordingData {
  id: string;
  duration: number;
  url: string;
  status: 'completed' | 'processing' | 'failed';
}

// Structure for call data
export interface CallData {
  id: string;
  to?: string;
  from?: string;
  status: TwilioCallStatus;
  startTime: string;
  endTime?: string;
  duration?: number;
  recordings: RecordingData[];
  transcript?: string;
  analysis?: any;
  isFallback?: boolean;
  twilioCallSid?: string; // Real Twilio CallSid (CA...) for API calls
}

// Interface for telephony events
export interface TelephonyEvent {
  type: 'status-change' | 'recording-available' | 'transcription-available';
  callId: string;
  data: any;
}

// Telephony service interface
export interface TelephonyServiceInterface {
  // Make an outbound call
  makeCall(
    to: string,
    from: string,
    callbackUrl: string,
    options?: {
      timeout?: number;
      machineDetection?: 'Enable' | 'DetectMessageEnd';
      recordingEnabled?: boolean;
    }
  ): Promise<string>;
  
  // End an active call
  endCall(callId: string): Promise<boolean>;
  
  // Handle webhook events
  handleWebhook(eventType: string, data: any): void;
  
  // Get current call data
  getCallData(callId: string): CallData | undefined;
  
  // Listen for telephony events
  on(eventName: string, listener: (event: TelephonyEvent) => void): void;
  
  // Check service health
  checkHealth(): Promise<{
    status: 'healthy' | 'degraded' | 'unhealthy';
    message?: string;
  }>;
}

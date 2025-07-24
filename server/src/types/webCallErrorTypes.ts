/**
 * Web Call Error Types
 * 
 * Defines standardized error types and classes for web call services
 */

/**
 * Web call error types
 */
export enum WebCallErrorType {
  // Service errors
  SERVICE_UNAVAILABLE = 'service_unavailable',
  SERVICE_TIMEOUT = 'service_timeout',
  SERVICE_OVERLOADED = 'service_overloaded',
  
  // Authentication errors
  AUTHENTICATION_FAILED = 'authentication_failed',
  AUTHORIZATION_FAILED = 'authorization_failed',
  
  // Resource errors
  RESOURCE_NOT_FOUND = 'resource_not_found',
  RESOURCE_CONFLICT = 'resource_conflict',
  
  // Input errors
  INVALID_INPUT = 'invalid_input',
  MISSING_PARAMETER = 'missing_parameter',
  
  // Processing errors
  PROCESSING_FAILED = 'processing_failed',
  VALIDATION_FAILED = 'validation_failed',
  
  // Integration errors
  INTEGRATION_ERROR = 'integration_error',
  DEPENDENCY_ERROR = 'dependency_error',
  
  // Speech-to-text specific errors
  STT_TRANSCRIPTION_FAILED = 'stt_transcription_failed',
  STT_NO_SPEECH_DETECTED = 'stt_no_speech_detected',
  STT_AUDIO_FORMAT_ERROR = 'stt_audio_format_error',
  
  // LLM specific errors
  LLM_GENERATION_FAILED = 'llm_generation_failed',
  LLM_CONTEXT_TOO_LARGE = 'llm_context_too_large',
  LLM_CONTENT_FILTERED = 'llm_content_filtered',
  
  // TTS specific errors
  TTS_SYNTHESIS_FAILED = 'tts_synthesis_failed',
  TTS_VOICE_NOT_FOUND = 'tts_voice_not_found',
  
  // WebSocket errors
  WEBSOCKET_CONNECTION_FAILED = 'websocket_connection_failed',
  WEBSOCKET_DISCONNECTED = 'websocket_disconnected',
  
  // Unknown error
  UNKNOWN_ERROR = 'unknown_error'
}

/**
 * Base web call error class
 */
export class WebCallError extends Error {
  type: WebCallErrorType;
  statusCode: number;
  recoverable: boolean;
  details?: any;
  
  constructor(
    message: string,
    type: WebCallErrorType = WebCallErrorType.UNKNOWN_ERROR,
    statusCode: number = 500,
    recoverable: boolean = false,
    details?: any
  ) {
    super(message);
    this.name = 'WebCallError';
    this.type = type;
    this.statusCode = statusCode;
    this.recoverable = recoverable;
    this.details = details;
  }
  
  /**
   * Convert to JSON representation
   */
  toJSON(): Record<string, any> {
    return {
      error: this.message,
      type: this.type,
      statusCode: this.statusCode,
      recoverable: this.recoverable,
      details: this.details,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * Service unavailable error
 */
export class ServiceUnavailableError extends WebCallError {
  constructor(
    message: string = 'Service is currently unavailable',
    details?: any
  ) {
    super(
      message,
      WebCallErrorType.SERVICE_UNAVAILABLE,
      503,
      true, // Recoverable
      details
    );
    this.name = 'ServiceUnavailableError';
  }
}

/**
 * Service timeout error
 */
export class ServiceTimeoutError extends WebCallError {
  constructor(
    message: string = 'Service request timed out',
    details?: any
  ) {
    super(
      message,
      WebCallErrorType.SERVICE_TIMEOUT,
      504,
      true, // Recoverable
      details
    );
    this.name = 'ServiceTimeoutError';
  }
}

/**
 * Authentication error
 */
export class AuthenticationError extends WebCallError {
  constructor(
    message: string = 'Authentication failed',
    details?: any
  ) {
    super(
      message,
      WebCallErrorType.AUTHENTICATION_FAILED,
      401,
      false, // Not recoverable
      details
    );
    this.name = 'AuthenticationError';
  }
}

/**
 * Resource not found error
 */
export class ResourceNotFoundError extends WebCallError {
  constructor(
    message: string = 'Resource not found',
    details?: any
  ) {
    super(
      message,
      WebCallErrorType.RESOURCE_NOT_FOUND,
      404,
      false, // Not recoverable
      details
    );
    this.name = 'ResourceNotFoundError';
  }
}

/**
 * Invalid input error
 */
export class InvalidInputError extends WebCallError {
  constructor(
    message: string = 'Invalid input provided',
    details?: any
  ) {
    super(
      message,
      WebCallErrorType.INVALID_INPUT,
      400,
      true, // Recoverable
      details
    );
    this.name = 'InvalidInputError';
  }
}

/**
 * Speech-to-text error
 */
export class SpeechToTextError extends WebCallError {
  constructor(
    message: string = 'Speech-to-text processing failed',
    subtype: WebCallErrorType = WebCallErrorType.STT_TRANSCRIPTION_FAILED,
    details?: any
  ) {
    super(
      message,
      subtype,
      500,
      true, // Recoverable
      details
    );
    this.name = 'SpeechToTextError';
  }
}

/**
 * LLM error
 */
export class LLMError extends WebCallError {
  constructor(
    message: string = 'LLM processing failed',
    subtype: WebCallErrorType = WebCallErrorType.LLM_GENERATION_FAILED,
    details?: any
  ) {
    super(
      message,
      subtype,
      500,
      true, // Recoverable
      details
    );
    this.name = 'LLMError';
  }
}

/**
 * Text-to-speech error
 */
export class TextToSpeechError extends WebCallError {
  constructor(
    message: string = 'Text-to-speech processing failed',
    subtype: WebCallErrorType = WebCallErrorType.TTS_SYNTHESIS_FAILED,
    details?: any
  ) {
    super(
      message,
      subtype,
      500,
      true, // Recoverable
      details
    );
    this.name = 'TextToSpeechError';
  }
}

/**
 * WebSocket error
 */
export class WebSocketError extends WebCallError {
  constructor(
    message: string = 'WebSocket error occurred',
    subtype: WebCallErrorType = WebCallErrorType.WEBSOCKET_CONNECTION_FAILED,
    details?: any
  ) {
    super(
      message,
      subtype,
      500,
      true, // Recoverable
      details
    );
    this.name = 'WebSocketError';
  }
}

/**
 * Create appropriate error instance based on error type
 * @param error Original error
 * @returns Standardized WebCallError
 */
export function createWebCallError(error: any): WebCallError {
  if (error instanceof WebCallError) {
    return error;
  }
  
  const message = error?.message || 'Unknown error occurred';
  
  // Check for specific error patterns
  if (error?.code === 'ECONNREFUSED' || error?.code === 'ECONNRESET') {
    return new ServiceUnavailableError(
      'Connection to service failed',
      { originalError: message, code: error.code }
    );
  }
  
  if (error?.code === 'ETIMEDOUT' || error?.message?.includes('timeout')) {
    return new ServiceTimeoutError(
      'Service request timed out',
      { originalError: message, code: error.code }
    );
  }
  
  if (error?.response?.status === 401 || error?.status === 401) {
    return new AuthenticationError(
      'Authentication failed',
      { originalError: message }
    );
  }
  
  if (error?.response?.status === 404 || error?.status === 404) {
    return new ResourceNotFoundError(
      'Resource not found',
      { originalError: message }
    );
  }
  
  if (error?.response?.status === 400 || error?.status === 400) {
    return new InvalidInputError(
      'Invalid input provided',
      { originalError: message }
    );
  }
  
  // Default to generic WebCallError
  return new WebCallError(
    message,
    WebCallErrorType.UNKNOWN_ERROR,
    500,
    false,
    { originalError: message }
  );
}
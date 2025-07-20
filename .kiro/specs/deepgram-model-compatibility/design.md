# Design Document

## Overview

This design addresses the Deepgram model compatibility issue where the system fails to transcribe speech due to insufficient permissions for the "nova-2" model. The solution implements automatic model detection, fallback mechanisms, and configuration validation to ensure reliable speech-to-text functionality across different Deepgram account tiers.

The core problem is that the system is hardcoded to use "nova-2" which requires a paid Deepgram account, but many users may have free accounts that only support basic models like "nova" or "base".

## Architecture

### Model Compatibility Layer
A new service layer will be introduced to handle model compatibility and fallback logic:

```
┌─────────────────────────────────────────────────────────────┐
│                    Voice Call System                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐    ┌──────────────────────────────────┐ │
│  │ Call Controller │────│   Model Compatibility Service   │ │
│  └─────────────────┘    └──────────────────────────────────┘ │
│                                        │                    │
│  ┌─────────────────┐    ┌──────────────▼──────────────────┐ │
│  │ Speech Analysis │────│      Enhanced Deepgram Service  │ │
│  │    Service      │    └─────────────────────────────────┘ │
│  └─────────────────┘                   │                    │
│                         ┌──────────────▼──────────────────┐ │
│                         │        Deepgram API             │ │
│                         └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Model Hierarchy
The system will support a tiered model approach:

1. **Premium Models** (Paid accounts): nova-2, nova-2-general, nova-2-meeting
2. **Standard Models** (Basic paid): nova, nova-general  
3. **Base Models** (Free accounts): base, base-general
4. **Fallback Model** (Always available): base

## Components and Interfaces

### 1. Model Compatibility Service

```typescript
interface ModelCompatibilityService {
  validateModelAccess(apiKey: string, model: string): Promise<ModelValidationResult>;
  getCompatibleModels(apiKey: string): Promise<string[]>;
  selectBestModel(availableModels: string[], preferences: ModelPreferences): string;
  handleModelFallback(currentModel: string, error: DeepgramError): string;
}

interface ModelValidationResult {
  isValid: boolean;
  model: string;
  tier: 'free' | 'basic' | 'premium';
  error?: string;
  suggestedAlternatives: string[];
}

interface ModelPreferences {
  preferredModels: string[];
  useCase: 'general' | 'meeting' | 'phone';
  language: string;
  realtime: boolean;
}
```

### 2. Enhanced Deepgram Service

The existing DeepgramService will be enhanced with:

```typescript
interface EnhancedDeepgramService extends DeepgramService {
  // New methods for model management
  validateAndSetModel(model: string): Promise<boolean>;
  getAccountCapabilities(): Promise<AccountCapabilities>;
  autoConfigureModel(): Promise<string>;
  
  // Enhanced error handling
  handlePermissionError(error: DeepgramError): Promise<void>;
  retryWithFallbackModel(originalRequest: any): Promise<any>;
}

interface AccountCapabilities {
  tier: 'free' | 'basic' | 'premium';
  availableModels: string[];
  features: {
    realtime: boolean;
    batch: boolean;
    streaming: boolean;
  };
  limits: {
    requestsPerMinute: number;
    hoursPerMonth: number;
  };
}
```

### 3. Configuration Validator

```typescript
interface DeepgramConfigValidator {
  validateConfiguration(config: DeepgramConfig): Promise<ValidationResult>;
  suggestOptimalSettings(accountTier: string): DeepgramConfig;
  testModelAccess(apiKey: string, model: string): Promise<boolean>;
}

interface ValidationResult {
  isValid: boolean;
  issues: ValidationIssue[];
  recommendations: ConfigRecommendation[];
}

interface ValidationIssue {
  type: 'error' | 'warning';
  field: string;
  message: string;
  suggestedFix: string;
}
```

## Data Models

### Enhanced Deepgram Configuration

```typescript
interface EnhancedDeepgramConfig {
  apiKey: string;
  isEnabled: boolean;
  
  // Model configuration with fallback support
  primaryModel: string;
  fallbackModels: string[];
  autoFallback: boolean;
  
  // Account information
  accountTier?: 'free' | 'basic' | 'premium';
  availableModels?: string[];
  lastModelValidation?: Date;
  
  // Validation status
  lastVerified?: Date;
  status: 'unverified' | 'verified' | 'failed' | 'degraded';
  lastError?: string;
  
  // Performance settings
  tier: string;
  retryAttempts: number;
  timeoutMs: number;
}
```

### Model Registry

```typescript
interface ModelRegistry {
  models: {
    [key: string]: ModelInfo;
  };
}

interface ModelInfo {
  name: string;
  tier: 'free' | 'basic' | 'premium';
  features: string[];
  useCases: string[];
  languages: string[];
  deprecated?: boolean;
  replacedBy?: string;
}
```

## Error Handling

### Error Classification System

```typescript
enum DeepgramErrorType {
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',
  INVALID_MODEL = 'INVALID_MODEL',
  QUOTA_EXCEEDED = 'QUOTA_EXCEEDED',
  NETWORK_ERROR = 'NETWORK_ERROR',
  AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR'
}

interface ErrorHandler {
  classifyError(error: any): DeepgramErrorType;
  getRecoveryStrategy(errorType: DeepgramErrorType): RecoveryStrategy;
  executeRecovery(strategy: RecoveryStrategy): Promise<boolean>;
}

interface RecoveryStrategy {
  type: 'fallback_model' | 'retry' | 'degrade_service' | 'fail';
  parameters: any;
  maxAttempts: number;
}
```

### Fallback Chain

1. **Primary Model Failure** → Try first fallback model
2. **First Fallback Failure** → Try second fallback model  
3. **All Fallbacks Failed** → Use base model
4. **Base Model Failed** → Degrade to text-only mode

## Testing Strategy

### 1. Model Validation Tests

```typescript
describe('Model Compatibility Service', () => {
  test('should detect free account limitations', async () => {
    const result = await modelService.validateModelAccess(freeApiKey, 'nova-2');
    expect(result.isValid).toBe(false);
    expect(result.suggestedAlternatives).toContain('base');
  });

  test('should successfully fallback to compatible model', async () => {
    const model = await modelService.handleModelFallback('nova-2', permissionError);
    expect(model).toBe('base');
  });
});
```

### 2. Integration Tests

```typescript
describe('Deepgram Service Integration', () => {
  test('should handle permission errors gracefully', async () => {
    const service = new EnhancedDeepgramService(freeApiKey);
    const result = await service.transcribeAudio(audioBuffer);
    expect(result.fallback).toBe(true);
    expect(result.transcript).toBeDefined();
  });

  test('should auto-configure optimal model', async () => {
    const service = new EnhancedDeepgramService(apiKey);
    const model = await service.autoConfigureModel();
    expect(model).toMatch(/^(nova-2|nova|base)$/);
  });
});
```

### 3. Configuration Tests

```typescript
describe('Configuration Validator', () => {
  test('should validate model compatibility', async () => {
    const result = await validator.validateConfiguration(config);
    expect(result.isValid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('should suggest optimal settings for account tier', async () => {
    const config = await validator.suggestOptimalSettings('free');
    expect(config.primaryModel).toBe('base');
    expect(config.fallbackModels).toEqual([]);
  });
});
```

### 4. Error Recovery Tests

```typescript
describe('Error Recovery', () => {
  test('should recover from permission errors', async () => {
    const handler = new ErrorHandler();
    const strategy = handler.getRecoveryStrategy(DeepgramErrorType.INSUFFICIENT_PERMISSIONS);
    expect(strategy.type).toBe('fallback_model');
  });

  test('should maintain service availability during failures', async () => {
    // Simulate permission error
    mockDeepgramAPI.mockRejectedValue(new DeepgramPermissionError());
    
    const result = await service.transcribeAudio(audioBuffer);
    expect(result.transcript).toBeDefined();
    expect(result.fallback).toBe(true);
  });
});
```

## Implementation Phases

### Phase 1: Model Detection and Validation
- Implement model compatibility checking
- Add account tier detection
- Create model registry with compatibility matrix

### Phase 2: Fallback Mechanisms  
- Implement automatic model fallback
- Add retry logic with different models
- Create graceful degradation paths

### Phase 3: Configuration Enhancement
- Update configuration schema
- Add validation and testing tools
- Implement auto-configuration features

### Phase 4: Monitoring and Alerting
- Add model performance monitoring
- Implement proactive model validation
- Create admin notifications for model issues

## Security Considerations

1. **API Key Protection**: Ensure API keys are never logged in plaintext
2. **Error Message Sanitization**: Avoid exposing sensitive account information in error messages
3. **Rate Limiting**: Implement proper rate limiting to avoid quota exhaustion
4. **Audit Logging**: Log all model changes and fallback events for troubleshooting

## Performance Considerations

1. **Model Caching**: Cache model validation results to reduce API calls
2. **Lazy Loading**: Only validate models when needed
3. **Background Validation**: Periodically validate model access in background
4. **Circuit Breaker**: Use existing circuit breaker pattern for model validation calls

## Monitoring and Observability

1. **Model Usage Metrics**: Track which models are being used
2. **Fallback Frequency**: Monitor how often fallbacks occur
3. **Error Rates**: Track permission errors and recovery success rates
4. **Performance Impact**: Measure latency impact of model validation
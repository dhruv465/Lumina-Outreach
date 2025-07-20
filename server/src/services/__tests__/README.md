# Model Compatibility Tests

This directory contains comprehensive tests for the Deepgram model compatibility system, addressing requirements 1.1, 1.2, 2.4, and 3.1.

## Test Files

### 1. `modelCompatibilityService.test.ts`
**Unit tests for the Model Compatibility Service**

- **Model Validation Tests**: Tests for validating model access against different account tiers
- **Account Capabilities Detection**: Tests for detecting free, basic, and premium account capabilities
- **Model Selection Logic**: Tests for selecting optimal models based on preferences and use cases
- **Fallback Logic**: Tests for model fallback hierarchy (premium → basic → free)
- **Error Classification**: Tests for classifying different types of Deepgram errors
- **Caching Behavior**: Tests for validation result caching and cache invalidation
- **Edge Cases**: Tests for handling unknown models, mixed availability, and service failures

**Key Features Tested:**
- Model validation with different error types (403, 401, 429, network errors)
- Account tier detection based on available models
- Model preference handling (use case, language, realtime requirements)
- Fallback model suggestions based on error types
- Cache TTL and invalidation on API key changes

### 2. `deepgramErrorHandler.test.ts`
**Unit tests for the Deepgram Error Handler**

- **Error Classification**: Tests for classifying permission, quota, authentication, and network errors
- **Recovery Strategies**: Tests for different recovery strategies based on error types
- **Retry Logic**: Tests for exponential backoff with jitter and maximum delay limits
- **Error Message Handling**: Tests for providing specific guidance for different error types
- **Advanced Error Classification**: Tests for complex SDK error structures and edge cases
- **Recovery Scenarios**: Tests for cascading failures and recovery success/failure alerts

**Key Features Tested:**
- Error classification with detailed guidance messages
- Exponential backoff calculations with jitter
- Recovery strategy selection based on error context
- Alert creation for critical errors
- Retry logic with proper failure handling

### 3. `modelCompatibilityIntegration.test.ts`
**Integration tests for the complete model compatibility system**

- **Account Tier Scenarios**: Tests for free, basic, and premium account behaviors
- **Error Recovery Scenarios**: Tests for network errors, quota exceeded, and authentication failures
- **Stream Creation**: Tests for creating transcription streams with model validation
- **Configuration Validation**: Tests for complete configuration validation workflows
- **Performance and Caching**: Tests for caching behavior and concurrent requests
- **Edge Cases**: Tests for service failures, malformed responses, and error conditions

**Key Features Tested:**
- End-to-end workflows for different account tiers
- Model fallback during transcription and streaming
- Configuration validation with issue detection
- Performance optimization through caching
- Graceful handling of service degradation

### 4. `deepgramServiceWithRecovery.integration.test.ts`
**Integration tests for the Enhanced Deepgram Service**

- **Audio Transcription**: Tests for transcription with and without fallback
- **Stream Creation**: Tests for creating streams with model validation
- **Configuration Validation**: Tests for detecting configuration issues
- **Advanced Recovery**: Tests for multiple failure types and recovery scenarios
- **Error Handling**: Tests for network errors, service degradation, and method delegation

**Key Features Tested:**
- Audio transcription with automatic recovery
- Stream creation with fallback model selection
- Configuration validation with detailed error reporting
- Event emission for monitoring fallback usage
- Service method delegation and statistics

## Test Coverage

The tests cover all major requirements:

### Requirement 1.1 & 1.2 (Model Validation and Fallback)
- ✅ Model access validation against account permissions
- ✅ Automatic fallback to compatible models
- ✅ Model compatibility detection and caching
- ✅ Account tier detection based on available models

### Requirement 2.4 (Retry Logic)
- ✅ Exponential backoff with jitter
- ✅ Maximum retry attempts and delay limits
- ✅ Error classification for retry decisions
- ✅ Recovery strategy selection based on error types

### Requirement 3.1 (User Experience)
- ✅ Seamless model transitions during transcription
- ✅ Consistent user experience with fallback models
- ✅ Real-time stream creation with model validation
- ✅ Graceful degradation during service issues

## Running the Tests

```bash
# Run all model compatibility tests
npm test -- --testPathPattern="modelCompatibility|deepgramErrorHandler|deepgramServiceWithRecovery.integration"

# Run individual test files
npm test -- --testPathPattern="modelCompatibilityService.test.ts"
npm test -- --testPathPattern="deepgramErrorHandler.test.ts"
npm test -- --testPathPattern="modelCompatibilityIntegration.test.ts"
npm test -- --testPathPattern="deepgramServiceWithRecovery.integration.test.ts"
```

## Test Statistics

- **Total Tests**: 94 tests across 4 test files
- **Test Coverage**: Comprehensive coverage of all model compatibility features
- **Test Types**: Unit tests, integration tests, and error recovery scenarios
- **Mock Strategy**: Proper mocking of external dependencies (Deepgram SDK, logger, alerts)

## Key Testing Patterns

1. **Comprehensive Error Simulation**: Tests simulate various Deepgram API errors (403, 401, 429, network)
2. **Account Tier Testing**: Tests cover free, basic, and premium account scenarios
3. **Fallback Chain Testing**: Tests verify the complete fallback hierarchy
4. **Performance Testing**: Tests include caching, concurrent requests, and performance optimization
5. **Edge Case Coverage**: Tests handle malformed responses, service failures, and unknown models
6. **Integration Testing**: Tests verify end-to-end workflows across multiple services

This comprehensive test suite ensures the model compatibility system is robust, reliable, and handles all edge cases gracefully while maintaining excellent user experience.
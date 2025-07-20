# Deepgram Configuration Migration Guide

## Overview

This document describes the migration process for enhancing the Deepgram configuration schema to support model compatibility and fallback mechanisms.

## What Changed

### Schema Enhancements

The Deepgram configuration schema has been enhanced with the following new fields:

#### Model Configuration
- `primaryModel`: Replaces the old `model` field
- `fallbackModels`: Array of fallback models in order of preference
- `autoFallback`: Boolean flag to enable/disable automatic fallback

#### Account Information
- `accountTier`: Account tier ('free', 'basic', 'premium')
- `availableModels`: List of models available for the account
- `lastModelValidation`: Timestamp of last model validation

#### Performance Settings
- `retryAttempts`: Number of retry attempts (1-10)
- `timeoutMs`: Request timeout in milliseconds (5000-120000)

#### Model Compatibility Tracking
- `modelCompatibilityStatus`: Map tracking compatibility status for each model

#### Enhanced Status
- `status`: Now supports 'degraded' status in addition to existing values

## Migration Process

### Automatic Migration

The system includes an automatic migration script that:

1. **Migrates existing configurations** from old schema to new schema
2. **Preserves existing settings** while adding new required fields
3. **Sets sensible defaults** for new fields based on current configuration
4. **Maintains backward compatibility** during the transition

### Running Migration

```bash
# Run the migration
npm run migrate:deepgram

# Validate migration results
npm run migrate:deepgram:validate

# Rollback if needed (for testing)
npm run migrate:deepgram:rollback
```

### Migration Details

#### Field Mapping
- `model` → `primaryModel`
- New `fallbackModels` based on model hierarchy
- New `autoFallback` defaults to `true`
- New `retryAttempts` defaults to `3`
- New `timeoutMs` defaults to `30000`

#### Default Fallback Chains
- `nova-2` → `['nova', 'base']`
- `nova` → `['base']`
- `base` → `[]` (no fallback needed)

## Configuration Validation

### New Validation Features

The enhanced configuration includes comprehensive validation:

#### API Key Validation
- Presence check
- Format validation
- Masked key detection

#### Model Configuration Validation
- Primary model existence check
- Fallback model validation
- Account tier compatibility
- Optimal fallback chain suggestions

#### Performance Settings Validation
- Retry attempts range (1-10)
- Timeout range (5000-120000ms)
- Performance recommendations

### Using the Validator

```typescript
import { DeepgramConfigValidator } from '../utils/deepgramConfigValidator';

// Validate configuration
const result = DeepgramConfigValidator.validateConfiguration(config);

// Get optimal configuration for account tier
const optimal = DeepgramConfigValidator.suggestOptimalConfiguration('premium');

// Get model recommendations
const models = DeepgramConfigValidator.getModelRecommendations('phone', 'premium');
```

## Model Compatibility

### Model Hierarchy

The system supports a three-tier model hierarchy:

#### Premium Models (Paid accounts)
- `nova-2`, `nova-2-general`, `nova-2-meeting`, etc.
- Highest quality, latest features
- Requires premium Deepgram account

#### Standard Models (Basic paid accounts)
- `nova`, `nova-general`, `nova-meeting`, etc.
- Good quality, standard features
- Requires basic paid Deepgram account

#### Base Models (Free accounts)
- `base`, `base-general`
- Basic quality, essential features
- Available on free Deepgram accounts

### Fallback Logic

When a model fails due to permissions:
1. Try first fallback model
2. Try subsequent fallback models
3. Fall back to `base` model as last resort
4. If all fail, degrade service gracefully

## Testing

### Unit Tests

The migration includes comprehensive unit tests:

```bash
npm test -- --testPathPattern=deepgramConfigValidator.test.ts
```

### Integration Testing

Test the migration on a copy of production data:

1. Create database backup
2. Run migration on test environment
3. Validate all configurations
4. Test API functionality
5. Verify fallback mechanisms

## Rollback Plan

If issues occur during migration:

```bash
# Rollback to previous schema
npm run migrate:deepgram:rollback
```

The rollback process:
1. Restores `model` field from `primaryModel`
2. Removes all new fields
3. Maintains existing functionality

## Monitoring

After migration, monitor:

- Configuration validation success rates
- Model fallback frequency
- API error rates
- Performance impact

## Support

For issues or questions:
1. Check migration validation results
2. Review error logs
3. Test configuration with validator
4. Use rollback if necessary

## Next Steps

After successful migration:
1. Update frontend to support new fields
2. Implement model compatibility service
3. Add real-time model validation
4. Enable automatic model optimization
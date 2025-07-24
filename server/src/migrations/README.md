# Deepgram Model Compatibility Migration

This directory contains migration scripts for updating Deepgram configurations to support the new model compatibility features.

## Overview

The Deepgram Model Compatibility Migration addresses the issue where the system fails to transcribe speech due to insufficient permissions for premium models like "nova-2". The migration:

1. **Updates database schema** to support new model compatibility fields
2. **Tests existing configurations** against the Deepgram API to determine account capabilities
3. **Updates model settings** to use compatible models based on account tier
4. **Ensures backward compatibility** with existing configurations

## Migration Scripts

### 1. Enhanced Migration (`deepgram-model-compatibility-migration.ts`)

The main migration script that handles both schema updates and model testing.

**Features:**
- Database schema migration for new fields
- Live API testing of model compatibility
- Automatic model fallback configuration
- Account tier detection
- Backward compatibility preservation
- Comprehensive validation and reporting

### 2. Legacy Migration (`deepgram-config-migration.ts`)

The original migration script focused on basic schema changes.

## Usage

### Running the Migration

#### Using npm scripts (recommended):

```bash
# Run full migration (schema + model testing)
npm run migrate:deepgram:compatibility

# Generate migration status report
npm run migrate:deepgram:compatibility:report

# Ensure backward compatibility
npm run migrate:deepgram:compatibility:check

# Rollback migration (emergency use)
npm run migrate:deepgram:compatibility:rollback
```

#### Using the standalone script:

```bash
# From the server directory
node scripts/run-deepgram-migration.js migrate
node scripts/run-deepgram-migration.js report
node scripts/run-deepgram-migration.js compatibility
node scripts/run-deepgram-migration.js rollback
```

#### Direct TypeScript execution:

```bash
# From the server directory
npx ts-node src/migrations/deepgram-model-compatibility-migration.ts migrate
```

### Migration Commands

| Command | Description |
|---------|-------------|
| `migrate` | Run full migration (schema + model testing) |
| `rollback` | Rollback all migration changes |
| `report` | Generate detailed migration status report |
| `compatibility` | Ensure backward compatibility only |

## What the Migration Does

### Schema Changes

The migration adds the following fields to the `deepgramConfig` object:

```typescript
{
  // Model configuration with fallback support
  primaryModel: string;           // Replaces old 'model' field
  fallbackModels: string[];       // Array of fallback models
  autoFallback: boolean;          // Enable automatic fallback
  
  // Account information
  accountTier: 'free' | 'basic' | 'premium';
  availableModels: string[];      // Models available for account
  lastModelValidation: Date;      // Last validation timestamp
  
  // Enhanced validation status
  status: 'unverified' | 'verified' | 'failed' | 'degraded';
  lastError: string;              // Last error message
  
  // Performance settings
  retryAttempts: number;          // Retry attempts for failed requests
  timeoutMs: number;              // Request timeout
  
  // Setup tracking
  firstTimeSetupCompleted: boolean;
  firstTimeSetupDate: Date;
  
  // Model compatibility tracking
  modelCompatibilityStatus: Map<string, {
    isCompatible: boolean;
    lastTested: Date;
    error?: string;
  }>;
}
```

### Model Testing Process

For each enabled Deepgram configuration:

1. **API Key Validation**: Verify the API key is valid
2. **Account Capability Detection**: Determine account tier and available models
3. **Primary Model Testing**: Test if the configured primary model is accessible
4. **Fallback Configuration**: Set up appropriate fallback models
5. **Status Updates**: Update configuration status based on test results

### Migration Outcomes

After migration, configurations will have one of these statuses:

- **`verified`**: Primary model is accessible and working
- **`degraded`**: Primary model failed, using fallback model
- **`failed`**: No compatible models found
- **`unverified`**: Configuration not tested (no API key)

## Testing

Run the migration tests:

```bash
npm test -- src/migrations/__tests__/deepgram-model-compatibility-migration.test.ts
```

The test suite covers:
- Schema migration scenarios
- Model testing and fallback logic
- Validation and error handling
- Backward compatibility
- Rollback functionality

## Monitoring and Alerts

The migration integrates with the existing alert system to notify administrators of:

- Model validation failures
- Account tier limitations
- Fallback events
- Critical service degradation

## Rollback Procedure

If issues occur after migration, you can rollback:

```bash
npm run migrate:deepgram:compatibility:rollback
```

**Warning**: Rollback will remove all new model compatibility features and revert to the old schema.

## Backward Compatibility

The migration maintains backward compatibility by:

1. Preserving existing `model` field values
2. Setting sensible defaults for new fields
3. Ensuring old API calls continue to work
4. Providing migration path for gradual adoption

## Environment Variables

Ensure these environment variables are set:

```bash
MONGODB_URI=mongodb://localhost:27017/projectcall
```

## Troubleshooting

### Common Issues

1. **MongoDB Connection Errors**
   - Verify `MONGODB_URI` is correct
   - Ensure MongoDB is running

2. **API Key Validation Failures**
   - Check Deepgram API keys are valid
   - Verify network connectivity to Deepgram API

3. **Migration Validation Failures**
   - Run migration report to identify issues
   - Check logs for specific error messages

### Getting Help

1. Check the migration logs for detailed error information
2. Run the migration report to see current status
3. Review the test suite for expected behavior
4. Check the main application logs for runtime issues

## Migration Report Example

```
Migration Report: {
  summary: {
    totalConfigurations: 5,
    accountTiers: { free: 2, basic: 1, premium: 2, unknown: 0 },
    statuses: { verified: 3, degraded: 1, failed: 1, unverified: 0 },
    fallbackEvents: 1,
    issueCount: 1
  },
  modelUsage: { 'nova-2': 2, 'nova': 2, 'base': 1 },
  issues: [
    'Config 507f1f77bcf86cd799439011: No compatible models found. Error: Invalid API key'
  ]
}
```

This report helps identify:
- Distribution of account tiers
- Model usage patterns
- Configurations requiring attention
- Overall migration success rate
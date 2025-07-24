/**
 * scheduledDiagnostics.ts
 * Scheduled job to run diagnostics and update metrics
 */

import { CronJob } from 'cron';
import { ModelCompatibilityService } from '../services/modelCompatibilityService';
import { runModelCompatibilityDiagnostic } from '../utils/modelCompatibilityDiagnostic';
import logger from '../utils/logger';
import { alertSystem, AlertLevel, AlertType } from '../monitoring/alert_system';

// Default schedule: Run twice daily (noon and midnight)
const DEFAULT_SCHEDULE = process.env.MODEL_DIAGNOSTIC_SCHEDULE || '0 0,12 * * *';

let diagnosticJob: CronJob | null = null;

/**
 * Start scheduled model compatibility diagnostics
 */
export function startScheduledDiagnostics(modelCompatibilityService: ModelCompatibilityService): void {
  if (diagnosticJob) {
    stopScheduledDiagnostics();
  }
  
  try {
    diagnosticJob = new CronJob(
      DEFAULT_SCHEDULE,
      async () => {
        logger.info('Running scheduled model compatibility diagnostic');
        
        try {
          const result = await runModelCompatibilityDiagnostic(modelCompatibilityService);
          
          logger.info('Scheduled model compatibility diagnostic completed', {
            timestamp: result.timestamp,
            overallStatus: result.overallStatus,
            issueCount: result.issues.length,
            accountTier: result.accountTier
          });
          
          // Create alert for non-healthy status
          if (result.overallStatus !== 'healthy') {
            alertSystem.createAlert(
              result.overallStatus === 'critical' ? AlertLevel.CRITICAL : AlertLevel.WARNING,
              'scheduled-diagnostic-result' as AlertType,
              `Scheduled diagnostic: ${result.issues.length} issues found (${result.overallStatus})`,
              {
                result,
                timestamp: new Date().toISOString()
              },
              'scheduled-diagnostic'
            );
          }
        } catch (error) {
          logger.error('Error in scheduled model compatibility diagnostic:', error);
          
          alertSystem.createAlert(
            AlertLevel.CRITICAL,
            'scheduled-diagnostic-failure' as AlertType,
            'Scheduled model compatibility diagnostic failed',
            {
              error: error instanceof Error ? error.message : String(error),
              timestamp: new Date().toISOString()
            },
            'scheduled-diagnostic'
          );
        }
      },
      null, // onComplete
      true, // start
      'UTC'
    );
    
    logger.info(`Scheduled model compatibility diagnostics started (Schedule: ${DEFAULT_SCHEDULE})`);
  } catch (error) {
    logger.error('Failed to start scheduled model compatibility diagnostics:', error);
  }
}

/**
 * Stop scheduled model compatibility diagnostics
 */
export function stopScheduledDiagnostics(): void {
  if (diagnosticJob) {
    diagnosticJob.stop();
    diagnosticJob = null;
    logger.info('Scheduled model compatibility diagnostics stopped');
  }
}

/**
 * Run diagnostic immediately (on-demand)
 */
export async function runDiagnosticImmediately(modelCompatibilityService: ModelCompatibilityService): Promise<any> {
  logger.info('Running on-demand model compatibility diagnostic');
  
  try {
    const result = await runModelCompatibilityDiagnostic(modelCompatibilityService);
    
    logger.info('On-demand model compatibility diagnostic completed', {
      timestamp: result.timestamp,
      overallStatus: result.overallStatus,
      issueCount: result.issues.length,
      accountTier: result.accountTier
    });
    
    return result;
  } catch (error) {
    logger.error('Error in on-demand model compatibility diagnostic:', error);
    throw error;
  }
}

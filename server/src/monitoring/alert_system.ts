/**
 * Alert System Stub
 * Minimal implementation to replace removed monitoring functionality
 */

export enum AlertLevel {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
  WARNING = 'warning',
  INFO = 'info'
}

export enum AlertType {
  SYSTEM = 'system',
  PERFORMANCE = 'performance',
  ERROR = 'error',
  SECURITY = 'security'
}

export interface Alert {
  level: AlertLevel;
  type: AlertType;
  message: string;
  timestamp: Date;
  metadata?: any;
}

class AlertSystemStub {
  sendAlert(alert: Alert): void {
    // Stub implementation - just log the alert
    console.log(`[ALERT] ${alert.level.toUpperCase()}: ${alert.message}`);
  }

  createAlert(level: AlertLevel, type: AlertType, message: string, metadata?: any, source?: string): void {
    // Stub implementation - just log the alert
    console.log(`[ALERT] ${level.toUpperCase()}: ${message}`, metadata ? metadata : '', source ? `(${source})` : '');
  }
}

export const alertSystem = new AlertSystemStub();
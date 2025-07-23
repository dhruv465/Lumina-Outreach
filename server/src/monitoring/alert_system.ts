/**
 * alert_system.ts
 * Handles system alerts and notifications
 */

import * as fs from 'fs';
import * as path from 'path';
import logger from '../utils/logger';

export enum AlertLevel {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical'
}

export enum AlertType {
  MODEL_COMPATIBILITY = 'model-compatibility',
  PERFORMANCE = 'performance',
  SYSTEM = 'system',
  VALIDATION = 'validation',
  FALLBACK = 'fallback'
}

export interface Alert {
  id: string;
  level: AlertLevel;
  type: AlertType;
  message: string;
  metadata?: any;
  timestamp: string;
  acknowledged?: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
  source?: string;
}

export class AlertSystem {
  private static instance: AlertSystem | null = null;
  private alerts: Alert[] = [];
  private alertsFile: string;
  private enabled: boolean = true;

  private constructor() {
    this.alertsFile = path.join(process.cwd(), 'logs', 'alerts.json');
    this.ensureAlertsDirectory();
    this.loadAlerts();
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): AlertSystem {
    if (!AlertSystem.instance) {
      AlertSystem.instance = new AlertSystem();
    }
    return AlertSystem.instance;
  }

  /**
   * Create a new alert
   */
  public createAlert(
    level: AlertLevel,
    type: AlertType,
    message: string,
    metadata?: any,
    source?: string
  ): Alert {
    if (!this.enabled) {
      return {} as Alert;
    }

    const alert: Alert = {
      id: this.generateAlertId(),
      level,
      type,
      message,
      metadata,
      timestamp: new Date().toISOString(),
      source
    };

    this.alerts.push(alert);
    this.saveAlerts();

    logger.info(`Alert created: [${level.toUpperCase()}] ${message}`, {
      alertId: alert.id,
      type,
      source,
      metadata
    });

    return alert;
  }

  /**
   * Get alert history
   */
  public getAlertHistory(limit: number = 100, level?: string, type?: string): Alert[] {
    let filteredAlerts = [...this.alerts];
    
    if (level) {
      filteredAlerts = filteredAlerts.filter(alert => alert.level === level);
    }
    
    if (type) {
      filteredAlerts = filteredAlerts.filter(alert => alert.type === type);
    }
    
    return filteredAlerts
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, limit);
  }

  /**
   * Acknowledge an alert
   */
  public acknowledgeAlert(alertId: string, userId?: string): boolean {
    const alert = this.alerts.find(a => a.id === alertId);
    if (!alert) {
      return false;
    }

    alert.acknowledged = true;
    alert.acknowledgedAt = new Date().toISOString();
    if (userId) {
      alert.acknowledgedBy = userId;
    }

    this.saveAlerts();

    logger.info(`Alert acknowledged: ${alertId}`, {
      acknowledgedBy: userId,
      acknowledgedAt: alert.acknowledgedAt
    });

    return true;
  }

  /**
   * Check if alert system is enabled
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Enable/disable alert system
   */
  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    logger.info(`Alert system ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get unacknowledged alerts
   */
  public getUnacknowledgedAlerts(): Alert[] {
    return this.alerts.filter(alert => !alert.acknowledged);
  }

  /**
   * Clear old alerts (older than specified days)
   */
  public clearOldAlerts(daysOld: number = 30): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const initialCount = this.alerts.length;
    this.alerts = this.alerts.filter(alert => 
      new Date(alert.timestamp) >= cutoffDate
    );

    const clearedCount = initialCount - this.alerts.length;
    if (clearedCount > 0) {
      this.saveAlerts();
      logger.info(`Cleared ${clearedCount} old alerts (older than ${daysOld} days)`);
    }

    return clearedCount;
  }

  private generateAlertId(): string {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private ensureAlertsDirectory(): void {
    const alertsDir = path.dirname(this.alertsFile);
    if (!fs.existsSync(alertsDir)) {
      fs.mkdirSync(alertsDir, { recursive: true });
    }
  }

  private loadAlerts(): void {
    try {
      if (fs.existsSync(this.alertsFile)) {
        const data = fs.readFileSync(this.alertsFile, 'utf8');
        this.alerts = JSON.parse(data);
      }
    } catch (error) {
      logger.error('Failed to load alerts from file:', error);
      this.alerts = [];
    }
  }

  private saveAlerts(): void {
    try {
      fs.writeFileSync(this.alertsFile, JSON.stringify(this.alerts, null, 2));
    } catch (error) {
      logger.error('Failed to save alerts to file:', error);
    }
  }
}

// Export singleton instance
export const alertSystem = AlertSystem.getInstance();
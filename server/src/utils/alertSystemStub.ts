/**
 * alertSystemStub.ts
 * A stub for the AlertSystem class
 */

export enum AlertLevel {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical'
}

export type AlertType = string;

export interface Alert {
  id: string;
  level: string;
  type: string;
  message: string;
  details?: any;
  source: string;
  timestamp: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  acknowledgedAt?: string;
}

class AlertSystemStub {
  private static instance: AlertSystemStub;
  private alerts: Alert[] = [];

  private constructor() {}

  public static getInstance(): AlertSystemStub {
    if (!AlertSystemStub.instance) {
      AlertSystemStub.instance = new AlertSystemStub();
    }
    return AlertSystemStub.instance;
  }

  public createAlert(
    level: AlertLevel,
    type: AlertType,
    message: string,
    details?: any,
    source: string = 'system'
  ): string {
    const id = `alert-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const alert: Alert = {
      id,
      level,
      type,
      message,
      details,
      source,
      timestamp: new Date().toISOString(),
      acknowledged: false
    };
    
    this.alerts.push(alert);
    return id;
  }

  public getAlertHistory(limit: number = 100, level?: string, type?: string): Alert[] {
    let filteredAlerts = [...this.alerts];
    
    if (level) {
      filteredAlerts = filteredAlerts.filter(alert => alert.level === level);
    }
    
    if (type) {
      filteredAlerts = filteredAlerts.filter(alert => alert.type === type);
    }
    
    return filteredAlerts.slice(-limit);
  }

  public acknowledgeAlert(alertId: string, userId: string): boolean {
    const alertIndex = this.alerts.findIndex(alert => alert.id === alertId);
    
    if (alertIndex === -1 || this.alerts[alertIndex].acknowledged) {
      return false;
    }
    
    this.alerts[alertIndex] = {
      ...this.alerts[alertIndex],
      acknowledged: true,
      acknowledgedBy: userId,
      acknowledgedAt: new Date().toISOString()
    };
    
    return true;
  }

  public isEnabled(): boolean {
    return true;
  }
}

export const alertSystem = AlertSystemStub.getInstance();

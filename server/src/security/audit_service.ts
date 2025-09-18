/**
 * audit_service.ts
 * Provides comprehensive audit trails for system activities
 */

import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { FastifyRequest, FastifyReply } from 'fastify';
import * as uuid from 'uuid';
import logger from '../utils/logger';

const writeFileAsync = promisify(fs.writeFile);
const appendFileAsync = promisify(fs.appendFile);
const mkdirAsync = promisify(fs.mkdir);

export enum AuditEventType {
  // Authentication events
  LOGIN = 'LOGIN',
  LOGOUT = 'LOGOUT',
  LOGIN_FAILED = 'LOGIN_FAILED',
  PASSWORD_CHANGED = 'PASSWORD_CHANGED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED = 'ACCOUNT_UNLOCKED',
  
  // Data access events
  DATA_ACCESS = 'DATA_ACCESS',
  DATA_EXPORT = 'DATA_EXPORT',
  DATA_IMPORT = 'DATA_IMPORT',
  
  // Data modification events
  DATA_CREATE = 'DATA_CREATE',
  DATA_UPDATE = 'DATA_UPDATE',
  DATA_DELETE = 'DATA_DELETE',
  
  // Call-related events
  CALL_INITIATED = 'CALL_INITIATED',
  CALL_CONNECTED = 'CALL_CONNECTED',
  CALL_DISCONNECTED = 'CALL_DISCONNECTED',
  CALL_RECORDED = 'CALL_RECORDED',
  
  // System events
  SYSTEM_STARTUP = 'SYSTEM_STARTUP',
  SYSTEM_SHUTDOWN = 'SYSTEM_SHUTDOWN',
  CONFIG_CHANGED = 'CONFIG_CHANGED',
  BACKUP_CREATED = 'BACKUP_CREATED',
  MODEL_DEPLOYED = 'MODEL_DEPLOYED',
  
  // Security events
  PERMISSION_CHANGED = 'PERMISSION_CHANGED',
  API_KEY_CREATED = 'API_KEY_CREATED',
  API_KEY_REVOKED = 'API_KEY_REVOKED',
  SECURITY_VIOLATION = 'SECURITY_VIOLATION',
  
  // Other events
  CUSTOM = 'CUSTOM'
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  type: AuditEventType | string;
  userId?: string;
  username?: string;
  ipAddress?: string;
  userAgent?: string;
  resourceType?: string;
  resourceId?: string;
  action?: string;
  details?: any;
  status?: 'success' | 'failure' | 'warning';
  sessionId?: string;
  requestId?: string;
}

export class AuditService {
  private static instance: AuditService;
  private enabled: boolean;
  private auditLogDir: string;
  private logToConsole: boolean;
  private isAsyncMode: boolean;
  private auditQueue: AuditEvent[] = [];
  private processingQueue: boolean = false;

  private constructor() {
    this.enabled = process.env.AUDIT_ENABLED === 'true';
    this.auditLogDir = process.env.AUDIT_LOG_DIR || path.resolve(process.cwd(), 'logs/audit');
    this.logToConsole = process.env.AUDIT_LOG_TO_CONSOLE === 'true';
    this.isAsyncMode = process.env.AUDIT_ASYNC_MODE === 'true';
    
    // Ensure audit log directory exists
    if (this.enabled && !fs.existsSync(this.auditLogDir)) {
      fs.mkdirSync(this.auditLogDir, { recursive: true });
    }
    
    // Start processing queue if in async mode
    if (this.isAsyncMode) {
      this.startQueueProcessing();
    }
  }

  /**
   * Get the singleton instance
   */
  public static getInstance(): AuditService {
    if (!AuditService.instance) {
      AuditService.instance = new AuditService();
    }
    return AuditService.instance;
  }

  /**
   * Configure the audit service
   */
  public configure(options: {
    enabled?: boolean;
    auditLogDir?: string;
    logToConsole?: boolean;
    isAsyncMode?: boolean;
  }): void {
    if (options.enabled !== undefined) {
      this.enabled = options.enabled;
    }
    
    if (options.auditLogDir) {
      this.auditLogDir = options.auditLogDir;
      
      // Ensure new audit log directory exists
      if (this.enabled && !fs.existsSync(this.auditLogDir)) {
        fs.mkdirSync(this.auditLogDir, { recursive: true });
      }
    }
    
    if (options.logToConsole !== undefined) {
      this.logToConsole = options.logToConsole;
    }
    
    if (options.isAsyncMode !== undefined) {
      this.isAsyncMode = options.isAsyncMode;
      
      // Start queue processing if switching to async mode
      if (this.isAsyncMode && !this.processingQueue) {
        this.startQueueProcessing();
      }
    }
    
    logger.info('Audit service configuration updated');
  }

  /**
   * Log an audit event
   */
  public log(
    eventType: AuditEventType | string,
    details: Omit<AuditEvent, 'id' | 'timestamp' | 'type'>
  ): string {
    if (!this.enabled) {
      return '';
    }
    
    const auditEvent: AuditEvent = {
      id: uuid.v4(),
      timestamp: new Date().toISOString(),
      type: eventType,
      ...details
    };
    
    if (this.isAsyncMode) {
      // Add to queue for async processing
      this.auditQueue.push(auditEvent);
    } else {
      // Process immediately
      this.writeAuditLog(auditEvent);
    }
    
    return auditEvent.id;
  }

  /**
   * Start processing the audit queue
   */
  private startQueueProcessing(): void {
    if (this.processingQueue) {
      return;
    }
    
    this.processingQueue = true;
    
    // Process queue every second
    setInterval(() => {
      this.processAuditQueue();
    }, 1000);
    
    logger.debug('Audit queue processing started');
  }

  /**
   * Process audit events in the queue
   */
  private async processAuditQueue(): Promise<void> {
    if (this.auditQueue.length === 0) {
      return;
    }
    
    // Take events from the queue (limited batch size)
    const batchSize = 100;
    const events = this.auditQueue.splice(0, batchSize);
    
    // Group events by date for file organization
    const eventsByDate = new Map<string, AuditEvent[]>();
    
    for (const event of events) {
      const date = event.timestamp.split('T')[0]; // YYYY-MM-DD
      if (!eventsByDate.has(date)) {
        eventsByDate.set(date, []);
      }
      eventsByDate.get(date)!.push(event);
    }
    
    // Write events to appropriate files
    for (const [date, dateEvents] of eventsByDate.entries()) {
      try {
        await this.writeEventsToFile(date, dateEvents);
      } catch (error) {
        logger.error(`Failed to write audit events for ${date}:`, error);
        
        // Put events back in the queue
        this.auditQueue.unshift(...dateEvents);
      }
    }
  }

  /**
   * Write events to the appropriate date-based file
   */
  private async writeEventsToFile(date: string, events: AuditEvent[]): Promise<void> {
    const filePath = path.join(this.auditLogDir, `audit-${date}.jsonl`);
    
    try {
      // Create events as newline-delimited JSON
      const eventsData = events
        .map(event => JSON.stringify(event))
        .join('\n') + '\n';
      
      // Append to file
      await appendFileAsync(filePath, eventsData);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File doesn't exist, create it
        await writeFileAsync(filePath, events.map(event => JSON.stringify(event)).join('\n') + '\n');
      } else {
        throw error;
      }
    }
  }

  /**
   * Write an audit event synchronously
   */
  private writeAuditLog(event: AuditEvent): void {
    try {
      const date = event.timestamp.split('T')[0]; // YYYY-MM-DD
      const filePath = path.join(this.auditLogDir, `audit-${date}.jsonl`);
      
      // Log to console if enabled
      if (this.logToConsole) {
        const logLevel = event.status === 'failure' ? 'error' : 'info';
        logger[logLevel](`AUDIT: ${event.type}`, { audit: event });
      }
      
      // Write to file
      const eventData = JSON.stringify(event) + '\n';
      
      if (fs.existsSync(filePath)) {
        fs.appendFileSync(filePath, eventData);
      } else {
        fs.writeFileSync(filePath, eventData);
      }
    } catch (error) {
      logger.error('Failed to write audit log:', error);
    }
  }

  /**
   * Create an audit hook for Fastify
   */
  public createFastifyHook(options: {
    excludePaths?: string[];
    sensitiveParams?: string[];
    sensitiveHeaders?: string[];
    resourceTypeExtractor?: (req: FastifyRequest) => string;
    resourceIdExtractor?: (req: FastifyRequest) => string;
  } = {}): (req: FastifyRequest, reply: FastifyReply, done: Function) => void {
    return (req: FastifyRequest, reply: FastifyReply, done: Function) => {
      if (!this.enabled) {
        return done();
      }
      
      // Skip excluded paths
      if (options.excludePaths && options.excludePaths.some(path => req.raw.url.startsWith(path))) {
        return done();
      }
      
      // Generate request ID if not already present
      const requestId = req.headers['x-request-id'] as string || uuid.v4();
      req.headers['x-request-id'] = requestId;
      
      // Extract user information
      const userId = (req as any).user?.id || '';
      const username = (req as any).user?.username || '';
      
      // Extract resource information
      const resourceType = options.resourceTypeExtractor 
        ? options.resourceTypeExtractor(req) 
        : this.extractResourceType(req);
      
      const resourceId = options.resourceIdExtractor 
        ? options.resourceIdExtractor(req) 
        : this.extractResourceId(req);
      
      // Create sanitized request details
      const requestDetails = this.sanitizeRequestDetails(req, options.sensitiveParams, options.sensitiveHeaders);
      
      // Determine action from method
      const action = req.raw.method;
      
      // Create base audit event
      const baseEvent: Omit<AuditEvent, 'id' | 'timestamp' | 'type'> = {
        userId,
        username,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'] as string,
        resourceType,
        resourceId,
        action,
        details: { request: requestDetails },
        requestId,
        sessionId: (req as any).session?.id || ''
      };
      
      reply.raw.on('finish', () => {
        // Determine event type based on method and status code
        let eventType: AuditEventType;
        
        switch (req.raw.method) {
          case 'GET':
            eventType = AuditEventType.DATA_ACCESS;
            break;
          case 'POST':
            eventType = AuditEventType.DATA_CREATE;
            break;
          case 'PUT':
          case 'PATCH':
            eventType = AuditEventType.DATA_UPDATE;
            break;
          case 'DELETE':
            eventType = AuditEventType.DATA_DELETE;
            break;
          default:
            eventType = AuditEventType.CUSTOM;
        }
        
        // Add response details
        const status = reply.raw.statusCode < 400 ? 'success' : 'failure';
        const responseDetails = {
          statusCode: reply.raw.statusCode,
          statusMessage: reply.raw.statusMessage
        };
        
        // Log audit event
        AuditService.getInstance().log(eventType, {
          ...baseEvent,
          status,
          details: {
            ...baseEvent.details,
            response: responseDetails
          }
        });
      });
      
      done();
    };
  }

  /**
   * Extract resource type from request
   */
  private extractResourceType(req: FastifyRequest): string {
    // Try to extract from path
    const pathParts = req.raw.url.split('/').filter(Boolean);
    
    if (pathParts.length > 0) {
      // Handle common API patterns
      if (pathParts[0] === 'api' && pathParts.length > 1) {
        return pathParts[1];
      }
      
      return pathParts[0];
    }
    
    return 'unknown';
  }

  /**
   * Extract resource ID from request
   */
  private extractResourceId(req: FastifyRequest): string {
    // Try to extract from path
    const pathParts = req.raw.url.split('/').filter(Boolean);
    
    // Look for ID pattern in path
    for (let i = 1; i < pathParts.length; i++) {
      const part = pathParts[i];
      
      // If previous part is likely a resource type and current part looks like an ID
      if (pathParts[i - 1] && !pathParts[i - 1].includes('.') && 
          (part.match(/^[a-f0-9-]{36}$/i) || // UUID pattern
           part.match(/^[a-f0-9]{24}$/i) ||  // MongoDB ObjectId pattern
           part.match(/^\d+$/))) {           // Numeric ID pattern
        return part;
      }
    }
    
    // Check for ID in query params
    if ((req.query as any).id) {
      return (req.query as any).id as string;
    }
    
    // Check for ID in body
    if ((req.body as any) && (req.body as any).id) {
      return (req.body as any).id;
    }
    
    return '';
  }

  /**
   * Sanitize request details to remove sensitive information
   */
  private sanitizeRequestDetails(
    req: FastifyRequest,
    sensitiveParams: string[] = [],
    sensitiveHeaders: string[] = []
  ): any {
    // Default sensitive parameters
    const defaultSensitiveParams = [
      'password', 'passwordConfirmation', 'token', 'apiKey',
      'secret', 'accessToken', 'refreshToken', 'creditCard',
      'cardNumber', 'cvv', 'ssn', 'socialSecurity'
    ];
    
    // Default sensitive headers
    const defaultSensitiveHeaders = [
      'authorization', 'x-api-key', 'cookie', 'set-cookie',
      'x-auth-token', 'x-access-token', 'refresh-token'
    ];
    
    // Combine defaults with custom lists
    const allSensitiveParams = [...defaultSensitiveParams, ...sensitiveParams];
    const allSensitiveHeaders = [...defaultSensitiveHeaders, ...sensitiveHeaders];
    
    // Sanitize query parameters
    const sanitizedQuery = { ...(req.query as any) };
    for (const param of allSensitiveParams) {
      if (sanitizedQuery[param]) {
        sanitizedQuery[param] = '***REDACTED***';
      }
    }
    
    // Sanitize body
    let sanitizedBody: any = null;
    if (req.body) {
      sanitizedBody = { ...(req.body as any) };
      this.redactSensitiveFields(sanitizedBody, allSensitiveParams);
    }
    
    // Sanitize headers
    const sanitizedHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (allSensitiveHeaders.includes(key.toLowerCase())) {
        sanitizedHeaders[key] = '***REDACTED***';
      } else {
        sanitizedHeaders[key] = value as string;
      }
    }
    
    return {
      method: req.raw.method,
      path: req.raw.url,
      query: sanitizedQuery,
      body: sanitizedBody,
      headers: sanitizedHeaders
    };
  }

  /**
   * Recursively redact sensitive fields in an object
   */
  private redactSensitiveFields(obj: any, sensitiveFields: string[]): void {
    if (!obj || typeof obj !== 'object') {
      return;
    }
    
    for (const key of Object.keys(obj)) {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
        obj[key] = '***REDACTED***';
      } else if (typeof obj[key] === 'object') {
        this.redactSensitiveFields(obj[key], sensitiveFields);
      }
    }
  }

  /**
   * Get audit logs for a specific date range
   */
  public async getAuditLogs(options: {
    startDate: Date;
    endDate: Date;
    type?: AuditEventType | string;
    userId?: string;
    resourceType?: string;
    resourceId?: string;
    status?: 'success' | 'failure' | 'warning';
    limit?: number;
  }): Promise<AuditEvent[]> {
    if (!this.enabled) {
      return [];
    }
    
    const { startDate, endDate, type, userId, resourceType, resourceId, status, limit } = options;
    
    // Generate date range
    const dates: string[] = [];
    const currentDate = new Date(startDate);
    
    while (currentDate <= endDate) {
      dates.push(currentDate.toISOString().split('T')[0]);
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    // Collect events from each date file
    const allEvents: AuditEvent[] = [];
    
    for (const date of dates) {
      const filePath = path.join(this.auditLogDir, `audit-${date}.jsonl`);
      
      if (!fs.existsSync(filePath)) {
        continue;
      }
      
      try {
        const fileContent = await promisify(fs.readFile)(filePath, 'utf8');
        const lines = fileContent.split('\n').filter(Boolean);
        
        for (const line of lines) {
          try {
            const event = JSON.parse(line) as AuditEvent;
            
            // Apply filters
            if (type && event.type !== type) continue;
            if (userId && event.userId !== userId) continue;
            if (resourceType && event.resourceType !== resourceType) continue;
            if (resourceId && event.resourceId !== resourceId) continue;
            if (status && event.status !== status) continue;
            
            allEvents.push(event);
            
            // Apply limit if needed
            if (limit && allEvents.length >= limit) {
              return allEvents;
            }
          } catch (parseError) {
            logger.error(`Failed to parse audit log entry: ${line}`, parseError);
          }
        }
      } catch (error) {
        logger.error(`Failed to read audit log file ${filePath}:`, error);
      }
    }
    
    // Sort by timestamp (newest first)
    allEvents.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    // Apply limit if needed
    return limit ? allEvents.slice(0, limit) : allEvents;
  }

  /**
   * Log a system startup event
   */
  public logSystemStartup(details?: any): string {
    return this.log(AuditEventType.SYSTEM_STARTUP, {
      details: {
        version: process.env.npm_package_version,
        nodeVersion: process.version,
        environment: process.env.NODE_ENV,
        ...details
      },
      status: 'success'
    });
  }

  /**
   * Log a system shutdown event
   */
  public logSystemShutdown(details?: any): string {
    return this.log(AuditEventType.SYSTEM_SHUTDOWN, {
      details: {
        uptime: process.uptime(),
        ...details
      },
      status: 'success'
    });
  }

  /**
   * Log a security violation event
   */
  public logSecurityViolation(
    details: {
      userId?: string;
      username?: string;
      ipAddress?: string;
      userAgent?: string;
      violationType: string;
      description: string;
      resourceType?: string;
      resourceId?: string;
      [key: string]: any;
    }
  ): string {
    return this.log(AuditEventType.SECURITY_VIOLATION, {
      userId: details.userId,
      username: details.username,
      ipAddress: details.ipAddress,
      userAgent: details.userAgent,
      resourceType: details.resourceType,
      resourceId: details.resourceId,
      details: {
        violationType: details.violationType,
        description: details.description,
        ...details
      },
      status: 'failure'
    });
  }
}

// Create and export singleton instance
export const auditService = AuditService.getInstance();
export default auditService;
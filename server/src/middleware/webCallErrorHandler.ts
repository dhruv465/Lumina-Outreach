/**
 * Web Call Error Handler Middleware
 * 
 * This middleware handles errors for web call API endpoints.
 * It provides standardized error responses and logging.
 */

import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { EnhancedErrorHandlingService } from '../services/enhancedErrorHandling';

const enhancedErrorHandling = new EnhancedErrorHandlingService();

/**
 * Error types
 */
export enum WebCallErrorType {
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  VALIDATION = 'validation',
  NOT_FOUND = 'not_found',
  RATE_LIMIT = 'rate_limit',
  SERVICE_UNAVAILABLE = 'service_unavailable',
  INTERNAL = 'internal'
}

/**
 * Web call error
 */
export class WebCallError extends Error {
  type: WebCallErrorType;
  statusCode: number;
  details?: any;

  constructor(
    message: string,
    type: WebCallErrorType = WebCallErrorType.INTERNAL,
    statusCode: number = 500,
    details?: any
  ) {
    super(message);
    this.name = 'WebCallError';
    this.type = type;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * Web call error handler middleware
 * @param err Error object
 * @param req Express request
 * @param res Express response
 * @param next Express next function
 */
export const webCallErrorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Default error response
  let statusCode = 500;
  let errorType = WebCallErrorType.INTERNAL;
  let errorMessage = 'An unexpected error occurred';
  let errorDetails: any = undefined;

  // Handle WebCallError
  if (err instanceof WebCallError) {
    statusCode = err.statusCode;
    errorType = err.type;
    errorMessage = err.message;
    errorDetails = err.details;
  }

  // Handle other known error types
  else if (err.name === 'ValidationError') {
    statusCode = 400;
    errorType = WebCallErrorType.VALIDATION;
    errorMessage = 'Validation error';
    errorDetails = enhancedErrorHandling.generateDetailedErrorMessage(err, '', undefined);
  }
  else if (err.name === 'CastError') {
    statusCode = 400;
    errorType = WebCallErrorType.VALIDATION;
    errorMessage = 'Invalid ID format';
  }
  else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorType = WebCallErrorType.AUTHENTICATION;
    errorMessage = 'Invalid token';
  }
  else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    errorType = WebCallErrorType.AUTHENTICATION;
    errorMessage = 'Token expired';
  }

  // Log error
  if (statusCode >= 500) {
    logger.error(`Web call error: ${err.message}`, {
      type: errorType,
      path: req.path,
      method: req.method,
      statusCode,
      stack: err.stack
    });
  } else {
    logger.warn(`Web call error: ${err.message}`, {
      type: errorType,
      path: req.path,
      method: req.method,
      statusCode
    });
  }

  // Send error response
  res.status(statusCode).json({
    error: errorType,
    message: errorMessage,
    details: errorDetails,
    path: req.path,
    timestamp: new Date().toISOString()
  });
};

/**
 * Create a web call error
 * @param message Error message
 * @param type Error type
 * @param statusCode HTTP status code
 * @param details Additional error details
 * @returns WebCallError
 */
export const createWebCallError = (
  message: string,
  type: WebCallErrorType = WebCallErrorType.INTERNAL,
  statusCode: number = 500,
  details?: any
): WebCallError => {
  return new WebCallError(message, type, statusCode, details);
};
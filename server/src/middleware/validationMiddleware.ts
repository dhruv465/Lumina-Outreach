/**
 * Validation Middleware
 * 
 * This middleware validates request data for API endpoints.
 * It uses Joi for schema validation.
 */

import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';
import { WebCallError, WebCallErrorType } from './webCallErrorHandler';

/**
 * Basic request validation middleware
 * This is a simplified version that just passes through for now
 * @param schema Validation schema (simplified)
 * @returns Express middleware
 */
export const validateRequest = (schema: any) => {
  return (req: Request, res: Response, next: NextFunction) => {
    // For now, just pass through - this would normally validate based on the schema
    next();
  };
};

/**
 * Validation schemas for web call requests
 */
const webCallSchemas = {
  initialize: Joi.object({
    campaignId: Joi.string().required().messages({
      'string.empty': 'Campaign ID is required',
      'any.required': 'Campaign ID is required'
    })
  }),
  
  end: Joi.object({
    testId: Joi.string().required().messages({
      'string.empty': 'Test ID is required',
      'any.required': 'Test ID is required'
    })
  }).unknown(true),
  
  getTest: Joi.object({
    testId: Joi.string().required().regex(/^[0-9a-fA-F]{24}$/).messages({
      'string.empty': 'Test ID is required',
      'string.pattern.base': 'Invalid Test ID format',
      'any.required': 'Test ID is required'
    })
  }).unknown(true),
  
  exportTranscript: Joi.object({
    testId: Joi.string().required().regex(/^[0-9a-fA-F]{24}$/).messages({
      'string.empty': 'Test ID is required',
      'string.pattern.base': 'Invalid Test ID format',
      'any.required': 'Test ID is required'
    }),
    format: Joi.string().valid('json', 'txt', 'csv').default('json').messages({
      'any.only': 'Format must be one of: json, txt, csv'
    })
  }).unknown(true)
};

/**
 * Validate web call request
 * @param schemaName Schema name
 * @returns Express middleware
 */
export const validateWebCallRequest = (schemaName: keyof typeof webCallSchemas) => {
  return (req: Request, res: Response, next: NextFunction) => {
    const schema = webCallSchemas[schemaName];
    
    // Determine what to validate based on the request type
    let dataToValidate: any = {};
    
    // For path parameters
    if (req.params && Object.keys(req.params).length > 0) {
      dataToValidate = { ...dataToValidate, ...req.params };
    }
    
    // For query parameters
    if (req.query && Object.keys(req.query).length > 0) {
      dataToValidate = { ...dataToValidate, ...req.query };
    }
    
    // For body parameters
    if (req.body && Object.keys(req.body).length > 0) {
      dataToValidate = { ...dataToValidate, ...req.body };
    }
    
    // Validate data
    const { error, value } = schema.validate(dataToValidate);
    
    if (error) {
      // Create validation error
      const validationError = new WebCallError(
        error.details[0].message,
        WebCallErrorType.VALIDATION,
        400,
        error.details
      );
      
      return next(validationError);
    }
    
    // Update request with validated data
    if (req.params && Object.keys(req.params).length > 0) {
      for (const key of Object.keys(req.params)) {
        if (value[key] !== undefined) {
          req.params[key] = value[key];
        }
      }
    }
    
    if (req.query && Object.keys(req.query).length > 0) {
      for (const key of Object.keys(req.query)) {
        if (value[key] !== undefined) {
          (req.query as any)[key] = value[key];
        }
      }
    }
    
    if (req.body && Object.keys(req.body).length > 0) {
      for (const key of Object.keys(req.body)) {
        if (value[key] !== undefined) {
          req.body[key] = value[key];
        }
      }
    }
    
    next();
  };
};
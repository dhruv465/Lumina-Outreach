/**
 * Validation Middleware
 * 
 * This middleware validates request data according to defined schemas,
 * ensuring that requests contain the required data in the correct format.
 */

import { Request, Response, NextFunction } from 'express';
import { logger, getErrorMessage } from '../index';

interface ValidationSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  message?: string;
  min?: number;
  max?: number;
  enum?: any[];
  items?: ValidationSchema;
  properties?: {
    [key: string]: ValidationSchema;
  };
}

interface ValidationOptions {
  body?: {
    [key: string]: ValidationSchema;
  };
  query?: {
    [key: string]: ValidationSchema;
  };
  params?: {
    [key: string]: ValidationSchema;
  };
}

/**
 * Validate request data
 */
export const validateRequest = (options: ValidationOptions) => {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const errors: string[] = [];
      
      // Validate body
      if (options.body) {
        errors.push(...validateObject(req.body, options.body, 'body'));
      }
      
      // Validate query
      if (options.query) {
        errors.push(...validateObject(req.query, options.query, 'query'));
      }
      
      // Validate params
      if (options.params) {
        errors.push(...validateObject(req.params, options.params, 'params'));
      }
      
      // Return errors if any
      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          errors
        });
      }
      
      next();
    } catch (error) {
      logger.error(`Validation error: ${getErrorMessage(error)}`);
      
      return res.status(500).json({
        success: false,
        error: 'Validation failed'
      });
    }
  };
};

/**
 * Validate an object against a schema
 */
function validateObject(
  obj: any,
  schema: { [key: string]: ValidationSchema },
  prefix: string
): string[] {
  const errors: string[] = [];
  
  // Check each field in the schema
  for (const [key, validation] of Object.entries(schema)) {
    const value = obj?.[key];
    const path = `${prefix}.${key}`;
    
    // Check required fields
    if (validation.required && (value === undefined || value === null || value === '')) {
      errors.push(validation.message || `${path} is required`);
      continue;
    }
    
    // Skip validation if value is not provided and not required
    if (value === undefined || value === null) {
      continue;
    }
    
    // Validate type
    if (!validateType(value, validation.type)) {
      errors.push(`${path} must be a ${validation.type}`);
      continue;
    }
    
    // Validate min/max for strings and arrays
    if ((validation.type === 'string' || validation.type === 'array') && typeof value.length === 'number') {
      if (validation.min !== undefined && value.length < validation.min) {
        errors.push(`${path} must have at least ${validation.min} ${validation.type === 'string' ? 'characters' : 'items'}`);
      }
      
      if (validation.max !== undefined && value.length > validation.max) {
        errors.push(`${path} must have at most ${validation.max} ${validation.type === 'string' ? 'characters' : 'items'}`);
      }
    }
    
    // Validate min/max for numbers
    if (validation.type === 'number') {
      if (validation.min !== undefined && value < validation.min) {
        errors.push(`${path} must be at least ${validation.min}`);
      }
      
      if (validation.max !== undefined && value > validation.max) {
        errors.push(`${path} must be at most ${validation.max}`);
      }
    }
    
    // Validate enum
    if (validation.enum && !validation.enum.includes(value)) {
      errors.push(`${path} must be one of: ${validation.enum.join(', ')}`);
    }
    
    // Validate array items
    if (validation.type === 'array' && validation.items && Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const itemErrors = validateValue(value[i], validation.items, `${path}[${i}]`);
        errors.push(...itemErrors);
      }
    }
    
    // Validate object properties
    if (validation.type === 'object' && validation.properties && typeof value === 'object') {
      errors.push(...validateObject(value, validation.properties, path));
    }
  }
  
  return errors;
}

/**
 * Validate a single value
 */
function validateValue(
  value: any,
  validation: ValidationSchema,
  path: string
): string[] {
  const errors: string[] = [];
  
  // Check type
  if (!validateType(value, validation.type)) {
    errors.push(`${path} must be a ${validation.type}`);
    return errors;
  }
  
  // Validate min/max for strings and arrays
  if ((validation.type === 'string' || validation.type === 'array') && typeof value.length === 'number') {
    if (validation.min !== undefined && value.length < validation.min) {
      errors.push(`${path} must have at least ${validation.min} ${validation.type === 'string' ? 'characters' : 'items'}`);
    }
    
    if (validation.max !== undefined && value.length > validation.max) {
      errors.push(`${path} must have at most ${validation.max} ${validation.type === 'string' ? 'characters' : 'items'}`);
    }
  }
  
  // Validate min/max for numbers
  if (validation.type === 'number') {
    if (validation.min !== undefined && value < validation.min) {
      errors.push(`${path} must be at least ${validation.min}`);
    }
    
    if (validation.max !== undefined && value > validation.max) {
      errors.push(`${path} must be at most ${validation.max}`);
    }
  }
  
  // Validate enum
  if (validation.enum && !validation.enum.includes(value)) {
    errors.push(`${path} must be one of: ${validation.enum.join(', ')}`);
  }
  
  // Validate array items
  if (validation.type === 'array' && validation.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const itemErrors = validateValue(value[i], validation.items, `${path}[${i}]`);
      errors.push(...itemErrors);
    }
  }
  
  // Validate object properties
  if (validation.type === 'object' && validation.properties && typeof value === 'object') {
    errors.push(...validateObject(value, validation.properties, path));
  }
  
  return errors;
}

/**
 * Validate the type of a value
 */
function validateType(value: any, type: string): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return typeof value === 'object' && !Array.isArray(value) && value !== null;
    default:
      return true;
  }
}
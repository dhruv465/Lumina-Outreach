import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import { authenticate, authorize } from '../../../middleware/authMiddleware';
import { webCallRateLimit } from '../../../middleware/rateLimitMiddleware';
import { webCallErrorHandler, WebCallError, WebCallErrorType } from '../../../middleware/webCallErrorHandler';
import { validateWebCallRequest } from '../../../middleware/validationMiddleware';
import User from '../../../models/User';

// Mock dependencies
vi.mock('../../../models/User', () => ({
  default: {
    findById: vi.fn()
  }
}));

vi.mock('../../../utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}));

vi.mock('rate-limiter-flexible', () => ({
  RateLimiterMemory: vi.fn().mockImplementation(() => ({
    consume: vi.fn().mockImplementation((key, points) => {
      if (key === 'ip_blocked') {
        return Promise.reject({ msBeforeNext: 10000 });
      }
      return Promise.resolve();
    }),
    delete: vi.fn().mockResolvedValue(true)
  }))
}));

vi.mock('jsonwebtoken', () => ({
  sign: vi.fn().mockReturnValue('test-token'),
  verify: vi.fn().mockImplementation((token) => {
    if (token === 'valid-token') {
      return { userId: 'test-user-id', role: 'user' };
    } else if (token === 'admin-token') {
      return { userId: 'admin-user-id', role: 'admin' };
    } else {
      throw new Error('Invalid token');
    }
  })
}));

describe('WebCall Security', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let nextFunction: vi.Mock;
  
  beforeEach(() => {
    mockRequest = {
      headers: {},
      body: {},
      params: {},
      query: {},
      ip: '127.0.0.1',
      path: '/api/webcall/test',
      method: 'GET',
      connection: {
        remoteAddress: '127.0.0.1'
      }
    };
    
    mockResponse = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis()
    };
    
    nextFunction = vi.fn();
    
    // Reset mocks
    vi.clearAllMocks();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });
  
  describe('Authentication Middleware', () => {
    it('should authenticate valid token', async () => {
      // Setup mock request with valid token
      mockRequest.headers = {
        authorization: 'Bearer valid-token'
      };
      
      // Mock user
      (User.findById as vi.Mock).mockResolvedValueOnce({
        _id: 'test-user-id',
        role: 'user'
      });
      
      // Call middleware
      await authenticate(mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify next was called
      expect(nextFunction).toHaveBeenCalled();
      
      // Verify user was added to request
      expect((mockRequest as any).user).toBeDefined();
      expect((mockRequest as any).user._id).toBe('test-user-id');
    });
    
    it('should reject missing token', async () => {
      // Call middleware
      await authenticate(mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Authentication required'
      }));
      
      // Verify next was not called
      expect(nextFunction).not.toHaveBeenCalled();
    });
    
    it('should reject invalid token', async () => {
      // Setup mock request with invalid token
      mockRequest.headers = {
        authorization: 'Bearer invalid-token'
      };
      
      // Call middleware
      await authenticate(mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Authentication failed'
      }));
      
      // Verify next was not called
      expect(nextFunction).not.toHaveBeenCalled();
    });
    
    it('should reject if user not found', async () => {
      // Setup mock request with valid token
      mockRequest.headers = {
        authorization: 'Bearer valid-token'
      };
      
      // Mock user not found
      (User.findById as vi.Mock).mockResolvedValueOnce(null);
      
      // Call middleware
      await authenticate(mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(401);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Authentication failed',
        message: 'User not found'
      }));
      
      // Verify next was not called
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });
  
  describe('Authorization Middleware', () => {
    it('should authorize user with correct role', () => {
      // Setup mock request with user
      (mockRequest as any).user = {
        _id: 'test-user-id',
        role: 'admin'
      };
      
      // Create middleware
      const middleware = authorize(['admin', 'superuser']);
      
      // Call middleware
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify next was called
      expect(nextFunction).toHaveBeenCalled();
    });
    
    it('should reject user with incorrect role', () => {
      // Setup mock request with user
      (mockRequest as any).user = {
        _id: 'test-user-id',
        role: 'user'
      };
      
      // Create middleware
      const middleware = authorize(['admin']);
      
      // Call middleware
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Authorization failed'
      }));
      
      // Verify next was not called
      expect(nextFunction).not.toHaveBeenCalled();
    });
    
    it('should reject if user not in request', () => {
      // Create middleware
      const middleware = authorize(['admin']);
      
      // Call middleware
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(403);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Authorization failed'
      }));
      
      // Verify next was not called
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });
  
  describe('Rate Limiting Middleware', () => {
    it('should allow request within rate limit', async () => {
      // Call middleware
      await webCallRateLimit(mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify next was called
      expect(nextFunction).toHaveBeenCalled();
    });
    
    it('should block request exceeding rate limit', async () => {
      // Setup mock request with blocked IP
      mockRequest.ip = 'blocked';
      
      // Call middleware
      await webCallRateLimit(mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(429);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'Too many requests'
      }));
      
      // Verify next was not called
      expect(nextFunction).not.toHaveBeenCalled();
    });
  });
  
  describe('Validation Middleware', () => {
    it('should validate valid request', () => {
      // Setup mock request
      mockRequest.body = {
        campaignId: 'test-campaign-id'
      };
      
      // Create middleware
      const middleware = validateWebCallRequest('initialize');
      
      // Call middleware
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify next was called
      expect(nextFunction).toHaveBeenCalled();
    });
    
    it('should reject invalid request', () => {
      // Setup mock request with missing required field
      mockRequest.body = {};
      
      // Create middleware
      const middleware = validateWebCallRequest('initialize');
      
      // Call middleware
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify next was called with error
      expect(nextFunction).toHaveBeenCalledWith(expect.any(WebCallError));
      
      const error = nextFunction.mock.calls[0][0];
      expect(error.type).toBe(WebCallErrorType.VALIDATION);
      expect(error.statusCode).toBe(400);
    });
    
    it('should validate path parameters', () => {
      // Setup mock request
      mockRequest.params = {
        testId: '507f1f77bcf86cd799439011' // Valid MongoDB ObjectId
      };
      
      // Create middleware
      const middleware = validateWebCallRequest('getTest');
      
      // Call middleware
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify next was called
      expect(nextFunction).toHaveBeenCalled();
    });
    
    it('should reject invalid path parameters', () => {
      // Setup mock request with invalid ObjectId
      mockRequest.params = {
        testId: 'invalid-id'
      };
      
      // Create middleware
      const middleware = validateWebCallRequest('getTest');
      
      // Call middleware
      middleware(mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify next was called with error
      expect(nextFunction).toHaveBeenCalledWith(expect.any(WebCallError));
      
      const error = nextFunction.mock.calls[0][0];
      expect(error.type).toBe(WebCallErrorType.VALIDATION);
      expect(error.statusCode).toBe(400);
    });
  });
  
  describe('Error Handler Middleware', () => {
    it('should handle WebCallError', () => {
      // Create error
      const error = new WebCallError(
        'Test error',
        WebCallErrorType.VALIDATION,
        400,
        { field: 'test' }
      );
      
      // Call middleware
      webCallErrorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: WebCallErrorType.VALIDATION,
        message: 'Test error',
        details: { field: 'test' }
      }));
    });
    
    it('should handle generic error', () => {
      // Create error
      const error = new Error('Generic error');
      
      // Call middleware
      webCallErrorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: WebCallErrorType.INTERNAL,
        message: 'An unexpected error occurred'
      }));
    });
    
    it('should handle validation error', () => {
      // Create error
      const error = new Error('Validation error');
      error.name = 'ValidationError';
      
      // Call middleware
      webCallErrorHandler(error, mockRequest as Request, mockResponse as Response, nextFunction);
      
      // Verify response
      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith(expect.objectContaining({
        error: WebCallErrorType.VALIDATION,
        message: 'Validation error'
      }));
    });
  });
});
import { 
  DeepgramValidationService,
  initializeDeepgramValidationService
} from '../deepgramValidationService';
import { ModelCompatibilityService } from '../modelCompatibilityService';

// Mock dependencies
jest.mock('../modelCompatibilityService');
jest.mock('../../models/Configuration');
jest.mock('../../utils/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn()
  },
  getErrorMessage: jest.fn((error) => error.message || 'Unknown error')
}));

describe('DeepgramValidationService Integration', () => {
  let service: DeepgramValidationService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = initializeDeepgramValidationService();
  });

  it('should initialize and provide basic functionality', async () => {
    expect(service).toBeDefined();
    expect(typeof service.initialize).toBe('function');
    expect(typeof service.validateModelAccess).toBe('function');
    expect(typeof service.detectAccountTier).toBe('function');
    expect(typeof service.validateConfiguration).toBe('function');
    expect(typeof service.getOptimalModel).toBe('function');
    expect(typeof service.batchValidateModels).toBe('function');
    expect(typeof service.clearCache).toBe('function');
    expect(typeof service.getCacheStats).toBe('function');
  });

  it('should return cache statistics', () => {
    const stats = service.getCacheStats();
    expect(stats).toHaveProperty('validationCache');
    expect(stats).toHaveProperty('accountTierCache');
    expect(typeof stats.validationCache).toBe('number');
    expect(typeof stats.accountTierCache).toBe('number');
  });

  it('should clear cache without errors', () => {
    expect(() => service.clearCache()).not.toThrow();
  });
});
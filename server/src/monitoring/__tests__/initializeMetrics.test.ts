/**
 * initializeMetrics.test.ts
 * Tests for metrics initialization
 */

import { initializeMonitoringSystems, stopMonitoringSystems } from '../initializeMetrics';
import { DeepgramModelMetrics } from '../deepgramModelMetrics';
import { performanceMonitor } from '../performance_metrics';

// Mock dependencies
jest.mock('../deepgramModelMetrics');
jest.mock('../performance_metrics');
jest.mock('../../utils/logger');

describe('Metrics Initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should initialize and start all monitoring systems', () => {
    // Mock the getInstance method
    const mockDeepgramMetricsInstance = {
      start: jest.fn(),
      onReportGenerated: jest.fn(),
      onModelFallback: jest.fn(),
      onAccountTierDetection: jest.fn()
    };
    
    (DeepgramModelMetrics.getInstance as jest.Mock).mockReturnValue(mockDeepgramMetricsInstance);
    (performanceMonitor.start as jest.Mock) = jest.fn();

    // Call the function
    initializeMonitoringSystems();

    // Verify that all monitoring systems were started
    expect(DeepgramModelMetrics.getInstance).toHaveBeenCalled();
    expect(mockDeepgramMetricsInstance.start).toHaveBeenCalled();
    expect(performanceMonitor.start).toHaveBeenCalled();
    
    // Verify that event listeners were set up
    expect(mockDeepgramMetricsInstance.onReportGenerated).toHaveBeenCalled();
    expect(mockDeepgramMetricsInstance.onModelFallback).toHaveBeenCalled();
    expect(mockDeepgramMetricsInstance.onAccountTierDetection).toHaveBeenCalled();
  });

  it('should stop all monitoring systems', () => {
    // Mock the getInstance method
    const mockDeepgramMetricsInstance = {
      stop: jest.fn()
    };
    
    (DeepgramModelMetrics.getInstance as jest.Mock).mockReturnValue(mockDeepgramMetricsInstance);
    (performanceMonitor.stop as jest.Mock) = jest.fn();

    // Call the function
    stopMonitoringSystems();

    // Verify that all monitoring systems were stopped
    expect(DeepgramModelMetrics.getInstance).toHaveBeenCalled();
    expect(mockDeepgramMetricsInstance.stop).toHaveBeenCalled();
    expect(performanceMonitor.stop).toHaveBeenCalled();
  });

  it('should handle errors during initialization', () => {
    // Mock the getInstance method to throw an error
    (DeepgramModelMetrics.getInstance as jest.Mock).mockImplementation(() => {
      throw new Error('Test error');
    });

    // Call the function - it should not throw
    expect(() => initializeMonitoringSystems()).not.toThrow();
  });
});
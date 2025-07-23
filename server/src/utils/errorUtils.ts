/**
 * Utility functions for error handling
 */

/**
 * Extract error message from various error types
 * @param error Any error object
 * @returns A string representation of the error
 */
export const getErrorMessage = (error: any): string => {
  if (error instanceof Error) {
    return error.message;
  }
  
  if (typeof error === 'string') {
    return error;
  }
  
  try {
    return JSON.stringify(error);
  } catch (e) {
    return String(error);
  }
};

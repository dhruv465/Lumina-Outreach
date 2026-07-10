import logger from './logger';

export class TimeoutService {
  /**
   * Execute a promise with a timeout
   * @param promise The promise to execute
   * @param timeoutMs Timeout in milliseconds
   * @param errorMessage Custom error message
   */
  static async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    errorMessage: string = 'Operation timed out'
  ): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;

    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(errorMessage));
      }, timeoutMs);
    });

    try {
      const result = await Promise.race([promise, timeoutPromise]);
      clearTimeout(timeoutHandle!);
      return result;
    } catch (error) {
      clearTimeout(timeoutHandle!);
      throw error;
    }
  }

  /**
   * Adaptive timeout based on message length
   * Human speech is roughly 150 words per minute.
   */
  static getAdaptiveTimeout(textLength: number): number {
    const baseTimeout = 2000; // 2 seconds minimum
    const perCharBonus = 10; // 10ms per character
    return Math.min(baseTimeout + (textLength * perCharBonus), 15000); // Max 15 seconds
  }
}

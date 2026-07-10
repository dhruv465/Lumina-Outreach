import logger from './logger';

export class PIIService {
  /**
   * Sanitize text by masking potential PII (Personally Identifiable Information)
   * This is a basic implementation and can be enhanced with regex or NLP models.
   */
  static sanitize(text: string): string {
    if (!text) return text;

    let sanitized = text;

    // Mask Emails
    sanitized = sanitized.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');

    // Mask Phone Numbers (basic formats)
    sanitized = sanitized.replace(/(\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, '[PHONE]');

    // Mask Potential Credit Card Numbers (13-16 digits)
    sanitized = sanitized.replace(/\b(?:\d[ -]*?){13,16}\b/g, '[CARD]');

    // Mask SSN (basic format)
    sanitized = sanitized.replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]');

    return sanitized;
  }

  /**
   * Sanitize an entire object (useful for logging parameters)
   */
  static sanitizeObject(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;

    const sanitized: any = Array.isArray(obj) ? [] : {};

    for (const key in obj) {
      const value = obj[key];
      
      // Keys that almost certainly contain PII
      const piiKeys = ['email', 'phone', 'address', 'name', 'card', 'ssn', 'password'];
      
      if (piiKeys.some(pii => key.toLowerCase().includes(pii))) {
        sanitized[key] = '[MASKED]';
      } else if (typeof value === 'object') {
        sanitized[key] = this.sanitizeObject(value);
      } else if (typeof value === 'string') {
        sanitized[key] = this.sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }
}

import { toE164 } from '../types';

describe('toE164', () => {
  it('adds the default country code to a bare 10-digit number', () => {
    expect(toE164('9579813746', '+91')).toBe('+919579813746');
  });

  it('leaves an already-E.164 number intact', () => {
    expect(toE164('+919579813746', '+91')).toBe('+919579813746');
  });

  it('strips formatting from a + number', () => {
    expect(toE164('+91 95798 13746', '+91')).toBe('+919579813746');
  });

  it('drops a national trunk-prefix 0 on an 11-digit number', () => {
    expect(toE164('09579813746', '+91')).toBe('+919579813746');
  });

  it('adds + to a number that already includes the country code digits', () => {
    expect(toE164('919579813746', '+91')).toBe('+919579813746');
  });

  it('returns empty string for empty/whitespace input', () => {
    expect(toE164('', '+91')).toBe('');
    expect(toE164('   ', '+91')).toBe('');
  });
});

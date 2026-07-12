describe('secretCipher', () => {
  beforeEach(() => {
    process.env.CONFIG_ENCRYPTION_KEY = 'test-master-key-for-jest';
    jest.resetModules();
  });

  const load = () => require('../secretCipher') as typeof import('../secretCipher');

  it('round-trips a secret', () => {
    const { encryptSecret, decryptSecret, isEncrypted } = load();
    const stored = encryptSecret('sk-live-abcdef123456');
    expect(stored).toMatch(/^enc:v1:/);
    expect(isEncrypted(stored)).toBe(true);
    expect(decryptSecret(stored)).toBe('sk-live-abcdef123456');
  });

  it('returns empty for empty input', () => {
    const { encryptSecret, decryptSecret } = load();
    expect(encryptSecret('')).toBe('');
    expect(decryptSecret('')).toBe('');
  });

  it('passes plaintext through decrypt (migration tolerance)', () => {
    const { decryptSecret, isEncrypted } = load();
    expect(decryptSecret('sk-plaintext-legacy')).toBe('sk-plaintext-legacy');
    expect(isEncrypted('sk-plaintext-legacy')).toBe(false);
  });

  it('throws on tampered ciphertext', () => {
    const { encryptSecret, decryptSecret } = load();
    const stored = encryptSecret('secret');
    const parts = stored.split(':');
    parts[4] = Buffer.from('tampered!').toString('base64');
    expect(() => decryptSecret(parts.join(':'))).toThrow();
  });

  it('throws when CONFIG_ENCRYPTION_KEY missing', () => {
    delete process.env.CONFIG_ENCRYPTION_KEY;
    const { encryptSecret } = load();
    expect(() => encryptSecret('x')).toThrow(/CONFIG_ENCRYPTION_KEY/);
  });

  it('masks secrets', () => {
    const { maskSecret } = load();
    expect(maskSecret('')).toBe('');
    expect(maskSecret('abc')).toBe('••••');
    expect(maskSecret('sk-live-abcdef123456')).toBe('••••3456');
  });
});

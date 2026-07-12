import mongoose from 'mongoose';

process.env.CONFIG_ENCRYPTION_KEY = 'test-master-key-for-jest';
import Configuration, { encryptConfigKeys } from '../Configuration';
import { isEncrypted, decryptSecret } from '../../utils/secretCipher';

const ownerId = new mongoose.Types.ObjectId();

describe('Configuration model', () => {
  it('requires ownerId', () => {
    const doc = new Configuration({});
    const err = doc.validateSync();
    expect(err?.errors.ownerId).toBeDefined();
  });

  it('validates with only ownerId and sane defaults', () => {
    const doc = new Configuration({ ownerId });
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.deepgramConfig.sttModel).toBe('nova-3');
    expect(doc.deepgramConfig.ttsVoice).toBe('aura-2-thalia-en');
    expect(doc.llmConfig.defaultProvider).toBe('openai');
    expect(doc.llmConfig.defaultModel).toBe('gpt-4.1');
    expect(doc.llmConfig.providers.map((p: any) => p.name)).toEqual([
      'openai', 'anthropic', 'google',
    ]);
  });

  it('rejects unknown llm provider names', () => {
    const doc = new Configuration({
      ownerId,
      llmConfig: { providers: [{ name: 'azure', apiKey: '' }] },
    });
    expect(doc.validateSync()).toBeDefined();
  });

  it('has no legacy provider fields', () => {
    const doc = new Configuration({ ownerId });
    expect((doc as any).twilioConfig).toBeUndefined();
    expect((doc as any).elevenLabsConfig).toBeUndefined();
    expect((doc as any).ttsConfig).toBeUndefined();
  });

  it('encrypts keys in pre-save hook and masks them in getMaskedConfig', async () => {
    const doc = new Configuration({ ownerId });
    doc.deepgramConfig.apiKey = 'dg-key-123456';
    doc.llmConfig.providers[0].apiKey = 'sk-openai-abcdef';
    // The pre('save') hook invocation shim proved brittle against the
    // installed mongoose version (8.18.1's Document already defines
    // $__handleSave, so the shim's guard short-circuited and never ran
    // the hook). Per the brief's fallback, call the extracted
    // encryptConfigKeys(doc) helper directly instead of the DB-less hook shim.
    encryptConfigKeys(doc);
    expect(isEncrypted(doc.deepgramConfig.apiKey)).toBe(true);
    expect(decryptSecret(doc.deepgramConfig.apiKey)).toBe('dg-key-123456');
    expect(isEncrypted(doc.llmConfig.providers[0].apiKey)).toBe(true);

    const masked = doc.getMaskedConfig!();
    expect(masked.deepgramConfig.apiKey).toBe('••••3456');
    expect(masked.llmConfig.providers[0].apiKey).toBe('••••cdef');
    expect(masked.llmConfig.providers[1].apiKey).toBe('');
  });
});

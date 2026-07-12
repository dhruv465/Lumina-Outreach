// Migrate the legacy singleton Configuration doc to per-user BYOK.
// Usage: node --env-file=.env scripts/migrate-config-to-byok.js [--dry-run]
//        node scripts/migrate-config-to-byok.js --model-probe
// Requires MONGODB_URI and CONFIG_ENCRYPTION_KEY.
const crypto = require('crypto');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry-run');
const PREFIX = 'enc:v1:';
const CANONICAL_PROVIDERS = ['openai', 'anthropic', 'google'];
// Keep these values aligned with configurationController.ts LLM_OPTIONS.
// The first model for each provider is the app's provider-specific default.
const PROVIDER_MODELS = {
  openai: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
  anthropic: ['claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1'],
  google: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'],
};

function masterKey() {
  const raw = process.env.CONFIG_ENCRYPTION_KEY;
  if (!raw) throw new Error('CONFIG_ENCRYPTION_KEY is required');
  return crypto.createHash('sha256').update(raw).digest();
}

function encryptSecret(plain) {
  if (!plain) return '';
  const value = String(plain);
  if (value.startsWith(PREFIX)) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', masterKey(), iv);
  const ct = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `${PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`;
}

function canonicalProvider(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return CANONICAL_PROVIDERS.includes(normalized) ? normalized : null;
}

function normalizeProviderModel(providerValue, modelValue) {
  const provider = canonicalProvider(providerValue) || 'openai';
  const models = PROVIDER_MODELS[provider];
  const candidate = typeof modelValue === 'string' ? modelValue.trim() : '';
  return {
    provider,
    model: models.includes(candidate) ? candidate : models[0],
  };
}

function runModelProbe() {
  const cases = [
    ['openai preserves valid model', 'OpenAI', 'gpt-4o-mini', 'openai', 'gpt-4o-mini'],
    ['anthropic preserves valid model', 'Anthropic', 'claude-haiku-4-5', 'anthropic', 'claude-haiku-4-5'],
    ['google preserves valid model', 'Google', 'gemini-2.5-pro', 'google', 'gemini-2.5-pro'],
    ['anthropic rejects mismatched model', 'Anthropic', 'gpt-4.1', 'anthropic', 'claude-sonnet-4-5'],
    ['google fills missing model', 'Google', '', 'google', 'gemini-2.5-flash'],
    ['unsupported provider falls back', 'unsupported', 'not-a-model', 'openai', 'gpt-4.1'],
  ];
  for (const [label, provider, model, expectedProvider, expectedModel] of cases) {
    const actual = normalizeProviderModel(provider, model);
    if (actual.provider !== expectedProvider || actual.model !== expectedModel) {
      throw new Error(`Model compatibility probe failed: ${label}`);
    }
  }
  console.log(`Model compatibility probe passed (${cases.length} cases).`);
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  masterKey();

  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    const users = db.collection('users');
    const configs = db.collection('configurations');
    const campaigns = db.collection('campaigns');

    const admin = await users.findOne(
      { role: 'admin' },
      { sort: { createdAt: 1, _id: 1 } },
    );
    if (!admin) throw new Error('No admin user found to own the legacy configuration');

    const legacy = await configs.findOne({ ownerId: { $exists: false } });
    if (!legacy) {
      console.log('No legacy (ownerless) configuration found — nothing to migrate.');
    } else {
      const set = { ownerId: admin._id };
      const unset = {
        twilioConfig: '',
        elevenLabsConfig: '',
        ttsConfig: '',
        ragConfig: '',
        voiceAIConfig: '',
      };

      const oldDgKey = legacy.deepgramConfig?.apiKey || '';
      set.deepgramConfig = {
        apiKey: encryptSecret(oldDgKey),
        sttModel: 'nova-3',
        ttsVoice: 'aura-2-thalia-en',
        isEnabled: true,
        status: 'unverified',
        lastVerified: null,
        lastError: '',
      };

      const oldProviders = Array.isArray(legacy.llmConfig?.providers)
        ? legacy.llmConfig.providers
        : [];
      set['llmConfig.providers'] = CANONICAL_PROVIDERS.map((name) => {
        const old = oldProviders.find((provider) => canonicalProvider(provider?.name) === name);
        return {
          name,
          apiKey: encryptSecret(old?.apiKey || ''),
          status: 'unverified',
          lastVerified: null,
          lastError: '',
        };
      });
      const normalizedLlm = normalizeProviderModel(
        legacy.llmConfig?.defaultProvider,
        legacy.llmConfig?.defaultModel,
      );
      set['llmConfig.defaultProvider'] = normalizedLlm.provider;
      set['llmConfig.defaultModel'] = normalizedLlm.model;

      console.log(
        `Assigning legacy config ${legacy._id} to admin ${admin.email || admin._id}`
          + (DRY ? ' (dry-run, not modified)' : ''),
      );
      if (!DRY) {
        await configs.updateOne({ _id: legacy._id }, { $set: set, $unset: unset });
      }
    }

    const staleVoiceFilter = {
      'voiceConfiguration.voiceId': { $exists: true, $ne: '', $not: /^aura-/ },
    };
    const stale = await campaigns.countDocuments(staleVoiceFilter);
    console.log(
      `${stale} campaign(s) with legacy voice ids ${DRY ? '(dry-run, not modified)' : '— clearing'}`,
    );
    if (!DRY && stale > 0) {
      await campaigns.updateMany(
        staleVoiceFilter,
        { $set: { 'voiceConfiguration.voiceId': '' } },
      );
    }

    console.log('Done.');
  } finally {
    await mongoose.disconnect();
  }
}

if (process.argv.includes('--model-probe')) {
  try {
    runModelProbe();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

// Migrate the legacy singleton Configuration doc to per-user BYOK.
// Usage: node --env-file=.env scripts/migrate-config-to-byok.js [--dry-run]
//        node scripts/migrate-config-to-byok.js --model-probe
//        CONFIG_ENCRYPTION_KEY=test-key node scripts/migrate-config-to-byok.js --migration-probe
// Requires MONGODB_URI and CONFIG_ENCRYPTION_KEY for a real/dry-run migration.
const crypto = require('crypto');
const mongoose = require('mongoose');

const DRY = process.argv.includes('--dry-run');
const PREFIX = 'enc:v1:';
const CANONICAL_PROVIDERS = ['openai', 'anthropic', 'google'];
const LEGACY_PROVIDER_SECTIONS = {
  twilioConfig: '',
  elevenLabsConfig: '',
  ttsConfig: '',
  ragConfig: '',
  voiceAIConfig: '',
};
const RETAINED_SECTIONS = [
  'generalSettings',
  'complianceSettings',
  'webhookConfig',
  'errorMessages',
  'closingScripts',
  'intentDetection',
  'callResponses',
];
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

function providerMap(providers) {
  const result = new Map();
  for (const provider of Array.isArray(providers) ? providers : []) {
    const name = canonicalProvider(provider?.name);
    if (name && !result.has(name)) result.set(name, provider);
  }
  return result;
}

function migratedProvider(name, legacyProvider) {
  return {
    name,
    apiKey: encryptSecret(legacyProvider?.apiKey || ''),
    status: 'unverified',
    lastVerified: null,
    lastError: '',
  };
}

function mergeProviders(existingProviders, legacyProviders) {
  const existing = providerMap(existingProviders);
  const legacy = providerMap(legacyProviders);
  return CANONICAL_PROVIDERS.map((name) => {
    const current = existing.get(name);
    const old = legacy.get(name);
    if (!current) return migratedProvider(name, old);
    if (current.apiKey || !old?.apiKey) return { ...current, name };
    return {
      ...current,
      name,
      apiKey: encryptSecret(old.apiKey),
      status: 'unverified',
      lastVerified: null,
      lastError: '',
    };
  });
}

function migratedDeepgram(legacyDeepgram) {
  return {
    apiKey: encryptSecret(legacyDeepgram?.apiKey || ''),
    sttModel: legacyDeepgram?.sttModel || legacyDeepgram?.primaryModel || 'nova-3',
    ttsVoice: legacyDeepgram?.ttsVoice || 'aura-2-thalia-en',
    isEnabled: legacyDeepgram?.isEnabled !== false,
    status: 'unverified',
    lastVerified: null,
    lastError: '',
  };
}

function mergeDeepgram(existingDeepgram, legacyDeepgram) {
  if (!existingDeepgram) return migratedDeepgram(legacyDeepgram);
  if (existingDeepgram.apiKey || !legacyDeepgram?.apiKey) return { ...existingDeepgram };
  return {
    ...existingDeepgram,
    apiKey: encryptSecret(legacyDeepgram.apiKey),
    status: 'unverified',
    lastVerified: null,
    lastError: '',
  };
}

function isPlainObject(value) {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function cloneRetained(value) {
  if (Array.isArray(value)) return value.map(cloneRetained);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, cloneRetained(nested)]),
  );
}

function deepMergeRetained(base, owner) {
  if (owner === undefined) return cloneRetained(base);
  if (Array.isArray(owner)) return cloneRetained(owner);
  if (!isPlainObject(owner)) return cloneRetained(owner);

  const baseObject = isPlainObject(base) ? base : {};
  const merged = {};
  for (const key of new Set([...Object.keys(baseObject), ...Object.keys(owner)])) {
    merged[key] = deepMergeRetained(baseObject[key], owner[key]);
  }
  return merged;
}

function mergeRetainedSections(legacy, ownerConfig) {
  const untouchedLazyConfig = ownerConfig.updatedBy == null;
  const retained = {};
  for (const section of RETAINED_SECTIONS) {
    const legacyValue = legacy[section];
    const ownerValue = ownerConfig[section];
    const value = untouchedLazyConfig
      ? cloneRetained(legacyValue !== undefined ? legacyValue : ownerValue)
      : deepMergeRetained(legacyValue, ownerValue);
    if (value !== undefined) retained[section] = value;
  }
  return retained;
}

function buildMigrationPlan(legacy, ownerConfig, ownerId) {
  const source = ownerConfig || legacy;
  const sourceLlm = source.llmConfig || {};
  const normalizedLlm = normalizeProviderModel(
    sourceLlm.defaultProvider,
    sourceLlm.defaultModel,
  );
  const deepgramConfig = ownerConfig
    ? mergeDeepgram(ownerConfig.deepgramConfig, legacy.deepgramConfig)
    : migratedDeepgram(legacy.deepgramConfig);
  const providers = mergeProviders(
    ownerConfig?.llmConfig?.providers,
    legacy.llmConfig?.providers,
  );
  const llmConfig = {
    ...sourceLlm,
    providers,
    defaultProvider: normalizedLlm.provider,
    defaultModel: normalizedLlm.model,
  };

  if (ownerConfig) {
    const retained = mergeRetainedSections(legacy, ownerConfig);
    return {
      kind: 'merge',
      targetId: ownerConfig._id,
      legacyId: legacy._id,
      filter: { _id: ownerConfig._id, ownerId },
      update: {
        $set: { deepgramConfig, llmConfig, ...retained },
        $unset: LEGACY_PROVIDER_SECTIONS,
      },
    };
  }

  return {
    kind: 'assign',
    targetId: legacy._id,
    legacyId: legacy._id,
    filter: { _id: legacy._id, ownerId: { $exists: false } },
    update: {
      $set: { ownerId, deepgramConfig, llmConfig },
      $unset: LEGACY_PROVIDER_SECTIONS,
    },
  };
}

function assertSingleLegacy(legacyDocs) {
  if (legacyDocs.length > 1) {
    throw new Error(
      `Found ${legacyDocs.length} ownerless configurations; aborting before writes. Resolve duplicates manually.`,
    );
  }
  return legacyDocs[0] || null;
}

async function executeMigrationPlan(configs, plan, dryRun) {
  const description = plan.kind === 'merge'
    ? `Merging legacy config ${plan.legacyId} into existing admin config ${plan.targetId}, then deleting legacy`
    : `Assigning legacy config ${plan.legacyId} to the admin owner`;
  console.log(`${description}${dryRun ? ' (dry-run, no writes)' : ''}.`);
  if (dryRun) return;

  const result = await configs.updateOne(plan.filter, plan.update);
  if (result.matchedCount !== 1) {
    throw new Error('Configuration changed during migration; no legacy document was deleted');
  }
  if (plan.kind === 'merge') {
    const deleted = await configs.deleteOne({
      _id: plan.legacyId,
      ownerId: { $exists: false },
    });
    if (deleted.deletedCount !== 1) {
      throw new Error('Admin configuration was merged, but the legacy document changed before deletion; rerun safely');
    }
  }
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

async function runMigrationProbe() {
  masterKey();
  const assert = (condition, message) => {
    if (!condition) throw new Error(`Migration probe failed: ${message}`);
  };
  const encryptedExisting = encryptSecret('admin-deepgram-key');
  const encryptedLegacyGoogle = encryptSecret('legacy-google-key');
  const legacy = {
    _id: 'legacy-id',
    deepgramConfig: { apiKey: 'legacy-deepgram-key' },
    llmConfig: {
      defaultProvider: 'Google',
      defaultModel: 'gemini-2.5-pro',
      providers: [
        { name: 'OpenAI', apiKey: 'legacy-openai-key' },
        { name: 'Google', apiKey: encryptedLegacyGoogle },
        { name: 'legacy-only', apiKey: 'ignored' },
      ],
    },
  };
  const owner = {
    _id: 'owner-config-id',
    ownerId: 'admin-id',
    deepgramConfig: {
      apiKey: encryptedExisting,
      sttModel: 'nova-3',
      ttsVoice: 'aura-luna-en',
      status: 'verified',
      lastVerified: new Date('2026-01-01T00:00:00.000Z'),
      lastError: '',
    },
    llmConfig: {
      defaultProvider: 'anthropic',
      defaultModel: 'claude-haiku-4-5',
      temperature: 0.2,
      providers: [
        { name: 'openai', apiKey: '', status: 'failed', lastError: 'old' },
        { name: 'anthropic', apiKey: 'enc:v1:preserved', status: 'verified', lastError: '' },
      ],
    },
  };

  const plan = buildMigrationPlan(legacy, owner, 'admin-id');
  assert(plan.kind === 'merge', 'collision must create a merge plan');
  assert(plan.update.$set.deepgramConfig.apiKey === encryptedExisting, 'existing key must win');
  assert(plan.update.$set.deepgramConfig.status === 'verified', 'existing verified status must survive');
  const mergedProviders = providerMap(plan.update.$set.llmConfig.providers);
  assert(mergedProviders.get('openai').apiKey.startsWith(PREFIX), 'empty admin slot must be filled encrypted');
  assert(mergedProviders.get('openai').status === 'unverified', 'migrated key must require verification');
  assert(mergedProviders.get('anthropic').apiKey === 'enc:v1:preserved', 'existing provider must win');
  assert(mergedProviders.get('anthropic').status === 'verified', 'existing provider status must survive');
  assert(mergedProviders.get('google').apiKey === encryptedLegacyGoogle, 'encrypted key must not be re-encrypted');
  assert(mergedProviders.size === 3, 'legacy-only providers must be removed');
  assert(plan.update.$set.llmConfig.defaultProvider === 'anthropic', 'newer admin defaults must win');

  const retainedLegacy = {
    ...legacy,
    generalSettings: {
      defaultLanguage: 'Hindi',
      supportedLanguages: ['Hindi', 'English'],
      workingHours: { start: '08:00', end: '17:00', timeZone: 'Asia/Kolkata' },
    },
    complianceSettings: {
      recordCalls: false,
      maxCallsPerLeadPerDay: 2,
      callBlackoutPeriod: { start: '20:00', end: '09:00' },
    },
    webhookConfig: { secret: 'legacy-webhook-secret', status: 'verified' },
    errorMessages: { unavailable: 'Legacy unavailable message' },
    closingScripts: { success: 'Legacy close' },
    intentDetection: { closingPhrases: ['legacy close'], objectionPhrases: ['legacy objection'] },
    callResponses: { greeting: 'Legacy greeting' },
  };
  const untouchedOwner = {
    ...owner,
    generalSettings: {
      defaultLanguage: 'English',
      supportedLanguages: ['English', 'Hindi'],
      workingHours: { start: '09:00', end: '18:00', timeZone: 'Asia/Kolkata' },
    },
    complianceSettings: { recordCalls: true, maxCallsPerLeadPerDay: 1 },
    webhookConfig: { secret: '' },
  };
  const untouchedPlan = buildMigrationPlan(retainedLegacy, untouchedOwner, 'admin-id');
  assert(
    untouchedPlan.update.$set.complianceSettings.recordCalls === false,
    'untouched lazy owner must keep legacy recording consent',
  );
  assert(
    untouchedPlan.update.$set.webhookConfig.secret === 'legacy-webhook-secret',
    'untouched lazy owner must keep the legacy webhook secret',
  );
  assert(
    untouchedPlan.update.$set.generalSettings.defaultLanguage === 'Hindi',
    'untouched lazy owner must keep legacy general settings',
  );
  assert(
    untouchedPlan.update.$set.callResponses.greeting === 'Legacy greeting',
    'untouched lazy owner must keep every retained legacy section',
  );

  const editedOwner = {
    ...untouchedOwner,
    updatedBy: 'admin-id',
    generalSettings: {
      defaultLanguage: 'English',
      supportedLanguages: ['English'],
      workingHours: { start: '10:00' },
    },
    complianceSettings: { recordCalls: true },
    webhookConfig: { secret: 'owner-webhook-secret' },
  };
  const editedPlan = buildMigrationPlan(retainedLegacy, editedOwner, 'admin-id');
  assert(
    editedPlan.update.$set.generalSettings.defaultLanguage === 'English',
    'edited owner scalar must win',
  );
  assert(
    editedPlan.update.$set.generalSettings.supportedLanguages.join(',') === 'English',
    'edited owner array must win',
  );
  assert(
    editedPlan.update.$set.generalSettings.workingHours.start === '10:00',
    'edited owner nested value must win',
  );
  assert(
    editedPlan.update.$set.generalSettings.workingHours.end === '17:00',
    'missing edited-owner nested value must survive from legacy',
  );
  assert(
    editedPlan.update.$set.complianceSettings.recordCalls === true
      && editedPlan.update.$set.complianceSettings.maxCallsPerLeadPerDay === 2,
    'edited owner consent must win while missing legacy compliance values survive',
  );
  assert(
    editedPlan.update.$set.webhookConfig.secret === 'owner-webhook-secret'
      && editedPlan.update.$set.webhookConfig.status === 'verified',
    'edited owner webhook value must win while missing legacy fields survive',
  );

  const writes = [];
  const fakeConfigs = {
    updateOne: async (...args) => { writes.push(['updateOne', ...args]); return { matchedCount: 1 }; },
    deleteOne: async (...args) => { writes.push(['deleteOne', ...args]); return { deletedCount: 1 }; },
  };
  await executeMigrationPlan(fakeConfigs, plan, true);
  assert(writes.length === 0, 'dry-run must not write');
  await executeMigrationPlan(fakeConfigs, plan, false);
  assert(
    writes.map(([operation]) => operation).join(',') === 'updateOne,deleteOne',
    'collision writes must update the owner before deleting the legacy document',
  );

  const afterPartial = {
    ...owner,
    deepgramConfig: plan.update.$set.deepgramConfig,
    llmConfig: plan.update.$set.llmConfig,
  };
  const rerun = buildMigrationPlan(legacy, afterPartial, 'admin-id');
  const rerunProviders = providerMap(rerun.update.$set.llmConfig.providers);
  assert(
    rerunProviders.get('openai').apiKey === mergedProviders.get('openai').apiKey,
    'partial rerun must not double-encrypt a filled provider key',
  );
  assert(
    rerun.update.$set.deepgramConfig.apiKey === encryptedExisting,
    'partial rerun must preserve the admin Deepgram key',
  );

  let duplicateAbort = false;
  try {
    assertSingleLegacy([{ _id: 'one' }, { _id: 'two' }]);
  } catch (error) {
    duplicateAbort = /aborting before writes/.test(error.message);
  }
  assert(duplicateAbort, 'multiple ownerless configs must abort preflight');
  console.log('Migration collision probe passed (preserve, fill, encryption, dry-run, rerun, duplicate preflight).');
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

    // Preflight with two rows so duplicate legacy singletons abort before any write.
    const legacyDocs = await configs.find({ ownerId: { $exists: false } }).limit(2).toArray();
    const legacy = assertSingleLegacy(legacyDocs);
    if (!legacy) {
      console.log('No legacy (ownerless) configuration found — nothing to migrate.');
    } else {
      const ownerConfig = await configs.findOne({ ownerId: admin._id });
      const plan = buildMigrationPlan(legacy, ownerConfig, admin._id);
      // Deliberately avoid transactions: deployments may use standalone MongoDB.
      // The merge/update followed by conditional legacy deletion is ordered and idempotent;
      // a crash between those writes is safe to rerun without re-encrypting keys.
      await executeMigrationPlan(configs, plan, DRY);
    }

    const staleVoiceFilter = {
      'voiceConfiguration.voiceId': { $exists: true, $ne: '', $not: /^aura-/ },
    };
    const stale = await campaigns.countDocuments(staleVoiceFilter);
    console.log(
      `${stale} campaign(s) with legacy voice ids ${DRY ? '(dry-run, no writes)' : '— clearing'}`,
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
} else if (process.argv.includes('--migration-probe')) {
  runMigrationProbe().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
} else {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

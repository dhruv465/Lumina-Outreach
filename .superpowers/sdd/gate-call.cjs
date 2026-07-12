// Gate-call dispatcher for barge-in verification.
// Usage: node --env-file=server/.env .superpowers/sdd/gate-call.cjs [phoneNumber] [callId] [transferTo] [--owner email|id] [--config-probe]
// Reads MongoDB, encryption, and LiveKit creds from server/.env. Dispatches
// lumina-outbound with a long opening so there's a clear agent turn to talk over.
const { AgentDispatchClient } = require('/Users/dhruvsmac/Desktop/Project Lumina/server/node_modules/livekit-server-sdk');
const mongoose = require('/Users/dhruvsmac/Desktop/Project Lumina/server/node_modules/mongoose');
const crypto = require('crypto');

const phone = process.argv[2] || '+919579813746';
const callId = process.argv[3] || `gate-smoke-5`;
const transferTo = process.argv[4] || ''; // 2nd number for transfer_call test
const agentName = process.env.LIVEKIT_AGENT_NAME || 'lumina-outbound';
const ownerFlag = process.argv.indexOf('--owner');
const ownerSelector = ownerFlag > -1 ? process.argv[ownerFlag + 1] : null;
const configProbe = process.argv.includes('--config-probe');
const PREFIX = 'enc:v1:';

if (ownerFlag > -1 && (!ownerSelector || ownerSelector.startsWith('--'))) {
  console.error('--owner requires an email address or user id');
  process.exit(1);
}

function maskSecret(value) {
  if (!value || value.length <= 6) return '••••';
  return `••••${value.slice(-4)}`;
}

async function loadProviderConfig() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI is required');
  const encryptionKey = process.env.CONFIG_ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error('CONFIG_ENCRYPTION_KEY is required');
  const key = crypto.createHash('sha256').update(encryptionKey).digest();
  const decrypt = (value, label) => {
    if (!value) return '';
    if (typeof value !== 'string') throw new Error('stored provider key has an invalid format');
    if (!value.startsWith(PREFIX)) return value;
    const [iv, tag, ct] = value.slice(PREFIX.length).split(':');
    if (!iv || !tag || !ct) throw new Error('stored provider key has an invalid encrypted format');
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([
        decipher.update(Buffer.from(ct, 'base64')),
        decipher.final(),
      ]).toString('utf8');
    } catch {
      throw new Error(`unable to decrypt ${label}; check CONFIG_ENCRYPTION_KEY`);
    }
  };

  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    let owner;
    if (!ownerSelector) {
      owner = await db.collection('users').findOne(
        { role: 'admin' },
        { sort: { createdAt: 1, _id: 1 } },
      );
    } else if (/^[a-f\d]{24}$/i.test(ownerSelector)) {
      owner = await db.collection('users').findOne({
        _id: new mongoose.Types.ObjectId(ownerSelector),
      });
    } else {
      owner = await db.collection('users').findOne({ email: ownerSelector });
    }
    if (!owner) {
      throw new Error(
        ownerSelector ? `owner not found: ${ownerSelector}` : 'owner not found (no admin user)',
      );
    }

    const cfg = await db.collection('configurations').findOne({ ownerId: owner._id });
    if (!cfg) throw new Error(`no configuration for owner ${owner.email || owner._id}`);

    const deepgram = cfg.deepgramConfig;
    if (!deepgram?.apiKey || deepgram.status !== 'verified') {
      throw new Error('Deepgram key missing or unverified for selected owner');
    }
    const providerName = String(cfg.llmConfig?.defaultProvider || '').toLowerCase();
    const llm = cfg.llmConfig?.providers?.find(
      (provider) => String(provider.name || '').toLowerCase() === providerName,
    );
    if (!llm?.apiKey || llm.status !== 'verified') {
      throw new Error(`LLM key for ${providerName || 'default provider'} missing or unverified for selected owner`);
    }

    const dgKey = decrypt(deepgram.apiKey, 'Deepgram key');
    const llmKey = decrypt(llm.apiKey, `${providerName} LLM key`);
    if (!dgKey.trim()) throw new Error('Deepgram key decrypts to an empty value');
    if (!llmKey.trim()) throw new Error(`LLM key for ${providerName} decrypts to an empty value`);

    return {
      stt: { api_key: dgKey, model: deepgram.sttModel },
      llm: {
        provider: providerName,
        api_key: llmKey,
        model: cfg.llmConfig.defaultModel,
        temperature: cfg.llmConfig.temperature,
      },
      tts: { api_key: dgKey, voice: deepgram.ttsVoice },
    };
  } finally {
    await mongoose.disconnect();
  }
}

const meta = {
  call_id: callId,
  lead_id: 'gate',
  campaign_id: 'gate',
  phone_number: phone,
  lead_name: 'Dhruv',
  transfer_to: transferTo,
  voice_id: '',
  opening_message:
    'Hi Dhruv, this is Alex calling from Lumina. I am reaching out because we help teams automate their routine outbound phone calls with a natural sounding voice assistant, so your reps can spend their time on the conversations that actually move deals forward. I would love to take a couple of minutes to walk you through how it works and see whether it could be a fit for the way your team runs its outreach today. Does that sound alright?',
  script:
    'Introduce Lumina, a voice AI platform for automated outbound calling. Explain benefits: saves rep time, natural voice, handles routine calls. Ask qualifying questions. Handle objections with empathy. Keep talking naturally and at length unless the person interrupts.',
};

(async () => {
  meta.provider_config = await loadProviderConfig();
  if (configProbe) {
    console.log(
      `provider config ok: llm=${meta.provider_config.llm.provider} deepgram=${maskSecret(meta.provider_config.stt.api_key)}`,
    );
    return;
  }

  const url = process.env.LIVEKIT_URL;
  const key = process.env.LIVEKIT_API_KEY;
  const secret = process.env.LIVEKIT_API_SECRET;
  if (!url || !key || !secret) {
    console.error('Missing LIVEKIT_URL/API_KEY/API_SECRET in env. Run with: node --env-file=server/.env');
    process.exit(1);
  }
  const client = new AgentDispatchClient(url, key, secret);
  const room = `call-${callId}-${Math.random().toString(36).slice(2, 8)}`;
  const d = await client.createDispatch(room, agentName, { metadata: JSON.stringify(meta) });
  console.log(`dispatched: room=${room} agent=${agentName} phone=${phone} call_id=${callId} dispatch=${d.id}`);
})().catch((e) => {
  console.error('dispatch failed:', e.message);
  process.exit(1);
});

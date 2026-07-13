import { FastifyReply, FastifyRequest } from 'fastify';
import Configuration from '../models/Configuration';
import { verifyDeepgramKey, verifyLlmKey } from '../services/providerVerificationService';
import { decryptSecret } from '../utils/secretCipher';
import logger, { getErrorMessage } from '../utils/logger';

export const LLM_OPTIONS = {
  providers: [
    {
      name: 'OpenAI', value: 'openai',
      models: [
        { name: 'GPT-4.1', value: 'gpt-4.1' },
        { name: 'GPT-4.1 mini', value: 'gpt-4.1-mini' },
        { name: 'GPT-4o', value: 'gpt-4o' },
        { name: 'GPT-4o mini', value: 'gpt-4o-mini' },
      ],
    },
    {
      name: 'Anthropic', value: 'anthropic',
      models: [
        { name: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5' },
        { name: 'Claude Haiku 4.5', value: 'claude-haiku-4-5' },
        { name: 'Claude Opus 4.1', value: 'claude-opus-4-1' },
      ],
    },
    {
      name: 'Google', value: 'google',
      models: [
        { name: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
        { name: 'Gemini 2.5 Pro', value: 'gemini-2.5-pro' },
        { name: 'Gemini 2.0 Flash', value: 'gemini-2.0-flash' },
      ],
    },
  ],
};

export const AURA_VOICES = [
  'aura-2-thalia-en', 'aura-asteria-en', 'aura-luna-en', 'aura-stella-en',
  'aura-athena-en', 'aura-hera-en', 'aura-orion-en', 'aura-arcas-en',
  'aura-perseus-en', 'aura-angus-en', 'aura-orpheus-en', 'aura-helios-en',
  'aura-zeus-en',
].map((v) => ({ value: v, name: v.replace(/^aura(-2)?-/, '').replace(/-en$/, '') }));

const MASK_PREFIX = '••••';
const VERIFICATION_CONFLICT = 'API key changed during verification. Verify the current key again.';
const isPlaceholder = (value: unknown) => (
  typeof value !== 'string' || value === '' || value.startsWith(MASK_PREFIX)
);

async function configFor(req: FastifyRequest) {
  const ownerId = (req.user as any)._id;
  const doc = await Configuration.findOneAndUpdate(
    { ownerId },
    { $setOnInsert: { ownerId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  if (!doc) throw new Error('Failed to load per-user configuration');
  return doc;
}

export const getSystemConfiguration = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const doc = await configFor(req);
    res.status(200).send(doc.getMaskedConfig());
  } catch (error) {
    logger.error(`getSystemConfiguration failed: ${getErrorMessage(error)}`);
    res.status(500).send({ message: 'Failed to load configuration' });
  }
};

export const updateSystemConfiguration = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const body = (req.body ?? {}) as any;
    const doc = await configFor(req);

    if (body.deepgramConfig) {
      const deepgram = body.deepgramConfig;
      if (!isPlaceholder(deepgram.apiKey)) {
        doc.deepgramConfig.apiKey = deepgram.apiKey;
        doc.deepgramConfig.status = 'unverified';
        doc.deepgramConfig.lastVerified = null;
        doc.deepgramConfig.lastError = '';
      }
      if (typeof deepgram.sttModel === 'string' && deepgram.sttModel) {
        doc.deepgramConfig.sttModel = deepgram.sttModel;
      }
      if (typeof deepgram.ttsVoice === 'string' && deepgram.ttsVoice) {
        doc.deepgramConfig.ttsVoice = deepgram.ttsVoice;
      }
      if (typeof deepgram.isEnabled === 'boolean') {
        doc.deepgramConfig.isEnabled = deepgram.isEnabled;
      }
    }

    if (body.llmConfig) {
      for (const incoming of body.llmConfig.providers ?? []) {
        const target = doc.llmConfig.providers.find((provider) => provider.name === incoming.name);
        if (!target) continue;
        if (!isPlaceholder(incoming.apiKey)) {
          target.apiKey = incoming.apiKey;
          target.status = 'unverified';
          target.lastVerified = null;
          target.lastError = '';
        }
      }
      const { defaultProvider, defaultModel, temperature, maxTokens } = body.llmConfig;
      if (defaultProvider) doc.llmConfig.defaultProvider = defaultProvider;
      if (defaultModel) doc.llmConfig.defaultModel = defaultModel;
      if (typeof temperature === 'number') doc.llmConfig.temperature = temperature;
      if (typeof maxTokens === 'number') doc.llmConfig.maxTokens = maxTokens;
    }

    if (body.generalSettings) Object.assign(doc.generalSettings, body.generalSettings);
    if (body.complianceSettings) Object.assign(doc.complianceSettings, body.complianceSettings);
    if (body.webhookConfig && !isPlaceholder(body.webhookConfig.secret)) {
      doc.webhookConfig.secret = body.webhookConfig.secret;
    }
    doc.updatedBy = (req.user as any)._id;

    await doc.save();
    res.status(200).send(doc.getMaskedConfig());
  } catch (error) {
    logger.error(`updateSystemConfiguration failed: ${getErrorMessage(error)}`);
    res.status(500).send({ message: 'Failed to save configuration' });
  }
};

export const verifyDeepgram = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const doc = await configFor(req);
    const ownerId = (req.user as any)._id;
    const storedKey = doc.deepgramConfig.apiKey || '';
    const result = await verifyDeepgramKey(decryptSecret(storedKey));
    const status = result.ok ? 'verified' : 'failed';
    const set: Record<string, unknown> = {
      'deepgramConfig.status': status,
      'deepgramConfig.lastError': result.ok ? '' : result.error || 'verification failed',
    };
    if (result.ok) set['deepgramConfig.lastVerified'] = new Date();

    const update = await Configuration.updateOne(
      { ownerId, 'deepgramConfig.apiKey': storedKey },
      { $set: set },
    );
    if (update.matchedCount !== 1) {
      res.status(409).send({ message: VERIFICATION_CONFLICT });
      return;
    }
    res.status(200).send({
      ok: result.ok,
      status,
      error: result.error,
    });
  } catch (error) {
    logger.error(`verifyDeepgram failed: ${getErrorMessage(error)}`);
    res.status(500).send({ message: 'Failed to verify Deepgram key' });
  }
};

export const verifyLlm = async (req: FastifyRequest, res: FastifyReply) => {
  try {
    const { provider } = (req.body ?? {}) as { provider?: string };
    const doc = await configFor(req);
    const target = doc.llmConfig.providers.find((entry) => entry.name === provider);
    if (!target) {
      res.status(400).send({ message: `Unknown provider: ${provider}` });
      return;
    }
    const ownerId = (req.user as any)._id;
    const storedKey = target.apiKey || '';
    const result = await verifyLlmKey(target.name, decryptSecret(storedKey));
    const status = result.ok ? 'verified' : 'failed';
    const set: Record<string, unknown> = {
      'llmConfig.providers.$[provider].status': status,
      'llmConfig.providers.$[provider].lastError': result.ok
        ? ''
        : result.error || 'verification failed',
    };
    if (result.ok) {
      set['llmConfig.providers.$[provider].lastVerified'] = new Date();
      set['llmConfig.providers.$[provider].availableModels'] = result.models ?? [];
    }

    const update = await Configuration.updateOne(
      {
        ownerId,
        'llmConfig.providers': { $elemMatch: { name: target.name, apiKey: storedKey } },
      },
      { $set: set },
      { arrayFilters: [{ 'provider.name': target.name, 'provider.apiKey': storedKey }] },
    );
    if (update.matchedCount !== 1) {
      res.status(409).send({ message: VERIFICATION_CONFLICT });
      return;
    }
    res.status(200).send({
      ok: result.ok,
      status,
      error: result.error,
      models: result.models ?? [],
    });
  } catch (error) {
    logger.error(`verifyLlm failed: ${getErrorMessage(error)}`);
    res.status(500).send({ message: 'Failed to verify LLM key' });
  }
};

export const getLLMOptions = async (_req: FastifyRequest, res: FastifyReply) => {
  res.status(200).send(LLM_OPTIONS);
};

export const getVoiceOptions = async (_req: FastifyRequest, res: FastifyReply) => {
  res.status(200).send({ voices: AURA_VOICES });
};

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
const isPlaceholder = (value: unknown) => (
  typeof value !== 'string' || value === '' || value.startsWith(MASK_PREFIX)
);

async function configFor(req: FastifyRequest) {
  const ownerId = (req.user as any)._id;
  return (await Configuration.findOne({ ownerId })) ?? (await Configuration.create({ ownerId }));
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
    const result = await verifyDeepgramKey(decryptSecret(doc.deepgramConfig.apiKey || ''));
    doc.deepgramConfig.status = result.ok ? 'verified' : 'failed';
    doc.deepgramConfig.lastVerified = result.ok ? new Date() : doc.deepgramConfig.lastVerified;
    doc.deepgramConfig.lastError = result.ok ? '' : result.error || 'verification failed';
    await doc.save();
    res.status(200).send({
      ok: result.ok,
      status: doc.deepgramConfig.status,
      error: result.error,
    });
  } catch (error) {
    res.status(500).send({ message: getErrorMessage(error) });
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
    const result = await verifyLlmKey(target.name, decryptSecret(target.apiKey || ''));
    target.status = result.ok ? 'verified' : 'failed';
    target.lastVerified = result.ok ? new Date() : target.lastVerified;
    target.lastError = result.ok ? '' : result.error || 'verification failed';
    await doc.save();
    res.status(200).send({ ok: result.ok, status: target.status, error: result.error });
  } catch (error) {
    res.status(500).send({ message: getErrorMessage(error) });
  }
};

export const getLLMOptions = async (_req: FastifyRequest, res: FastifyReply) => {
  res.status(200).send(LLM_OPTIONS);
};

export const getVoiceOptions = async (_req: FastifyRequest, res: FastifyReply) => {
  res.status(200).send({ voices: AURA_VOICES });
};

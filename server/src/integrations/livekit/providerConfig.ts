import Configuration from '../../models/Configuration';
import { decryptSecret } from '../../utils/secretCipher';
import { ProviderConfigPayload } from './types';

const GUIDANCE = 'Configure and verify your API keys in Configuration before calling.';

export class ProviderConfigError extends Error {
  constructor(message = GUIDANCE) {
    super(message);
    this.name = 'ProviderConfigError';
  }
}

export async function buildProviderConfig(ownerId: string): Promise<ProviderConfigPayload> {
  const cfg = await Configuration.findOne({ ownerId });
  if (!cfg) throw new ProviderConfigError();

  const dg = cfg.deepgramConfig;
  if (!dg?.apiKey || dg.status !== 'verified') {
    throw new ProviderConfigError(`Deepgram key missing or unverified. ${GUIDANCE}`);
  }

  const providerName = cfg.llmConfig.defaultProvider;
  const llm = cfg.llmConfig.providers.find((provider) => provider.name === providerName);
  if (!llm?.apiKey || llm.status !== 'verified') {
    throw new ProviderConfigError(`LLM key for ${providerName} missing or unverified. ${GUIDANCE}`);
  }

  const dgKey = decryptSecret(dg.apiKey);
  return {
    stt: { api_key: dgKey, model: dg.sttModel },
    llm: {
      provider: providerName,
      api_key: decryptSecret(llm.apiKey),
      model: cfg.llmConfig.defaultModel,
      temperature: cfg.llmConfig.temperature,
    },
    tts: { api_key: dgKey, voice: dg.ttsVoice },
  };
}

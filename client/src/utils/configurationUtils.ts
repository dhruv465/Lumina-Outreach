/**
 * Utility functions for checking whether the current user's BYO providers are
 * ready for LiveKit calling.
 */

import { configApi } from "../services/configApi";

interface ProviderConfiguration {
  name?: string;
  apiKey?: string;
  status?: string;
}

interface ConfigurationResponse {
  deepgramConfig?: {
    apiKey?: string;
    status?: string;
  };
  llmConfig?: {
    defaultProvider?: string;
    providers?: ProviderConfiguration[];
  };
}

export interface ConfigurationStatus {
  telephonyConfigured: boolean;
  voiceConfigured: boolean;
  llmConfigured: boolean;
  asrConfigured: boolean;
  overallConfigured: boolean;
  details: {
    deepgramApiKey: boolean;
    llmApiKey: boolean;
  };
}

export async function checkTelephonyConfiguration(): Promise<ConfigurationStatus> {
  try {
    const config =
      (await configApi.getConfiguration()) as ConfigurationResponse;
    const deepgramConfigured = Boolean(
      config.deepgramConfig?.apiKey &&
        config.deepgramConfig.status === "verified",
    );
    const defaultProvider = config.llmConfig?.defaultProvider;
    const llmProvider = config.llmConfig?.providers?.find(
      (provider) => provider.name === defaultProvider,
    );
    const llmConfigured = Boolean(
      llmProvider?.apiKey && llmProvider.status === "verified",
    );
    const overallConfigured = deepgramConfigured && llmConfigured;

    return {
      telephonyConfigured: overallConfigured,
      voiceConfigured: deepgramConfigured,
      llmConfigured,
      asrConfigured: deepgramConfigured,
      overallConfigured,
      details: {
        deepgramApiKey: deepgramConfigured,
        llmApiKey: llmConfigured,
      },
    };
  } catch (error) {
    console.error("Error checking configuration:", error);
    return {
      telephonyConfigured: false,
      voiceConfigured: false,
      llmConfigured: false,
      asrConfigured: false,
      overallConfigured: false,
      details: {
        deepgramApiKey: false,
        llmApiKey: false,
      },
    };
  }
}

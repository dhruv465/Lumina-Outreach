import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/useToast";
import { configApi } from "@/services/configApi";
import {
  AlertTriangle,
  CheckCircle,
  Info,
  MessageSquare,
  Mic,
  Save,
  Settings,
  Volume2,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type VerifyStatus = "unverified" | "verified" | "failed";
type ProviderName = "openai" | "anthropic" | "google";

interface DeepgramState {
  apiKey: string;
  sttModel: string;
  ttsVoice: string;
  status: VerifyStatus;
}

interface LlmProviderState {
  apiKey: string;
  status: VerifyStatus;
}

interface GeneralSettings {
  defaultSystemPrompt: string;
  maxCallDuration: number;
  callRetryAttempts: number;
  callRetryDelay: number;
  defaultTimeZone: string;
  [key: string]: unknown;
}

interface ConfigurationState {
  deepgram: DeepgramState;
  providers: Record<ProviderName, LlmProviderState>;
  defaultProvider: ProviderName;
  defaultModel: string;
  temperature: number;
  generalSettings: GeneralSettings;
  complianceSettings: Record<string, unknown>;
  webhookSecret: string;
}

interface ServerProviderConfig {
  name?: string;
  apiKey?: string;
  status?: string;
}

interface ServerConfiguration {
  deepgramConfig?: {
    apiKey?: string;
    sttModel?: string;
    ttsVoice?: string;
    status?: string;
  };
  llmConfig?: {
    providers?: ServerProviderConfig[];
    defaultProvider?: string;
    defaultModel?: string;
    temperature?: number;
  };
  generalSettings?: Partial<GeneralSettings>;
  complianceSettings?: Record<string, unknown>;
  webhookConfig?: {
    secret?: string;
  };
}

interface LlmModelOption {
  name: string;
  value: string;
}

interface LlmProviderOption {
  name: string;
  value: ProviderName;
  models: LlmModelOption[];
}

interface LlmOptionsResponse {
  providers?: Array<{
    name?: string;
    value?: string;
    models?: Array<{ name?: string; value?: string }>;
  }>;
}

interface VoiceOption {
  name: string;
  value: string;
}

interface VoiceOptionsResponse {
  voices?: Array<{ name?: string; value?: string }>;
}

interface VerifyResponse {
  ok?: boolean;
  status?: string;
  error?: string;
}

interface ApiErrorLike {
  message?: string;
  response?: {
    data?: {
      message?: string;
      error?: string;
    };
  };
}

const PROVIDERS: Array<{ value: ProviderName; label: string }> = [
  { value: "openai", label: "OpenAI" },
  { value: "anthropic", label: "Anthropic" },
  { value: "google", label: "Google" },
];

const MASK_PREFIX = "••••";

const DEFAULT_SYSTEM_PROMPT = `You are a professional sales representative making cold calls. Be polite, respectful, and helpful. Your goal is to:
1. Introduce yourself and your company
2. Understand the prospect's needs
3. Present relevant solutions
4. Schedule a follow-up if there's interest
5. Respect their time and decisions

Keep the conversation natural and engaging. If they're not interested, politely end the call.`;

const INITIAL_STATE: ConfigurationState = {
  deepgram: {
    apiKey: "",
    sttModel: "nova-3",
    ttsVoice: "aura-2-thalia-en",
    status: "unverified",
  },
  providers: {
    openai: { apiKey: "", status: "unverified" },
    anthropic: { apiKey: "", status: "unverified" },
    google: { apiKey: "", status: "unverified" },
  },
  defaultProvider: "openai",
  defaultModel: "gpt-4.1",
  temperature: 0.7,
  generalSettings: {
    defaultSystemPrompt: DEFAULT_SYSTEM_PROMPT,
    maxCallDuration: 300,
    callRetryAttempts: 3,
    callRetryDelay: 60,
    defaultTimeZone: "America/New_York",
  },
  complianceSettings: {},
  webhookSecret: "",
};

function isProviderName(value: unknown): value is ProviderName {
  return value === "openai" || value === "anthropic" || value === "google";
}

function toVerifyStatus(value: unknown): VerifyStatus {
  if (value === "verified" || value === "failed") return value;
  return "unverified";
}

function isMasked(value: string): boolean {
  return value.startsWith(MASK_PREFIX);
}

function keyForPayload(value: string): string | undefined {
  return value && !isMasked(value) ? value : undefined;
}

function replacementKeyValue(currentValue: string, nextValue: string): string {
  if (!isMasked(currentValue) || nextValue === currentValue) return nextValue;
  if (nextValue.includes(currentValue)) {
    return nextValue.replace(currentValue, "");
  }
  return nextValue.includes("•") ? "" : nextValue;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object") return fallback;
  const apiError = error as ApiErrorLike;
  return (
    apiError.response?.data?.message ||
    apiError.response?.data?.error ||
    apiError.message ||
    fallback
  );
}

function normalizeLlmOptions(response: LlmOptionsResponse): LlmProviderOption[] {
  return (response.providers ?? []).flatMap((provider) => {
    if (!isProviderName(provider.value)) return [];
    return [
      {
        name: provider.name || provider.value,
        value: provider.value,
        models: (provider.models ?? []).flatMap((model) =>
          model.name && model.value
            ? [{ name: model.name, value: model.value }]
            : [],
        ),
      },
    ];
  });
}

function normalizeVoiceOptions(response: VoiceOptionsResponse): VoiceOption[] {
  return (response.voices ?? []).flatMap((voice) =>
    voice.name && voice.value ? [{ name: voice.name, value: voice.value }] : [],
  );
}

function buildProviders(
  serverProviders: ServerProviderConfig[] | undefined,
): Record<ProviderName, LlmProviderState> {
  return PROVIDERS.reduce(
    (providers, provider) => {
      const savedProvider = serverProviders?.find(
        (candidate) => candidate.name === provider.value,
      );
      providers[provider.value] = {
        apiKey: savedProvider?.apiKey || "",
        status: toVerifyStatus(savedProvider?.status),
      };
      return providers;
    },
    {} as Record<ProviderName, LlmProviderState>,
  );
}

function statusLabel(status: VerifyStatus, configured: boolean): string {
  if (status === "verified") return "Connected";
  if (status === "failed") return "Failed";
  return configured ? "Unverified" : "Not Set";
}

function StatusBadge({
  status,
  configured,
}: {
  status: VerifyStatus;
  configured: boolean;
}) {
  const verified = status === "verified";
  return (
    <Badge variant="outline" className="gap-1">
      {verified ? (
        <CheckCircle className="h-3 w-3" />
      ) : (
        <AlertTriangle
          className={`h-3 w-3 ${status === "failed" ? "text-red-500" : "text-yellow-500"}`}
        />
      )}
      {statusLabel(status, configured)}
    </Badge>
  );
}

const Configuration = () => {
  const { toast } = useToast();
  const toastRef = useRef(toast);
  const [config, setConfig] = useState<ConfigurationState>(INITIAL_STATE);
  const [llmOptions, setLlmOptions] = useState<LlmProviderOption[]>([]);
  const [llmOptionsAvailable, setLlmOptionsAvailable] = useState(false);
  const [voiceOptions, setVoiceOptions] = useState<VoiceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [verifyingDeepgram, setVerifyingDeepgram] = useState(false);
  const [verifyingProvider, setVerifyingProvider] =
    useState<ProviderName | null>(null);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
    let cancelled = false;

    const loadConfiguration = async () => {
      try {
        setLoading(true);
        setLoadError(null);
        const configurationResult = await configApi.getConfiguration();
        const [llmOptionsResult, voiceOptionsResult] = await Promise.allSettled([
          configApi.getLLMOptions(),
          configApi.getVoiceOptions(),
        ]);

        if (cancelled) return;

        const serverConfig = configurationResult as ServerConfiguration;
        const normalizedLlmOptions = normalizeLlmOptions(
          llmOptionsResult.status === "fulfilled"
            ? (llmOptionsResult.value as LlmOptionsResponse)
            : {},
        );
        const normalizedVoiceOptions = normalizeVoiceOptions(
          voiceOptionsResult.status === "fulfilled"
            ? (voiceOptionsResult.value as VoiceOptionsResponse)
            : {},
        );
        const defaultProvider = isProviderName(
          serverConfig.llmConfig?.defaultProvider,
        )
          ? serverConfig.llmConfig.defaultProvider
          : "openai";
        const providerModels =
          normalizedLlmOptions.find(
            (provider) => provider.value === defaultProvider,
          )?.models ?? [];
        const savedModel = serverConfig.llmConfig?.defaultModel;
        const defaultModel = savedModel || providerModels[0]?.value || "";

        setLlmOptions(normalizedLlmOptions);
        setLlmOptionsAvailable(normalizedLlmOptions.length > 0);
        setVoiceOptions(normalizedVoiceOptions);
        setConfig({
          deepgram: {
            apiKey: serverConfig.deepgramConfig?.apiKey || "",
            sttModel: serverConfig.deepgramConfig?.sttModel || "nova-3",
            ttsVoice:
              serverConfig.deepgramConfig?.ttsVoice ||
              normalizedVoiceOptions[0]?.value ||
              "aura-2-thalia-en",
            status: toVerifyStatus(serverConfig.deepgramConfig?.status),
          },
          providers: buildProviders(serverConfig.llmConfig?.providers),
          defaultProvider,
          defaultModel,
          temperature:
            typeof serverConfig.llmConfig?.temperature === "number"
              ? serverConfig.llmConfig.temperature
              : 0.7,
          generalSettings: {
            ...INITIAL_STATE.generalSettings,
            ...(serverConfig.generalSettings ?? {}),
          },
          complianceSettings: { ...(serverConfig.complianceSettings ?? {}) },
          webhookSecret: serverConfig.webhookConfig?.secret || "",
        });
      } catch (error) {
        if (!cancelled) {
          const message = getErrorMessage(
            error,
            "Configuration settings could not be loaded.",
          );
          setLoadError(message);
          toastRef.current({
            title: "Unable to load configuration",
            description: message,
            variant: "destructive",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadConfiguration();
    return () => {
      cancelled = true;
    };
  }, [loadAttempt]);

  const modelsForProvider = (provider: ProviderName) =>
    llmOptions.find((option) => option.value === provider)?.models ?? [];

  const updateDeepgram = <Key extends keyof DeepgramState>(
    key: Key,
    value: DeepgramState[Key],
  ) => {
    setConfig((current) => ({
      ...current,
      deepgram: {
        ...current.deepgram,
        [key]: value,
        ...(key === "apiKey" ? { status: "unverified" as const } : {}),
      },
    }));
  };

  const updateProviderKey = (provider: ProviderName, apiKey: string) => {
    setConfig((current) => ({
      ...current,
      providers: {
        ...current.providers,
        [provider]: {
          ...current.providers[provider],
          apiKey,
          status: "unverified",
        },
      },
    }));
  };

  const updateGeneralSetting = <Key extends keyof GeneralSettings>(
    key: Key,
    value: GeneralSettings[Key],
  ) => {
    setConfig((current) => ({
      ...current,
      generalSettings: { ...current.generalSettings, [key]: value },
    }));
  };

  const handleDefaultProviderChange = (value: string) => {
    if (!isProviderName(value)) return;
    setConfig((current) => {
      const models = modelsForProvider(value);
      const currentModelStillApplies = models.some(
        (model) => model.value === current.defaultModel,
      );
      return {
        ...current,
        defaultProvider: value,
        defaultModel: currentModelStillApplies
          ? current.defaultModel
          : models[0]?.value || "",
      };
    });
  };

  const mergeSavedConfiguration = (saved: ServerConfiguration) => {
    setConfig((current) => ({
      ...current,
      deepgram: {
        ...current.deepgram,
        apiKey: saved.deepgramConfig?.apiKey || current.deepgram.apiKey,
        sttModel: saved.deepgramConfig?.sttModel || current.deepgram.sttModel,
        ttsVoice: saved.deepgramConfig?.ttsVoice || current.deepgram.ttsVoice,
        status: toVerifyStatus(
          saved.deepgramConfig?.status ?? current.deepgram.status,
        ),
      },
      providers: PROVIDERS.reduce(
        (providers, provider) => {
          const savedProvider = saved.llmConfig?.providers?.find(
            (candidate) => candidate.name === provider.value,
          );
          providers[provider.value] = savedProvider
            ? {
                apiKey:
                  savedProvider.apiKey || current.providers[provider.value].apiKey,
                status: toVerifyStatus(savedProvider.status),
              }
            : current.providers[provider.value];
          return providers;
        },
        {} as Record<ProviderName, LlmProviderState>,
      ),
      defaultProvider: isProviderName(saved.llmConfig?.defaultProvider)
        ? saved.llmConfig.defaultProvider
        : current.defaultProvider,
      defaultModel: saved.llmConfig?.defaultModel || current.defaultModel,
      temperature:
        typeof saved.llmConfig?.temperature === "number"
          ? saved.llmConfig.temperature
          : current.temperature,
      generalSettings: {
        ...current.generalSettings,
        ...(saved.generalSettings ?? {}),
      },
      complianceSettings: {
        ...current.complianceSettings,
        ...(saved.complianceSettings ?? {}),
      },
      webhookSecret: saved.webhookConfig?.secret || current.webhookSecret,
    }));
  };

  const handleSave = async () => {
    if (verifyingDeepgram || verifyingProvider) return;
    const { maxCallDuration, callRetryAttempts, callRetryDelay } =
      config.generalSettings;
    if (
      !Number.isFinite(maxCallDuration) ||
      !Number.isFinite(callRetryAttempts) ||
      !Number.isFinite(callRetryDelay) ||
      maxCallDuration < 30 ||
      maxCallDuration > 3600 ||
      callRetryAttempts < 0 ||
      callRetryAttempts > 10 ||
      callRetryDelay < 15 ||
      callRetryDelay > 1440
    ) {
      toast({
        title: "Invalid call settings",
        description:
          "Duration must be 30–3600 seconds, retries 0–10, and retry delay 15–1440 seconds.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const deepgramApiKey = keyForPayload(config.deepgram.apiKey);
      const providers = PROVIDERS.map(({ value }) => {
        const apiKey = keyForPayload(config.providers[value].apiKey);
        return {
          name: value,
          ...(apiKey ? { apiKey } : {}),
        };
      });
      const payload = {
        deepgramConfig: {
          ...(deepgramApiKey ? { apiKey: deepgramApiKey } : {}),
          sttModel: config.deepgram.sttModel,
          ttsVoice: config.deepgram.ttsVoice,
        },
        llmConfig: {
          providers,
          defaultProvider: config.defaultProvider,
          defaultModel: config.defaultModel,
          temperature: config.temperature,
        },
        generalSettings: config.generalSettings,
        complianceSettings: config.complianceSettings,
        webhookConfig: {
          ...(keyForPayload(config.webhookSecret)
            ? { secret: keyForPayload(config.webhookSecret) }
            : {}),
        },
      };

      const saved = (await configApi.updateConfiguration(
        payload,
      )) as ServerConfiguration;
      mergeSavedConfiguration(saved);
      toast({
        title: "Configuration Saved",
        description: "Your provider and call settings have been updated.",
      });
    } catch (error) {
      toast({
        title: "Unable to save configuration",
        description: getErrorMessage(
          error,
          "Configuration settings could not be saved.",
        ),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleVerifyDeepgram = async () => {
    if (!config.deepgram.apiKey) {
      toast({
        title: "Deepgram key required",
        description: "Enter and save a Deepgram API key before verifying it.",
        variant: "destructive",
      });
      return;
    }
    if (!isMasked(config.deepgram.apiKey)) {
      toast({
        title: "Save before verifying",
        description: "Save the new Deepgram key, then run verification.",
      });
      return;
    }

    setVerifyingDeepgram(true);
    try {
      const result = (await configApi.verifyDeepgram()) as VerifyResponse;
      const verified = result.ok ?? result.status === "verified";
      const status = toVerifyStatus(
        result.status ?? (verified ? "verified" : "failed"),
      );
      setConfig((current) => ({
        ...current,
        deepgram: { ...current.deepgram, status },
      }));
      toast({
        title: verified ? "Deepgram verified" : "Deepgram verification failed",
        description: verified
          ? "The saved key works for speech recognition and voice synthesis."
          : result.error || "Deepgram rejected the saved key.",
        variant: verified ? "default" : "destructive",
      });
    } catch (error) {
      setConfig((current) => ({
        ...current,
        deepgram: { ...current.deepgram, status: "failed" },
      }));
      toast({
        title: "Deepgram verification failed",
        description: getErrorMessage(error, "Unable to verify the saved key."),
        variant: "destructive",
      });
    } finally {
      setVerifyingDeepgram(false);
    }
  };

  const handleVerifyProvider = async (provider: ProviderName) => {
    const providerConfig = config.providers[provider];
    if (!providerConfig.apiKey) {
      toast({
        title: `${PROVIDERS.find((item) => item.value === provider)?.label} key required`,
        description: "Enter and save an API key before verifying it.",
        variant: "destructive",
      });
      return;
    }
    if (!isMasked(providerConfig.apiKey)) {
      toast({
        title: "Save before verifying",
        description: "Save the new provider key, then run verification.",
      });
      return;
    }

    setVerifyingProvider(provider);
    try {
      const result = (await configApi.verifyLlm(provider)) as VerifyResponse;
      const verified = result.ok ?? result.status === "verified";
      const status = toVerifyStatus(
        result.status ?? (verified ? "verified" : "failed"),
      );
      setConfig((current) => ({
        ...current,
        providers: {
          ...current.providers,
          [provider]: { ...current.providers[provider], status },
        },
      }));
      const label = PROVIDERS.find((item) => item.value === provider)?.label;
      toast({
        title: verified ? `${label} verified` : `${label} verification failed`,
        description: verified
          ? "The saved provider key is ready to use."
          : result.error || `${label} rejected the saved key.`,
        variant: verified ? "default" : "destructive",
      });
    } catch (error) {
      setConfig((current) => ({
        ...current,
        providers: {
          ...current.providers,
          [provider]: { ...current.providers[provider], status: "failed" },
        },
      }));
      toast({
        title: "Provider verification failed",
        description: getErrorMessage(error, "Unable to verify the saved key."),
        variant: "destructive",
      });
    } finally {
      setVerifyingProvider(null);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <Settings className="mx-auto mb-2 h-8 w-8 animate-spin" />
          <p>Loading configuration...</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Configuration unavailable</CardTitle>
          <CardDescription>{loadError}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  const selectedModels = modelsForProvider(config.defaultProvider);
  const selectedProvider = config.providers[config.defaultProvider];

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col space-y-4 sm:flex-row sm:items-center sm:justify-between sm:space-y-0">
        <div className="min-w-0 flex-shrink-0">
          <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">
            Configuration
          </h1>
          <p className="text-sm text-muted-foreground sm:text-base">
            Configure your AI calling system settings
          </p>
        </div>
        <Button
          size="sm"
          onClick={handleSave}
          disabled={saving || verifyingDeepgram || Boolean(verifyingProvider)}
        >
          <Save className={`mr-2 h-4 w-4 ${saving ? "animate-spin" : ""}`} />
          {saving ? "Saving..." : "Save Configuration"}
        </Button>
      </div>

      <fieldset
        disabled={saving || verifyingDeepgram || Boolean(verifyingProvider)}
        className="min-w-0 space-y-4 sm:space-y-6"
      >
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">
                Speech & Voice
              </CardTitle>
              <HoverCard>
                <HoverCardTrigger asChild>
                  <button className="h-5 w-5 text-muted-foreground hover:text-foreground">
                    <Info className="h-4 w-4" />
                  </button>
                </HoverCardTrigger>
                <HoverCardContent className="w-80">
                  <p className="text-sm text-muted-foreground">
                    One Deepgram key powers both real-time transcription and
                    Aura voice synthesis for calls.
                  </p>
                </HoverCardContent>
              </HoverCard>
            </div>
            <Mic className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Deepgram</div>
            <div className="mt-1">
              <StatusBadge
                status={config.deepgram.status}
                configured={Boolean(config.deepgram.apiKey)}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">
                LLM Provider
              </CardTitle>
              <HoverCard>
                <HoverCardTrigger asChild>
                  <button className="h-5 w-5 text-muted-foreground hover:text-foreground">
                    <Info className="h-4 w-4" />
                  </button>
                </HoverCardTrigger>
                <HoverCardContent className="w-80">
                  <p className="text-sm text-muted-foreground">
                    The selected language model powers conversation reasoning
                    and response generation during calls.
                  </p>
                </HoverCardContent>
              </HoverCard>
            </div>
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">
              {config.defaultProvider}
            </div>
            <div className="mt-1">
              <StatusBadge
                status={selectedProvider.status}
                configured={Boolean(selectedProvider.apiKey)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Volume2 className="h-5 w-5" />
            Deepgram Speech & Voice
          </CardTitle>
          <CardDescription>
            Configure one Deepgram key for speech-to-text and text-to-speech
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2 lg:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <Label htmlFor="deepgramApiKey">Deepgram API Key</Label>
                <StatusBadge
                  status={config.deepgram.status}
                  configured={Boolean(config.deepgram.apiKey)}
                />
              </div>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  id="deepgramApiKey"
                  type="password"
                  value={config.deepgram.apiKey}
                  onChange={(event) =>
                    updateDeepgram(
                      "apiKey",
                      replacementKeyValue(
                        config.deepgram.apiKey,
                        event.target.value,
                      ),
                    )
                  }
                  onFocus={(event) => {
                    if (isMasked(config.deepgram.apiKey)) {
                      event.currentTarget.select();
                    }
                  }}
                  placeholder="Enter your Deepgram API key"
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleVerifyDeepgram}
                  disabled={verifyingDeepgram}
                >
                  {verifyingDeepgram ? "Verifying..." : "Verify"}
                </Button>
              </div>
              {config.deepgram.apiKey && !isMasked(config.deepgram.apiKey) && (
                <p className="text-xs text-muted-foreground">
                  Save the new key before verifying it.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="deepgramSttModel">STT Model</Label>
              <Select
                value={config.deepgram.sttModel}
                onValueChange={(value) => updateDeepgram("sttModel", value)}
              >
                <SelectTrigger id="deepgramSttModel" className="h-10 w-full rounded-xl">
                  <SelectValue placeholder="Select an STT model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nova-3">Nova-3 (Recommended)</SelectItem>
                  <SelectItem value="nova-2">Nova-2</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="deepgramTtsVoice">TTS Voice</Label>
              <Select
                value={config.deepgram.ttsVoice}
                onValueChange={(value) => updateDeepgram("ttsVoice", value)}
              >
                <SelectTrigger id="deepgramTtsVoice" className="h-10 w-full rounded-xl">
                  <SelectValue placeholder="Select an Aura voice" />
                </SelectTrigger>
                <SelectContent>
                  {voiceOptions.length > 0 ? (
                    voiceOptions.map((voice) => (
                      <SelectItem key={voice.value} value={voice.value}>
                        {voice.name}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="voice-options-unavailable" disabled>
                      No voice options available
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            AI Model Configuration
          </CardTitle>
          <CardDescription>
            Configure provider keys and the default language model for conversations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {PROVIDERS.map((provider) => {
              const providerConfig = config.providers[provider.value];
              const isVerifying = verifyingProvider === provider.value;
              return (
                <div
                  key={provider.value}
                  className="space-y-3 rounded-xl border p-4"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`${provider.value}ApiKey`}>
                      {provider.label} API Key
                    </Label>
                    <StatusBadge
                      status={providerConfig.status}
                      configured={Boolean(providerConfig.apiKey)}
                    />
                  </div>
                  <Input
                    id={`${provider.value}ApiKey`}
                    type="password"
                    value={providerConfig.apiKey}
                    onChange={(event) =>
                      updateProviderKey(
                        provider.value,
                        replacementKeyValue(
                          providerConfig.apiKey,
                          event.target.value,
                        ),
                      )
                    }
                    onFocus={(event) => {
                      if (isMasked(providerConfig.apiKey)) {
                        event.currentTarget.select();
                      }
                    }}
                    placeholder={`Enter your ${provider.label} API key`}
                    autoComplete="off"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleVerifyProvider(provider.value)}
                    disabled={Boolean(verifyingProvider)}
                  >
                    {isVerifying ? "Verifying..." : "Verify"}
                  </Button>
                  {providerConfig.apiKey && !isMasked(providerConfig.apiKey) && (
                    <p className="text-xs text-muted-foreground">
                      Save the new key before verifying it.
                    </p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="llmProvider">Default LLM Provider</Label>
              <Select
                value={config.defaultProvider}
                onValueChange={handleDefaultProviderChange}
                disabled={!llmOptionsAvailable}
              >
                <SelectTrigger id="llmProvider" className="h-10 w-full rounded-xl">
                  <SelectValue placeholder="Select an LLM provider" />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((provider) => (
                    <SelectItem key={provider.value} value={provider.value}>
                      {provider.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="llmModel">Default Model</Label>
              <Select
                value={config.defaultModel}
                onValueChange={(value) =>
                  setConfig((current) => ({ ...current, defaultModel: value }))
                }
                disabled={!llmOptionsAvailable}
              >
                <SelectTrigger id="llmModel" className="h-10 w-full rounded-xl">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  {selectedModels.length > 0 ? (
                    selectedModels.map((model) => (
                      <SelectItem key={model.value} value={model.value}>
                        {model.name}
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="model-options-unavailable" disabled>
                      No models available
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2 lg:col-span-2">
              <Label htmlFor="temperature">
                Temperature ({config.temperature.toFixed(1)})
              </Label>
              <Slider
                id="temperature"
                min={0}
                max={1}
                step={0.1}
                value={[config.temperature]}
                onValueChange={(value) =>
                  setConfig((current) => ({
                    ...current,
                    temperature: value[0],
                  }))
                }
                className="py-4"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="systemPrompt">System Prompt</Label>
            <Textarea
              id="systemPrompt"
              value={config.generalSettings.defaultSystemPrompt}
              onChange={(event) =>
                updateGeneralSetting("defaultSystemPrompt", event.target.value)
              }
              rows={8}
              placeholder="Enter the system prompt for your AI assistant..."
              className="min-h-[120px] sm:min-h-[200px]"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Call Settings
            <HoverCard>
              <HoverCardTrigger asChild>
                <button className="ml-1 h-5 w-5 text-muted-foreground transition-colors hover:text-foreground">
                  <Info className="h-5 w-5" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent className="w-80">
                <p className="text-sm text-muted-foreground">
                  Configure call duration, retry behavior, and scheduling time zone.
                </p>
              </HoverCardContent>
            </HoverCard>
          </CardTitle>
          <CardDescription>
            Configure call behavior and retry logic
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="maxCallDuration">Max Call Duration (seconds)</Label>
              <Input
                id="maxCallDuration"
                type="number"
                min={30}
                max={3600}
                value={config.generalSettings.maxCallDuration}
                onChange={(event) =>
                  updateGeneralSetting(
                    "maxCallDuration",
                    Number(event.target.value),
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retryAttempts">Retry Attempts</Label>
              <Input
                id="retryAttempts"
                type="number"
                min={0}
                max={10}
                value={config.generalSettings.callRetryAttempts}
                onChange={(event) =>
                  updateGeneralSetting(
                    "callRetryAttempts",
                    Number(event.target.value),
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retryDelay">Retry Delay (seconds)</Label>
              <Input
                id="retryDelay"
                type="number"
                min={15}
                max={1440}
                value={config.generalSettings.callRetryDelay}
                onChange={(event) =>
                  updateGeneralSetting("callRetryDelay", Number(event.target.value))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timeZone">Time Zone</Label>
              <Select
                value={config.generalSettings.defaultTimeZone}
                onValueChange={(value) =>
                  updateGeneralSetting("defaultTimeZone", value)
                }
              >
                <SelectTrigger id="timeZone" className="h-10 w-full rounded-xl">
                  <SelectValue placeholder="Select time zone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/New_York">Eastern Time</SelectItem>
                  <SelectItem value="America/Chicago">Central Time</SelectItem>
                  <SelectItem value="America/Denver">Mountain Time</SelectItem>
                  <SelectItem value="America/Los_Angeles">Pacific Time</SelectItem>
                  <SelectItem value="Asia/Kolkata">India Standard Time</SelectItem>
                  <SelectItem value="UTC">UTC</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Webhook Integration
          </CardTitle>
          <CardDescription>
            Configure the secret used to verify incoming call-event webhooks
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <Label htmlFor="webhookSecret">Webhook Secret</Label>
            <Input
              id="webhookSecret"
              type="password"
              value={config.webhookSecret}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  webhookSecret: replacementKeyValue(
                    current.webhookSecret,
                    event.target.value,
                  ),
                }))
              }
              onFocus={(event) => {
                if (isMasked(config.webhookSecret)) {
                  event.currentTarget.select();
                }
              }}
              placeholder="Enter your webhook secret"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              The webhook base URL is configured by the server environment.
            </p>
          </div>
        </CardContent>
      </Card>
      </fieldset>
    </div>
  );
};

export default Configuration;

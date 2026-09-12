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
import { useToast } from "@/hooks/useToast";
import { configApi } from "@/services/configApi";
import {
  AlertTriangle,
  Check,
  CheckCircle,
  Info,
  MessageSquare,
  Mic,
  PhoneCall,
  Save,
  Settings,
  Volume2,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

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
  /** Chat models fetched from the provider with the user's key at verify time. */
  models: LlmModelOption[];
}

interface GeneralSettings {
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
}

interface ServerProviderConfig {
  name?: string;
  apiKey?: string;
  status?: string;
  availableModels?: Array<{ name?: string; value?: string }>;
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
  models?: Array<{ name?: string; value?: string }>;
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

const INITIAL_STATE: ConfigurationState = {
  deepgram: {
    apiKey: "",
    sttModel: "nova-3",
    ttsVoice: "aura-2-thalia-en",
    status: "unverified",
  },
  providers: {
    openai: { apiKey: "", status: "unverified", models: [] },
    anthropic: { apiKey: "", status: "unverified", models: [] },
    google: { apiKey: "", status: "unverified", models: [] },
  },
  defaultProvider: "openai",
  defaultModel: "gpt-4.1",
  temperature: 0.7,
  generalSettings: {
    maxCallDuration: 300,
    callRetryAttempts: 3,
    callRetryDelay: 60,
    defaultTimeZone: "America/New_York",
  },
  complianceSettings: {},
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

function toModelOptions(
  models: Array<{ name?: string; value?: string }> | undefined,
): LlmModelOption[] {
  return (models ?? []).flatMap((model) =>
    model.value ? [{ name: model.name || model.value, value: model.value }] : [],
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
        models: toModelOptions(savedProvider?.availableModels),
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
  const failed = status === "failed";
  const tone = verified
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : failed
      ? "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400"
      : "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  return (
    <Badge variant="outline" className={`gap-1 font-medium ${tone}`}>
      {verified ? (
        <CheckCircle className="h-3 w-3" />
      ) : (
        <AlertTriangle className="h-3 w-3" />
      )}
      {statusLabel(status, configured)}
    </Badge>
  );
}

function SectionIcon({ children }: { children: ReactNode }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
      {children}
    </span>
  );
}

interface ReadinessStep {
  key: string;
  title: string;
  detail: string;
  done: boolean;
  icon: ReactNode;
}

/**
 * Mirrors the server-side dispatch gate: calls are rejected until the
 * Deepgram key and the default LLM provider key are both verified.
 */
function ReadinessRail({
  deepgramVerified,
  llmVerified,
  defaultProviderLabel,
}: {
  deepgramVerified: boolean;
  llmVerified: boolean;
  defaultProviderLabel: string;
}) {
  const ready = deepgramVerified && llmVerified;
  const steps: ReadinessStep[] = [
    {
      key: "voice",
      title: "Voice",
      detail: deepgramVerified
        ? "Deepgram key verified"
        : "Verify your Deepgram key",
      done: deepgramVerified,
      icon: <Mic className="h-4 w-4" />,
    },
    {
      key: "intelligence",
      title: "Intelligence",
      detail: llmVerified
        ? `${defaultProviderLabel} key verified`
        : `Verify your ${defaultProviderLabel} key`,
      done: llmVerified,
      icon: <MessageSquare className="h-4 w-4" />,
    },
    {
      key: "calls",
      title: ready ? "Ready to place calls" : "Calling locked",
      detail: ready
        ? "Campaigns can dial with your keys"
        : "Complete both steps to unlock calling",
      done: ready,
      icon: <PhoneCall className="h-4 w-4" />,
    },
  ];

  return (
    <Card
      className={
        ready
          ? "border-emerald-500/40 bg-emerald-500/[0.04]"
          : "border-amber-500/30 bg-amber-500/[0.03]"
      }
    >
      <CardContent className="py-5">
        <ol className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-0">
          {steps.map((step, index) => (
            <li
              key={step.key}
              className="flex flex-1 items-center gap-3 sm:min-w-0"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
                  step.done
                    ? "border-emerald-500 bg-emerald-500 text-white"
                    : "border-muted-foreground/30 bg-background text-muted-foreground"
                }`}
              >
                {step.done ? <Check className="h-4 w-4" /> : step.icon}
              </span>
              <span className="min-w-0">
                <span
                  className={`block truncate text-sm font-semibold ${
                    step.done ? "" : "text-muted-foreground"
                  }`}
                >
                  {step.title}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {step.detail}
                </span>
              </span>
              {index < steps.length - 1 && (
                <span
                  aria-hidden
                  className={`mx-4 hidden h-px flex-1 sm:block ${
                    step.done ? "bg-emerald-500/60" : "bg-border"
                  }`}
                />
              )}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
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

  // Prefer the models fetched live from the provider with the user's own key
  // (populated on verify); the static catalog is only the pre-verify fallback.
  const modelsForProvider = (provider: ProviderName) => {
    const fetched = config.providers[provider].models;
    if (fetched.length > 0) return fetched;
    return llmOptions.find((option) => option.value === provider)?.models ?? [];
  };

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
                models: savedProvider.availableModels
                  ? toModelOptions(savedProvider.availableModels)
                  : current.providers[provider.value].models,
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
      const fetchedModels = verified ? toModelOptions(result.models) : [];
      setConfig((current) => {
        const models =
          fetchedModels.length > 0
            ? fetchedModels
            : current.providers[provider].models;
        // Keep the selected model valid against the freshly fetched list.
        const defaultModel =
          provider === current.defaultProvider &&
          models.length > 0 &&
          !models.some((model) => model.value === current.defaultModel)
            ? models[0].value
            : current.defaultModel;
        return {
          ...current,
          defaultModel,
          providers: {
            ...current.providers,
            [provider]: { ...current.providers[provider], status, models },
          },
        };
      });
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
  const selectedProviderLabel =
    PROVIDERS.find((provider) => provider.value === config.defaultProvider)
      ?.label ?? config.defaultProvider;

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
      <ReadinessRail
        deepgramVerified={config.deepgram.status === "verified"}
        llmVerified={selectedProvider.status === "verified"}
        defaultProviderLabel={selectedProviderLabel}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <SectionIcon>
              <Volume2 className="h-4 w-4" />
            </SectionIcon>
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
                  className="font-mono"
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
          <CardTitle className="flex items-center gap-3">
            <SectionIcon>
              <MessageSquare className="h-4 w-4" />
            </SectionIcon>
            AI Model Configuration
          </CardTitle>
          <CardDescription>
            Configure provider keys and the default language model for conversations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>LLM Provider</Label>
            <div
              role="radiogroup"
              aria-label="LLM provider"
              className="grid grid-cols-1 gap-3 sm:grid-cols-3"
            >
              {PROVIDERS.map((provider) => {
                const providerConfig = config.providers[provider.value];
                const isSelected = config.defaultProvider === provider.value;
                return (
                  <button
                    key={provider.value}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => handleDefaultProviderChange(provider.value)}
                    disabled={!llmOptionsAvailable}
                    className={`flex items-center justify-between gap-2 rounded-xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isSelected
                        ? "border-primary/60 bg-primary/[0.04] ring-1 ring-primary/40"
                        : "hover:border-primary/30 hover:shadow-sm"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span
                        aria-hidden
                        className={`h-2.5 w-2.5 shrink-0 rounded-full border-2 ${
                          isSelected
                            ? "border-primary bg-primary"
                            : "border-muted-foreground/40"
                        }`}
                      />
                      <span className="text-sm font-semibold">
                        {provider.label}
                      </span>
                    </span>
                    <StatusBadge
                      status={providerConfig.status}
                      configured={Boolean(providerConfig.apiKey)}
                    />
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 rounded-xl border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor="selectedProviderApiKey">
                {selectedProviderLabel} API Key
              </Label>
              <StatusBadge
                status={selectedProvider.status}
                configured={Boolean(selectedProvider.apiKey)}
              />
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="selectedProviderApiKey"
                type="password"
                value={selectedProvider.apiKey}
                onChange={(event) =>
                  updateProviderKey(
                    config.defaultProvider,
                    replacementKeyValue(
                      selectedProvider.apiKey,
                      event.target.value,
                    ),
                  )
                }
                onFocus={(event) => {
                  if (isMasked(selectedProvider.apiKey)) {
                    event.currentTarget.select();
                  }
                }}
                placeholder={`Enter your ${selectedProviderLabel} API key`}
                autoComplete="off"
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => handleVerifyProvider(config.defaultProvider)}
                disabled={Boolean(verifyingProvider)}
              >
                {verifyingProvider === config.defaultProvider
                  ? "Verifying..."
                  : "Verify"}
              </Button>
            </div>
            {selectedProvider.apiKey && !isMasked(selectedProvider.apiKey) && (
              <p className="text-xs text-muted-foreground">
                Save the new key before verifying it.
              </p>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="llmModel">Default Model</Label>
              <Select
                value={config.defaultModel}
                onValueChange={(value) =>
                  setConfig((current) => ({ ...current, defaultModel: value }))
                }
                disabled={selectedModels.length === 0}
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
              <p className="text-xs text-muted-foreground">
                {selectedProvider.models.length > 0
                  ? `Models fetched from your ${selectedProviderLabel} account.`
                  : `Standard catalog shown — verify your ${selectedProviderLabel} key to load the models available to your account.`}
              </p>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-3">
            <SectionIcon>
              <Settings className="h-4 w-4" />
            </SectionIcon>
            Call Settings
            <HoverCard>
              <HoverCardTrigger asChild>
                <button
                  type="button"
                  aria-label="About call settings"
                  className="ml-1 h-5 w-5 text-muted-foreground transition-colors hover:text-foreground"
                >
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

      </fieldset>
    </div>
  );
};

export default Configuration;

import { PasswordInput } from "@/components/PasswordInput";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/useToast";
import api from "@/services/api";
import { configApi } from "@/services/configApi";
import {
  AlertTriangle,
  CheckCircle,
  Info,
  MessageSquare,
  Mic,
  Phone,
  PhoneCall,
  Save,
  Settings,
  Trash2,
  Volume2,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface Configuration {
  // AI Voice Settings
  voiceProvider: "elevenlabs" | "openai" | "google";
  voiceId: string;
  voiceSpeed: number;
  voiceStability: number;
  voiceClarity: number;
  elevenLabsApiKey: string;
  elevenLabsStatus?: "unverified" | "verified" | "failed";
  useFlashModel?: boolean;

  // Speech Recognition Settings
  deepgramApiKey: string;
  deepgramStatus?: "unverified" | "verified" | "failed";
  deepgramEnabled?: boolean;
  deepgramModel?: string;

  // Phone Settings
  twilioAccountSid: string;
  twilioAuthToken: string;
  twilioPhoneNumber: string;
  twilioStatus?: "unverified" | "verified" | "failed";

  // AI Model Settings
  llmProvider: "openai" | "anthropic" | "google";
  llmModel: string;
  llmApiKey: string;
  llmStatus?: "unverified" | "verified" | "failed";
  systemPrompt: string;
  temperature: number;
  maxTokens: number;

  // Call Settings
  maxCallDuration: number;
  retryAttempts: number;
  retryDelay: number;
  timeZone: string;

  // Webhook Settings
  webhookSecret: string;
  webhookStatus?: "unverified" | "verified" | "failed";
}

interface ModelInfo {
  id: string;
  name: string;
  description?: string;
  maxTokens?: number;
  contextWindow?: number;
  pricing?: {
    input: number;
    output: number;
  };
  capabilities?: {
    chat: boolean;
    completion: boolean;
    streaming: boolean;
    functionCalling?: boolean;
    vision?: boolean;
  };
}

const Configuration = () => {
  const { toast } = useToast();
  const [config, setConfig] = useState<Configuration>({
    // AI Voice Settings
    voiceProvider: "elevenlabs",
    voiceId: "", // Initialize with empty or a sensible default if no API voices yet
    voiceSpeed: 1.0,
    voiceStability: 0.8,
    voiceClarity: 0.9,
    elevenLabsApiKey: "",
    elevenLabsStatus: "unverified",
    useFlashModel: true, // Default to using Flash model

    // Speech Recognition Settings
    deepgramApiKey: "",
    deepgramStatus: "unverified",
    deepgramEnabled: true,
    deepgramModel: "nova-2",

    // Phone Settings
    twilioAccountSid: "",
    twilioAuthToken: "",
    twilioPhoneNumber: "",
    twilioStatus: "unverified",

    // AI Model Settings
    llmProvider: "openai",
    llmModel: "gpt-4",
    llmApiKey: "",
    llmStatus: "unverified",
    systemPrompt: `You are a professional sales representative making cold calls. Be polite, respectful, and helpful. Your goal is to:
1. Introduce yourself and your company
2. Understand the prospect's needs
3. Present relevant solutions
4. Schedule a follow-up if there's interest
5. Respect their time and decisions

Keep the conversation natural and engaging. If they're not interested, politely end the call.`,
    temperature: 0.7,
    maxTokens: 150,

    // Call Settings
    maxCallDuration: 300, // 5 minutes
    retryAttempts: 3,
    retryDelay: 60, // 1 minute
    timeZone: "America/New_York",

    // Webhook Settings
    webhookSecret: "",
    webhookStatus: "unverified",
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [testingCall, setTestingCall] = useState(false);
  const [openTestCallDialog, setOpenTestCallDialog] = useState(false);
  const [testCallNumber, setTestCallNumber] = useState("");
  const [testCallMessage, setTestCallMessage] = useState(
    ""
  );
  const [testingLLMChat, setTestingLLMChat] = useState(false);
  const [openTestLLMChatDialog, setOpenTestLLMChatDialog] = useState(false);
  const [testLLMResponse, setTestLLMResponse] = useState("");
  const [availableVoices, setAvailableVoices] = useState<
    { voiceId: string; name: string; previewUrl?: string }[]
  >([]);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<{
    type: string;
    name?: string;
  } | null>(null);
  const [availableModels, setAvailableModels] = useState<{
    [provider: string]: ModelInfo[];
  }>({});
  const [loadingModels, setLoadingModels] = useState(false);
  const [apiKeyDebounceTimer, setApiKeyDebounceTimer] =
    useState<NodeJS.Timeout | null>(null);
  const [elevenLabsDebounceTimer, setElevenLabsDebounceTimer] = useState<NodeJS.Timeout | null>(null);

  // Load available voices
  const loadVoices = useCallback(async () => {
    try {
      let currentVoices: {
        voiceId: string;
        name: string;
        previewUrl?: string;
      }[] = []; // Initialize as empty

      const currentApiKey = config.elevenLabsApiKey;

      // Check if API key is set
      console.log("ElevenLabs API key status:", {
        key: currentApiKey ? "SET" : "NOT SET",
        length: currentApiKey?.length,
      });

      // Try to fetch custom voices if API key is set
      if (currentApiKey) {
        console.log("Fetching available voices from ElevenLabs...");
        try {
          const result = await configApi.testElevenLabsConnection({
            apiKey: currentApiKey,
          });

          if (result.success && result.details?.availableVoices) {
            console.log(
              `Received ${result.details.availableVoices.length} voices from ElevenLabs`
            );
            currentVoices = result.details.availableVoices; // Use only API voices
          }
        } catch (error) {
          console.error("Error loading voices from API:", error);
          // Keep currentVoices empty if API call fails
        }
      }
      setAvailableVoices(currentVoices);
      // Only update voiceId if it's empty or if no voices are available at all
      if (currentVoices.length === 0) {
        // Clear voiceId if no voices are available
        setConfig((prevConfig) => ({ ...prevConfig, voiceId: "" }));
      } else if (!config.voiceId) {
        // Set to first voice only if no voice is currently selected
        setConfig((prevConfig) => ({
          ...prevConfig,
          voiceId: currentVoices[0].voiceId,
        }));
      }
      // Note: We intentionally don't override the user's selection even if 
      // their selected voice isn't in the current available voices list,
      // as this could be temporary (API issues, etc.)
    } catch (error) {
      console.error("Error in loadVoices function:", error);
      setAvailableVoices([]); // Ensure availableVoices is empty on error
      setConfig((prevConfig) => ({ ...prevConfig, voiceId: "" }));
    }
  }, [config.elevenLabsApiKey, setConfig]); // Added setConfig to dependencies

  // Fetch available models from the API (for saved configurations)
  // This function fetches a general list of models, possibly for all configured providers.
  const fetchAvailableModels = useCallback(async () => {
    try {
      setLoadingModels(true);
      // This API call is expected to return models based on the overall server-side configuration
      // or for all providers, not necessarily tied to the live-typed config.llmApiKey.
      const response = await api.get("/configuration/llm-models");

      if (response.data.success) {
        setAvailableModels(response.data.models);
      }
    } catch (error) {
      console.error("Failed to fetch available models:", error);
    } finally {
      setLoadingModels(false);
    }
  // }, [config.llmApiKey]); // Removed config.llmApiKey from dependencies
}, [api, setLoadingModels, setAvailableModels]); // Assuming 'api' is stable or memoized

  // Dynamically fetch models when user enters an API key
  const fetchModelsWithApiKey = useCallback(
    async (provider: string, apiKey: string) => {
      if (!apiKey || apiKey.length < 10) {
        // Clear models for the provider if API key is invalid
        setAvailableModels((prev) => ({
          ...prev,
          [provider]: [],
        }));
        return;
      }

      try {
        setLoadingModels(true);
        console.log(`Fetching models for provider: ${provider}`);

        // Use provider name as is - we no longer need to map 'gemini' to 'google'
        const response = await configApi.fetchModelsWithApiKey(
          provider,
          apiKey
        );

        if (response.success && response.models) {
          // Store models under the original provider name requested
          setAvailableModels((prev) => ({
            ...prev,
            [provider]: response.models,
          }));

          // If no model is currently selected and models are available, select the first one
          // Use a separate function to avoid circular dependencies
          setConfig((prevConfig) => {
            if (!prevConfig.llmModel && response.models.length > 0) {
              return { ...prevConfig, llmModel: response.models[0].id };
            }
            return prevConfig;
          });
        }
      } catch (error) {
        console.error(`Failed to fetch models for ${provider}:`, error);
        // Clear models on error
        setAvailableModels((prev) => ({
          ...prev,
          [provider]: [],
        }));

        // Show toast error
        toast({
          title: "Failed to fetch models",
          description:
            error instanceof Error
              ? error.message
              : "Please check your API key and try again.",
          variant: "destructive",
        });
      } finally {
        setLoadingModels(false);
      }
    },
    [toast, setConfig, setAvailableModels, setLoadingModels]
  );

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (apiKeyDebounceTimer) {
        clearTimeout(apiKeyDebounceTimer);
      }
      if (elevenLabsDebounceTimer) { // Clean up elevenLabsDebounceTimer as well
        clearTimeout(elevenLabsDebounceTimer);
      }
    };
  // }, [apiKeyDebounceTimer]);
}, [apiKeyDebounceTimer, elevenLabsDebounceTimer]);

  useEffect(() => {
    // Load voices only on component mount or when elevenLabsApiKey changes, with debounce
    if (elevenLabsDebounceTimer) {
      clearTimeout(elevenLabsDebounceTimer);
    }

    // loadVoices will use the latest config.elevenLabsApiKey due to its own useCallback dependency.
    const newTimer = setTimeout(() => {
      console.log("Debounced: Calling loadVoices for ElevenLabs API key.");
      loadVoices();
    }, 1000); // 1-second debounce

    setElevenLabsDebounceTimer(newTimer);

    return () => {
      clearTimeout(newTimer);
    };
  }, [config.elevenLabsApiKey, loadVoices]); // Keep loadVoices in deps

  // Fetch available models (general list) when component mounts or when the LLM provider changes.
  // This should not run on every keystroke of the llmApiKey.
  useEffect(() => {
    console.log("Effect: Calling fetchAvailableModels (general list) due to mount or provider change.");
    fetchAvailableModels();
  // }, [config.llmApiKey, fetchAvailableModels]); // Old dependencies
  }, [fetchAvailableModels, config.llmProvider]); // New dependencies

  useEffect(() => {
    // Fetch configuration from API
    const fetchConfiguration = async () => {
      try {
        setLoading(true);
        const data = await configApi.getConfiguration();
        console.log("Fetched configuration from server:", {
          elevenLabsConfig: {
            voiceSpeed: data.elevenLabsConfig?.voiceSpeed,
            voiceStability: data.elevenLabsConfig?.voiceStability,
            voiceClarity: data.elevenLabsConfig?.voiceClarity,
            selectedVoiceId: data.elevenLabsConfig?.selectedVoiceId,
            isEnabled: data.elevenLabsConfig?.isEnabled,
          },
          llmConfig: {
            defaultProvider: data.llmConfig?.defaultProvider,
            defaultModel: data.llmConfig?.defaultModel,
            temperature: data.llmConfig?.temperature,
            maxTokens: data.llmConfig?.maxTokens,
          },
          generalSettings: {
            maxCallDuration: data.generalSettings?.maxCallDuration,
            defaultSystemPrompt: data.generalSettings?.defaultSystemPrompt
              ? "SET"
              : "NOT SET",
            defaultTimeZone: data.generalSettings?.defaultTimeZone,
          },
          webhookConfig: {
            // URL is now environment-only, only show secret status
            secret: data.webhookConfig?.secret ? "SET" : "NOT SET",
          },
        });

        setConfig({
          // Set defaults for any missing properties
          voiceProvider: data.elevenLabsConfig?.isEnabled
            ? "elevenlabs"
            : data.llmConfig?.providers.find(
                (p: any) => p.name === "openai" && p.isEnabled
              )
            ? "openai"
            : "google",
          voiceId:
            data.elevenLabsConfig?.selectedVoiceId || 
            data.elevenLabsConfig?.availableVoices?.[0]?.voiceId || 
            "rachel",
          voiceSpeed: data.elevenLabsConfig?.voiceSpeed || 1.0,
          voiceStability: data.elevenLabsConfig?.voiceStability || 0.8,
          voiceClarity: data.elevenLabsConfig?.voiceClarity || 0.9,
          elevenLabsApiKey: data.elevenLabsConfig?.apiKey || "",
          elevenLabsStatus: data.elevenLabsConfig?.status || "unverified",
          useFlashModel: data.elevenLabsConfig?.useFlashModel !== false, // Default to true if not specified

          deepgramApiKey: data.deepgramConfig?.apiKey || "",
          deepgramStatus: data.deepgramConfig?.status || "unverified",
          deepgramEnabled: data.deepgramConfig?.isEnabled !== false, // Default to true if not specified
          deepgramModel: data.deepgramConfig?.model || "nova-2",

          twilioAccountSid: data.twilioConfig?.accountSid || "",
          twilioAuthToken: data.twilioConfig?.authToken || "",
          twilioPhoneNumber: data.twilioConfig?.phoneNumbers?.[0] || "",
          twilioStatus: data.twilioConfig?.status || "unverified",

          llmProvider: data.llmConfig?.defaultProvider || "openai",
          llmModel: data.llmConfig?.defaultModel || "gpt-4",
          llmApiKey:
            data.llmConfig?.providers.find(
              (p: any) => p.name === data.llmConfig?.defaultProvider
            )?.apiKey || "",
          llmStatus:
            data.llmConfig?.providers.find(
              (p: any) => p.name === data.llmConfig?.defaultProvider
            )?.status || "unverified",
          systemPrompt:
            data.generalSettings?.defaultSystemPrompt ||
            `You are a professional sales representative making cold calls. Be polite, respectful, and helpful.`,
          temperature: data.llmConfig?.temperature || 0.7,
          maxTokens: data.llmConfig?.maxTokens || 150,

          maxCallDuration: data.generalSettings?.maxCallDuration || 300,
          retryAttempts: data.generalSettings?.callRetryAttempts || 3,
          retryDelay: 60,
          timeZone:
            data.generalSettings?.defaultTimeZone ||
            data.generalSettings?.workingHours?.timeZone ||
            "America/New_York",

          webhookSecret: data.webhookConfig?.secret || "",
          webhookStatus: data.webhookConfig?.status || "unverified",
        });
      } catch (error) {
        console.error("Error fetching configuration:", error);
        toast({
          title: "Error",
          description: "Failed to load configuration. Using default settings.",
          variant: "destructive",
        });
        // Keep the default state
      } finally {
        setLoading(false);
      }
    };

    fetchConfiguration();
  }, []); // Keep toast out of dependencies for now, assuming useToast provides a stable function

  const handleSave = async () => {
    setSaving(true);
    try {
      // Debug log before save
      console.log("Saving configuration with LLM provider status:", {
        provider: config.llmProvider,
        model: config.llmModel,
        status: config.llmStatus,
      });

      // Debug log before save
      console.log("Saving configuration with voice settings:", {
        voiceProvider: config.voiceProvider,
        voiceId: config.voiceId,
        voiceSpeed: config.voiceSpeed,
        voiceStability: config.voiceStability,
        voiceClarity: config.voiceClarity,
        useFlashModel: config.useFlashModel,
        elevenLabsApiKey: config.elevenLabsApiKey
          ? `${config.elevenLabsApiKey.slice(
              0,
              4
            )}...${config.elevenLabsApiKey.slice(-4)}`
          : "NOT SET",
      });

      console.log("Saving configuration with speech recognition settings:", {
        deepgramApiKey: config.deepgramApiKey
          ? `${config.deepgramApiKey.slice(
              0,
              4
            )}...${config.deepgramApiKey.slice(-4)}`
          : "NOT SET",
        deepgramEnabled: config.deepgramEnabled,
        deepgramModel: config.deepgramModel,
      });

      console.log("Saving configuration with LLM settings:", {
        llmProvider: config.llmProvider,
        llmModel: config.llmModel,
        temperature: config.temperature,
        maxTokens: config.maxTokens,
        llmApiKey: config.llmApiKey ? "SET" : "NOT SET",
      });

      // Transform the flat config object into the structured API format
      const apiConfig = {
        twilioConfig: {
          accountSid: config.twilioAccountSid,
          authToken: config.twilioAuthToken,
          phoneNumbers: config.twilioPhoneNumber
            ? [config.twilioPhoneNumber]
            : [],
          isEnabled: !!config.twilioAccountSid && !!config.twilioAuthToken,
          status: config.twilioStatus,
        },
        elevenLabsConfig: {
          apiKey: config.elevenLabsApiKey,
          selectedVoiceId: config.voiceId,
          isEnabled:
            config.voiceProvider === "elevenlabs" && !!config.elevenLabsApiKey,
          voiceSpeed: config.voiceSpeed,
          voiceStability: config.voiceStability,
          voiceClarity: config.voiceClarity,
          status: config.elevenLabsStatus,
          availableVoices: availableVoices.length > 0 ? availableVoices : [],
          useFlashModel: config.useFlashModel,
        },
        deepgramConfig: {
          apiKey: config.deepgramApiKey,
          isEnabled: config.deepgramEnabled,
          model: config.deepgramModel || "nova-2",
          tier: "enhanced",
          status: config.deepgramStatus,
        },
        llmConfig: {
          defaultProvider: config.llmProvider,
          defaultModel: config.llmModel,
          temperature: config.temperature,
          maxTokens: config.maxTokens,
          providers: [
            {
              name: "openai",
              apiKey: config.llmProvider === "openai" ? config.llmApiKey : "",
              availableModels:
                availableModels["openai"]?.length > 0
                  ? availableModels["openai"].map((m) => m.id)
                  : [],
              isEnabled: config.llmProvider === "openai",
              status:
                config.llmProvider === "openai"
                  ? config.llmStatus
                  : "unverified",
            },
            {
              name: "anthropic",
              apiKey:
                config.llmProvider === "anthropic" ? config.llmApiKey : "",
              availableModels:
                availableModels["anthropic"]?.length > 0
                  ? availableModels["anthropic"].map((m) => m.id)
                  : [],
              isEnabled: config.llmProvider === "anthropic",
              status:
                config.llmProvider === "anthropic"
                  ? config.llmStatus
                  : "unverified",
            },
            {
              name: "google",
              apiKey: config.llmProvider === "google" ? config.llmApiKey : "",
              availableModels:
                availableModels[config.llmProvider]?.length > 0
                  ? availableModels[config.llmProvider].map((m) => m.id)
                  : [],
              isEnabled: config.llmProvider === "google",
              status:
                config.llmProvider === "google"
                  ? config.llmStatus
                  : "unverified",
            },
          ],
        },
        generalSettings: {
          maxCallDuration: config.maxCallDuration,
          callRetryAttempts: config.retryAttempts,
          defaultTimeZone: config.timeZone,
          defaultSystemPrompt: config.systemPrompt,
        },
        webhookConfig: {
          secret: config.webhookSecret,
          status: config.webhookStatus,
        },
        voiceAIConfig: {
          conversationalAI: {
            defaultVoiceId: config.voiceId,
          },
        },
      };

      // Log what we're sending to server
      console.log("LLM Provider config being sent to server:", {
        defaultProvider: config.llmProvider,
        providers: [
          {
            name: "openai",
            status: config.llmProvider === "openai" ? config.llmStatus : "unverified",
            isEnabled: config.llmProvider === "openai",
          },
          {
            name: "anthropic",
            status: config.llmProvider === "anthropic" ? config.llmStatus : "unverified",
            isEnabled: config.llmProvider === "anthropic",
          },
          {
            name: "google",
            status: config.llmProvider === "google" ? config.llmStatus : "unverified",
            isEnabled: config.llmProvider === "google",
          },
        ],
      });

      await configApi.updateConfiguration(apiConfig);

      // Debug log - check what was sent to server
      console.log("API Config sent to server:", {
        twilioConfig: {
          accountSid: apiConfig.twilioConfig.accountSid ? "SET" : "NOT SET",
          authToken: apiConfig.twilioConfig.authToken ? "SET" : "NOT SET",
          phoneNumbers: apiConfig.twilioConfig.phoneNumbers || [],
          isEnabled: apiConfig.twilioConfig.isEnabled,
        },
        elevenLabsConfig: {
          apiKey: apiConfig.elevenLabsConfig.apiKey ? "SET" : "NOT SET",
          selectedVoiceId: apiConfig.elevenLabsConfig.selectedVoiceId || "NOT SET",
          voiceSpeed: apiConfig.elevenLabsConfig.voiceSpeed,
          voiceStability: apiConfig.elevenLabsConfig.voiceStability,
          voiceClarity: apiConfig.elevenLabsConfig.voiceClarity,
          isEnabled: apiConfig.elevenLabsConfig.isEnabled,
        },
        llmConfig: {
          providers: apiConfig.llmConfig.providers.map((p: any) => ({
            name: p.name,
            apiKey: p.apiKey ? "SET" : "NOT SET",
            isEnabled: p.isEnabled,
          })),
          defaultProvider: apiConfig.llmConfig.defaultProvider,
          temperature: apiConfig.llmConfig.temperature,
          maxTokens: apiConfig.llmConfig.maxTokens,
        },
        voiceAIConfig: {
          conversationalAI: {
            defaultVoiceId: apiConfig.voiceAIConfig?.conversationalAI?.defaultVoiceId || "NOT SET",
          },
        },
      });

      // Fetch the updated configuration to ensure we have the latest data
      const updatedConfigData = await configApi.getConfiguration();

      // Update the local state with the fresh data
      setConfig((prevConfig) => {
        // Log what we're receiving from the server
        console.log("Received updated configuration from server:", {
          elevenLabsConfig: {
            voiceSpeed: updatedConfigData.elevenLabsConfig?.voiceSpeed,
            voiceStability: updatedConfigData.elevenLabsConfig?.voiceStability,
            voiceClarity: updatedConfigData.elevenLabsConfig?.voiceClarity,
          },
          llmConfig: {
            temperature: updatedConfigData.llmConfig?.temperature,
            maxTokens: updatedConfigData.llmConfig?.maxTokens,
          },
          generalSettings: {
            maxCallDuration: updatedConfigData.generalSettings?.maxCallDuration,
            defaultSystemPrompt: updatedConfigData.generalSettings
              ?.defaultSystemPrompt
              ? "SET"
              : "NOT SET",
            defaultTimeZone: updatedConfigData.generalSettings?.defaultTimeZone,
          },
          webhookConfig: {
            // URL is now environment-only, only show secret status
            secret: updatedConfigData.webhookConfig?.secret ? "SET" : "NOT SET",
          },
        }); // Get the LLM API key - preserve the one we have if the server returns a masked key
        const currentProvider =
          updatedConfigData.llmConfig?.defaultProvider ||
          prevConfig.llmProvider;
        const serverProviderKey = updatedConfigData.llmConfig?.providers?.find(
          (p: any) => p.name === currentProvider
        )?.apiKey;

        // Get current provider status from server, but preserve local verified status
        const serverProviderStatus =
          updatedConfigData.llmConfig?.providers?.find(
            (p: any) => p.name === currentProvider
          )?.status || "unverified";
        
        // Preserve verification status if it was just verified locally
        const llmStatus = prevConfig.llmStatus === "verified" 
          ? "verified" 
          : serverProviderStatus;

        const llmApiKey = serverProviderKey || prevConfig.llmApiKey;

        return {
          ...prevConfig,
          // Update ElevenLabs API key and status
          elevenLabsApiKey:
            updatedConfigData.elevenLabsConfig?.apiKey ||
            prevConfig.elevenLabsApiKey,

          // Update status values from server
          elevenLabsStatus:
            updatedConfigData.elevenLabsConfig?.status ||
            prevConfig.elevenLabsStatus,

          // Always take the updated voice settings, even if they're 0
          voiceSpeed:
            updatedConfigData.elevenLabsConfig?.voiceSpeed !== undefined
              ? updatedConfigData.elevenLabsConfig.voiceSpeed
              : prevConfig.voiceSpeed,

          voiceStability:
            updatedConfigData.elevenLabsConfig?.voiceStability !== undefined
              ? updatedConfigData.elevenLabsConfig.voiceStability
              : prevConfig.voiceStability,

          voiceClarity:
            updatedConfigData.elevenLabsConfig?.voiceClarity !== undefined
              ? updatedConfigData.elevenLabsConfig.voiceClarity
              : prevConfig.voiceClarity,

          // Twilio config
          twilioAccountSid:
            updatedConfigData.twilioConfig?.accountSid ||
            prevConfig.twilioAccountSid,
          twilioAuthToken:
            updatedConfigData.twilioConfig?.authToken ||
            prevConfig.twilioAuthToken,
          twilioPhoneNumber:
            updatedConfigData.twilioConfig?.phoneNumbers?.[0] ||
            prevConfig.twilioPhoneNumber,
          twilioStatus:
            updatedConfigData.twilioConfig?.status || prevConfig.twilioStatus,

          // LLM config
          llmProvider:
            updatedConfigData.llmConfig?.defaultProvider ||
            prevConfig.llmProvider,
          llmModel:
            updatedConfigData.llmConfig?.defaultModel || prevConfig.llmModel,
          llmApiKey,
          llmStatus: llmStatus,
          temperature:
            updatedConfigData.llmConfig?.temperature !== undefined
              ? updatedConfigData.llmConfig.temperature
              : prevConfig.temperature,
          maxTokens:
            updatedConfigData.llmConfig?.maxTokens !== undefined
              ? updatedConfigData.llmConfig.maxTokens
              : prevConfig.maxTokens,

          // General settings
          maxCallDuration:
            updatedConfigData.generalSettings?.maxCallDuration ??
            prevConfig.maxCallDuration,
          systemPrompt:
            updatedConfigData.generalSettings?.defaultSystemPrompt ||
            prevConfig.systemPrompt,
          timeZone:
            updatedConfigData.generalSettings?.defaultTimeZone ||
            prevConfig.timeZone,

          // Webhook config
          webhookSecret:
            updatedConfigData.webhookConfig?.secret || prevConfig.webhookSecret,
          webhookStatus:
            updatedConfigData.webhookConfig?.status || prevConfig.webhookStatus,
        };
      });

      // Show success toast
      toast({
        title: "Configuration Saved",
        description:
          "Your settings have been successfully updated and applied.",
        variant: "default",
      });
    } catch (error) {
      console.error("Error saving configuration:", error);
      toast({
        title: "Error",
        description: "Failed to save configuration. Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestVoice = async () => {
    setTestingVoice(true);
    try {
      if (config.voiceProvider === "elevenlabs") {
        const testText =
          "Hello! This is a test of the voice synthesis system. The voice sounds clear and natural.";
        console.log(`Testing voice with ID: ${config.voiceId}`);

        // Make sure we have a valid API key
        const apiKey = config.elevenLabsApiKey;
        if (!apiKey) {
          throw new Error("Please enter a valid API key.");
        }

        if (!config.voiceId) {
          throw new Error("Please select a voice to test.");
        }

        try {
          const result = await configApi.testVoiceSynthesis({
            voiceId: config.voiceId,
            text: testText,
            apiKey: apiKey,
          });

          // Update status to verified on successful test
          setConfig((prev) => ({
            ...prev,
            elevenLabsStatus: "verified",
          }));

          // Play the synthesized audio
          if (result.audioData) {
            const audio = new Audio(result.audioData);
            await audio.play();

            toast({
              title: "Voice Test Successful",
              description:
                "Voice synthesis is working correctly and audio is playing.",
            });
          }
        } catch (error: any) {
          console.error("Voice synthesis test error:", error);

          // Update status to failed
          setConfig((prev) => ({
            ...prev,
            elevenLabsStatus: "failed",
          }));

          // Check for voice limit reached error
          const errorDetails = error.response?.data?.details;
          if (errorDetails && errorDetails.includes("voice_limit_reached")) {
            toast({
              title: "Voice Limit Reached",
              description:
                "You've reached your custom voice limit on ElevenLabs. Try using pre-built voices instead.",
              variant: "destructive",
            });
          } else {
            throw error;
          }
        }
      }
    } catch (error: any) {
      console.error("Voice test error:", error);

      // Update status to failed on any error
      setConfig((prev) => ({
        ...prev,
        elevenLabsStatus: "failed",
      }));

      toast({
        title: "Voice Test Failed",
        description:
          error.message || "Please check your ElevenLabs API key and voice ID.",
        variant: "destructive",
      });
    } finally {
      setTestingVoice(false);
    }
  };

  // Updates the API key and resets verification status
  const updateApiKey = useCallback(
    (field: keyof Configuration, value: string) => {
      console.log(`Updating API key for ${field}`);

      // Reset verification status when API key changes
      let statusField: keyof Configuration | null = null;

      if (field === "elevenLabsApiKey") {
        statusField = "elevenLabsStatus";
      } else if (field === "twilioAuthToken") {
        statusField = "twilioStatus";
      } else if (field === "llmApiKey") {
        statusField = "llmStatus";
      } else if (field === "webhookSecret") {
        statusField = "webhookStatus";
      }

      setConfig((prev) => {
        const updates: Partial<Configuration> = { [field]: value };

        // Reset status to unverified when API key changes
        if (statusField) {
          updates[statusField] = "unverified";
        }

        return { ...prev, ...updates };
      });
    },
    []
  );

  // Updates a single field in the config state
  const updateConfig = useCallback(
    (field: keyof Configuration, value: any) => {
      console.log(
        `Updating configuration field: ${field} with value:`,
        field.includes("ApiKey") || field.includes("AuthToken")
          ? "[MASKED]"
          : value
      );

      // Special handling for API keys to reset verification status
      if (
        field === "elevenLabsApiKey" ||
        field === "twilioAuthToken" ||
        field === "llmApiKey" ||
        field === "webhookSecret"
      ) {
        updateApiKey(field, value);
        return;
      }

      setConfig((prev: Configuration) => {
        const newConfig = { ...prev, [field]: value };

        // Add additional logging for voice settings specifically
        if (
          field === "voiceSpeed" ||
          field === "voiceStability" ||
          field === "voiceClarity"
        ) {
          console.log(
            `Voice setting updated - ${field}: ${value} (previous: ${prev[field]})`
          );
        }

        // Special handling for LLM provider changes
        if (field === "llmProvider" && prev.llmProvider !== value) {
          console.log(
            `LLM provider changed from ${prev.llmProvider} to ${value}`
          );
        }

        return newConfig;
      });
    },
    [updateApiKey]
  );

  // Handle LLM provider changes
  const handleProviderChange = useCallback(
    (newProvider: "openai" | "anthropic" | "google") => {
      // Update the provider and reset related state
      setConfig((prevConfig) => ({
        ...prevConfig,
        llmProvider: newProvider,
        llmModel: "", // Reset model when provider changes
        llmStatus: "unverified", // Reset status
      }));

      // Clear current models for the new provider
      setAvailableModels((prev) => ({
        ...prev,
        [newProvider]: [],
      }));
    },
    [setConfig, setAvailableModels]
  );

  // Handler for API key changes with debouncing
  const handleApiKeyChange = useCallback(
    (value: string) => {
      // Update the config immediately for UI responsiveness
      updateConfig("llmApiKey", value);

      // Clear any existing timer
      if (apiKeyDebounceTimer) {
        clearTimeout(apiKeyDebounceTimer);
      }

      // Set a new timer to fetch models after user stops typing
      const timer = setTimeout(() => {
        if (value && value.length >= 10) {
          // Access the current provider without causing dependency issues
          const currentProvider = config.llmProvider;
          fetchModelsWithApiKey(currentProvider, value);
        }
      }, 1000); // 1 second delay

      setApiKeyDebounceTimer(timer);
    },
    [
      apiKeyDebounceTimer,
      config.llmProvider,
      fetchModelsWithApiKey,
      updateConfig,
    ]
  );

  const handleDeleteItem = (type: string, name?: string) => {
    setItemToDelete({ type, name });
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;

    setDeleteDialogOpen(false);
    try {
      // Perform delete action based on the type
      if (itemToDelete.type === "twilio") {
        await configApi.deleteApiKey({ provider: "twilio" });
        toast({
          title: "Twilio Configuration Deleted",
          description: "Your Twilio settings have been removed.",
          variant: "destructive",
        });
      } else if (itemToDelete.type === "elevenlabs") {
        await configApi.deleteApiKey({ provider: "elevenlabs" });
        toast({
          title: "ElevenLabs Configuration Deleted",
          description: "Your ElevenLabs settings have been removed.",
          variant: "destructive",
        });
      } else if (itemToDelete.type === "deepgram") {
        await configApi.deleteApiKey({ provider: "deepgram" });
        toast({
          title: "Deepgram Configuration Deleted",
          description: "Your Deepgram API key has been removed.",
          variant: "destructive",
        });
      } else if (itemToDelete.type === "llm" && itemToDelete.name) {
        await configApi.deleteApiKey({
          provider: "llm",
          name: itemToDelete.name,
        });
        toast({
          title: `${itemToDelete.name} API Key Deleted`,
          description: `Your ${itemToDelete.name} API key has been removed.`,
          variant: "destructive",
        });
      } else if (itemToDelete.type === "webhook") {
        await configApi.deleteApiKey({ provider: "webhook" });
        toast({
          title: "Webhook Secret Deleted",
          description: "Your webhook secret has been removed.",
          variant: "destructive",
        });
      }

      // Refresh configuration to get updated state after deletion
      await configApi.getConfiguration();

      // Update local state with updated configuration
      setConfig((prevConfig) => {
        // Reset API keys based on the type deleted
        if (itemToDelete.type === "twilio") {
          return {
            ...prevConfig,
            twilioAccountSid: "",
            twilioAuthToken: "",
            twilioPhoneNumber: "",
            twilioStatus: "unverified",
          };
        } else if (itemToDelete.type === "elevenlabs") {
          return {
            ...prevConfig,
            elevenLabsApiKey: "",
            elevenLabsStatus: "unverified",
          };
        } else if (itemToDelete.type === "deepgram") {
          return {
            ...prevConfig,
            deepgramApiKey: "",
            deepgramStatus: "unverified",
          };
        } else if (itemToDelete.type === "llm" && itemToDelete.name) {
          return {
            ...prevConfig,
            ...(prevConfig.llmProvider === itemToDelete.name
              ? {
                  llmApiKey: "",
                  llmStatus: "unverified",
                }
              : {}),
          };
        } else if (itemToDelete.type === "webhook") {
          return {
            ...prevConfig,
            webhookSecret: "",
            webhookStatus: "unverified",
          };
        }
        return prevConfig;
      });

      setItemToDelete(null);
    } catch (error) {
      console.error("Error deleting configuration:", error);
      toast({
        title: "Error Deleting Configuration",
        description: "Failed to delete the configuration. Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleTestCall = async () => {
    // Validate inputs
    if (!testCallNumber) {
      toast({
        title: "Missing Phone Number",
        description: "Please enter a phone number to receive the test call.",
        variant: "destructive",
      });
      return;
    }

    // Validate that Twilio credentials are set
    if (
      !config.twilioAccountSid ||
      !config.twilioAuthToken ||
      !config.twilioPhoneNumber
    ) {
      toast({
        title: "Missing Twilio Configuration",
        description:
          "Please configure your Twilio credentials and phone number first.",
        variant: "destructive",
      });
      return;
    }

    setTestingCall(true);
    try {
      const result = await configApi.makeTestCall({
        accountSid: config.twilioAccountSid,
        authToken: config.twilioAuthToken,
        fromNumber: config.twilioPhoneNumber,
        toNumber: testCallNumber,
        message: testCallMessage,
      });

      if (result.success) {
        toast({
          title: "Test Call Initiated",
          description: `A test call is being made to ${testCallNumber}. Status: ${result.status}`,
        });

        // Update Twilio status to verified if successful
        setConfig((prev) => ({
          ...prev,
          twilioStatus: "verified",
        }));
      } else {
        toast({
          title: "Test Call Failed",
          description:
            result.message ||
            "Failed to make test call. Please check your Twilio configuration.",
          variant: "destructive",
        });

        // Update Twilio status to failed
        setConfig((prev) => ({
          ...prev,
          twilioStatus: "failed",
        }));
      }
    } catch (error: any) {
      console.error("Test call error:", error);
      toast({
        title: "Test Call Error",
        description:
          error.message || "An error occurred while making the test call.",
        variant: "destructive",
      });

      // Update Twilio status to failed
      setConfig((prev) => ({
        ...prev,
        twilioStatus: "failed",
      }));
    } finally {
      setTestingCall(false);
      setOpenTestCallDialog(false);
    }
  };

  const handleTestLLMChat = async () => {
    // Use a predefined test message instead of requiring user input
    const testMessage = "Hello, how are you today? Can you tell me about your product or service?";
    
    // Validate that system prompt is set
    if (!config.systemPrompt.trim()) {
      toast({
        title: "System Prompt Required",
        description: "Please enter a system prompt before testing the AI chat.",
        variant: "destructive",
      });
      return;
    }

    // Validate that LLM credentials are set
    if (!config.llmApiKey) {
      toast({
        title: "Missing API Key",
        description: "Please enter a valid LLM API key first.",
        variant: "destructive",
      });
      return;
    }

    setTestingLLMChat(true);
    setTestLLMResponse("");

    try {
      // Use provider name as is - we no longer need to map 'gemini' to 'google'
      const providerName = config.llmProvider.toLowerCase();

      console.log(`Testing LLM chat with provider: ${providerName}`);
      console.log(`Using system prompt: ${config.systemPrompt.substring(0, 100)}...`);
      console.log(`Test message: ${testMessage}`);

      const result = await configApi.testLLMChat({
        provider: providerName,
        model: config.llmModel,
        prompt: `${config.systemPrompt}\n\nCustomer: ${testMessage}\nAI:`,
        temperature: config.temperature,
        apiKey: config.llmApiKey, // Pass the current API key from the input
      });

      if (result.success) {
        setTestLLMResponse(result.response.content);

        toast({
          title: "Test Successful",
          description: "The LLM responded successfully with your system prompt configuration.",
        });

        // Update LLM status to verified if successful
        setConfig((prev) => ({
          ...prev,
          llmStatus: "verified",
        }));

        // Persist the verification status to the server immediately
        try {
          // Get current configuration to preserve all providers
          const currentConfig = await configApi.getConfiguration();
          
          // Update only the tested provider's status while preserving others
          const updatedProviders = currentConfig.llmConfig.providers.map((provider: any) => {
            if (provider.name === config.llmProvider) {
              return {
                ...provider,
                status: "verified",
                lastVerified: new Date().toISOString(),
                apiKey: config.llmApiKey,
              };
            }
            return provider;
          });

          const quickUpdateConfig = {
            llmConfig: {
              ...currentConfig.llmConfig,
              providers: updatedProviders
            }
          };
          
          await configApi.updateConfiguration(quickUpdateConfig);
          console.log("Verification status saved to server successfully");
        } catch (saveError) {
          console.warn("Failed to save verification status to server:", saveError);
          // Don't show error to user as the test was successful
        }
      } else {
        toast({
          title: "Test Failed",
          description:
            result.message ||
            "Failed to get a response from the LLM. Please check your configuration.",
          variant: "destructive",
        });

        // Update LLM status to failed
        setConfig((prev) => ({
          ...prev,
          llmStatus: "failed",
        }));

        // Persist the failed status to the server
        try {
          // Get current configuration to preserve all providers
          const currentConfig = await configApi.getConfiguration();
          
          // Update only the tested provider's status while preserving others
          const updatedProviders = currentConfig.llmConfig.providers.map((provider: any) => {
            if (provider.name === config.llmProvider) {
              return {
                ...provider,
                status: "failed",
                apiKey: config.llmApiKey,
              };
            }
            return provider;
          });

          const quickUpdateConfig = {
            llmConfig: {
              ...currentConfig.llmConfig,
              providers: updatedProviders
            }
          };
          
          await configApi.updateConfiguration(quickUpdateConfig);
        } catch (saveError) {
          console.warn("Failed to save failed status to server:", saveError);
        }
      }
    } catch (error: any) {
      console.error("LLM chat test error:", error);
      setTestLLMResponse("");
      toast({
        title: "Test Error",
        description:
          error.message || "An error occurred while testing the LLM.",
        variant: "destructive",
      });

      // Update LLM status to failed
      setConfig((prev) => ({
        ...prev,
        llmStatus: "failed",
      }));

      // Persist the failed status to the server
      try {
        // Get current configuration to preserve all providers
        const currentConfig = await configApi.getConfiguration();
        
        // Update only the tested provider's status while preserving others
        const updatedProviders = currentConfig.llmConfig.providers.map((provider: any) => {
          if (provider.name === config.llmProvider) {
            return {
              ...provider,
              status: "failed",
              apiKey: config.llmApiKey,
            };
          }
          return provider;
        });

        const quickUpdateConfig = {
          llmConfig: {
            ...currentConfig.llmConfig,
            providers: updatedProviders
          }
        };
        
        await configApi.updateConfiguration(quickUpdateConfig);
      } catch (saveError) {
        console.warn("Failed to save failed status to server:", saveError);
      }
    } finally {
      setTestingLLMChat(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-center">
          <Settings className="h-8 w-8 animate-spin mx-auto mb-2" />
          <p>Loading configuration...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col space-y-4 sm:flex-row sm:justify-between sm:items-center sm:space-y-0">
        <div className="min-w-0 flex-shrink-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">
            Configuration
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Configure your AI calling system settings
          </p>
        </div>
        <div className="flex flex-row gap-2 flex-wrap">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? (
              <Save className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Configuration
          </Button>
        </div>
      </div>

      {/* Status Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">
                Voice Provider
              </CardTitle>
              <HoverCard>
                <HoverCardTrigger asChild>
                  <button className="h-5 w-5 text-muted-foreground hover:text-foreground">
                    <Info className="h-4 w-4" />
                  </button>
                </HoverCardTrigger>
                <HoverCardContent className="w-80">
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Voice Provider</h4>
                    <p className="text-sm text-muted-foreground">
                      The AI voice synthesis service used to generate
                      natural-sounding speech for phone calls. ElevenLabs
                      provides high-quality voice synthesis with advanced
                      expression capabilities.
                    </p>
                  </div>
                </HoverCardContent>
              </HoverCard>
            </div>
            <Volume2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">
              {config.voiceProvider}
            </div>
            <Badge variant="outline" className="mt-1">
              {config.elevenLabsStatus === "verified" ? (
                <>
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Connected
                </>
              ) : config.elevenLabsStatus === "failed" ? (
                <>
                  <AlertTriangle className="h-3 w-3 mr-1 text-red-500" />
                  Failed
                </>
              ) : config.elevenLabsApiKey ? (
                <>
                  <AlertTriangle className="h-3 w-3 mr-1 text-yellow-500" />
                  Unverified
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Not Set
                </>
              )}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">
                STT Provider
              </CardTitle>
              <HoverCard>
                <HoverCardTrigger asChild>
                  <button className="h-5 w-5 text-muted-foreground hover:text-foreground">
                    <Info className="h-4 w-4" />
                  </button>
                </HoverCardTrigger>
                <HoverCardContent className="w-80">
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">STT Provider</h4>
                    <p className="text-sm text-muted-foreground">
                      The Speech-to-Text service used to transcribe customer
                      speech during phone calls. Deepgram provides high-accuracy,
                      low-latency transcription with advanced noise handling
                      capabilities for real-time conversations.
                    </p>
                  </div>
                </HoverCardContent>
              </HoverCard>
            </div>
            <Mic className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {config.deepgramEnabled ? "Deepgram" : "OpenAI Whisper"}
            </div>
            <Badge variant="outline" className="mt-1">
              {config.deepgramEnabled ? (
                config.deepgramStatus === "verified" ? (
                  <>
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Connected
                  </>
                ) : config.deepgramStatus === "failed" ? (
                  <>
                    <AlertTriangle className="h-3 w-3 mr-1 text-red-500" />
                    Failed
                  </>
                ) : config.deepgramApiKey ? (
                  <>
                    <AlertTriangle className="h-3 w-3 mr-1 text-yellow-500" />
                    Unverified
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    Not Set
                  </>
                )
              ) : (
                <>
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Fallback Active
                </>
              )}
            </Badge>
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
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">LLM Provider</h4>
                    <p className="text-sm text-muted-foreground">
                      The Large Language Model provider that powers the AI's
                      conversation abilities. This includes understanding
                      customer responses, generating appropriate replies, and
                      handling objections during calls.
                    </p>
                  </div>
                </HoverCardContent>
              </HoverCard>
            </div>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">
              {config.llmProvider}
            </div>
            <Badge variant="outline" className="mt-1">
              {config.llmStatus === "verified" ? (
                <>
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Connected
                </>
              ) : config.llmStatus === "failed" ? (
                <>
                  <AlertTriangle className="h-3 w-3 mr-1 text-red-500" />
                  Failed
                </>
              ) : config.llmApiKey ? (
                <>
                  <AlertTriangle className="h-3 w-3 mr-1 text-yellow-500" />
                  Unverified
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Not Set
                </>
              )}
            </Badge>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-sm font-medium">
                Phone Service
              </CardTitle>
              <HoverCard>
                <HoverCardTrigger asChild>
                  <button className="h-5 w-5 text-muted-foreground hover:text-foreground">
                    <Info className="h-4 w-4" />
                  </button>
                </HoverCardTrigger>
                <HoverCardContent className="w-80">
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Phone Service</h4>
                    <p className="text-sm text-muted-foreground">
                      The telephony service used to make outbound phone calls.
                      Twilio provides reliable call connectivity, call routing,
                      and phone number management for the AI calling system.
                    </p>
                  </div>
                </HoverCardContent>
              </HoverCard>
            </div>
            <Phone className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">Twilio</div>
            <Badge variant="outline" className="mt-1">
              {config.twilioStatus === "verified" ? (
                <>
                  <CheckCircle className="h-3 w-3 mr-1" />
                  Connected
                </>
              ) : config.twilioStatus === "failed" ? (
                <>
                  <AlertTriangle className="h-3 w-3 mr-1 text-red-500" />
                  Failed
                </>
              ) : config.twilioAccountSid ? (
                <>
                  <AlertTriangle className="h-3 w-3 mr-1 text-yellow-500" />
                  Unverified
                </>
              ) : (
                <>
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Not Set
                </>
              )}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* AI Voice Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="flex items-center gap-2">
              <Volume2 className="h-5 w-5" />
              AI Voice Settings
            </CardTitle>
            <HoverCard>
              <HoverCardTrigger asChild>
                <button className="h-5 w-5 text-muted-foreground hover:text-foreground">
                  <Info className="h-4 w-4" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent className="w-80">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">AI Voice Settings</h4>
                  <p className="text-sm text-muted-foreground">
                    Configure voice synthesis parameters including provider,
                    voice selection, speed, stability, and clarity. These
                    settings control how natural and expressive the AI voice
                    sounds during phone conversations.
                  </p>
                </div>
              </HoverCardContent>
            </HoverCard>
          </div>
          <CardDescription>
            Configure the voice synthesis for your AI calls
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="voiceProvider">Voice Provider</Label>
              <Select
                value={config.voiceProvider}
                onValueChange={(value) => updateConfig("voiceProvider", value)}
              >
                <SelectTrigger
                  id="voiceProvider"
                  className="w-full h-10 rounded-xl"
                >
                  <SelectValue placeholder="Select voice provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="elevenlabs">ElevenLabs</SelectItem>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="google">Google Cloud</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="voiceId">Voice</Label>
              <Select
                value={config.voiceId}
                onValueChange={(value) => updateConfig("voiceId", value)}
              >
                <SelectTrigger id="voiceId" className="w-full h-10 rounded-xl">
                  <SelectValue placeholder="Select a voice" />
                </SelectTrigger>
                <SelectContent>
                  {availableVoices && availableVoices.length > 0 ? (
                    availableVoices.map((voice) => (
                      <SelectItem key={voice.voiceId} value={voice.voiceId}>
                        {voice.name}
                      </SelectItem>
                    ))
                  ) : (
                    <p className="p-2 text-sm text-muted-foreground text-center">
                      No voices available. Check provider & API key.
                    </p>
                  )}
                </SelectContent>
              </Select>
            </div>
            {config.voiceProvider === "elevenlabs" && (
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <Label htmlFor="elevenLabsApiKey">ElevenLabs API Key</Label>
                  {config.elevenLabsApiKey && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDeleteItem("elevenlabs")}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      Delete Key
                    </Button>
                  )}
                </div>
                <PasswordInput
                  id="elevenLabsApiKey"
                  value={config.elevenLabsApiKey}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    updateConfig("elevenLabsApiKey", e.target.value)
                  }
                  placeholder="Enter your ElevenLabs API key"
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="voiceSpeed">
                Voice Speed ({config.voiceSpeed}x)
              </Label>
              <Slider
                id="voiceSpeed"
                min={0.5}
                max={2.0}
                step={0.1}
                value={[config.voiceSpeed]}
                onValueChange={(value) => updateConfig("voiceSpeed", value[0])}
                className="py-4"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voiceStability">
                Voice Stability ({Math.round(config.voiceStability * 100)}%)
              </Label>
              <Slider
                id="voiceStability"
                min={0}
                max={1}
                step={0.1}
                value={[config.voiceStability]}
                onValueChange={(value) =>
                  updateConfig("voiceStability", value[0])
                }
                className="py-4"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="voiceClarity">
                Voice Clarity ({Math.round(config.voiceClarity * 100)}%)
              </Label>
              <Slider
                id="voiceClarity"
                min={0}
                max={1}
                step={0.1}
                value={[config.voiceClarity]}
                onValueChange={(value) =>
                  updateConfig("voiceClarity", value[0])
                }
                className="py-4"
              />
            </div>
          </div>
          
          {config.voiceProvider === "elevenlabs" && (
            <div className="flex items-center space-x-2 mt-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="useFlashModel"
                  checked={config.useFlashModel}
                  onCheckedChange={(checked) => updateConfig("useFlashModel", checked)}
                />
                <Label htmlFor="useFlashModel" className="cursor-pointer">
                  Use ElevenLabs Flash v2.5 for ultra-low latency (~75ms)
                </Label>
              </div>
              <HoverCard>
                <HoverCardTrigger asChild>
                  <button className="h-5 w-5 text-muted-foreground hover:text-foreground">
                    <Info className="h-4 w-4" />
                  </button>
                </HoverCardTrigger>
                <HoverCardContent className="w-80">
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold">Flash v2.5 Model</h4>
                    <p className="text-sm text-muted-foreground">
                      ElevenLabs Flash v2.5 (eleven_turbo_v2) is an ultra-low latency model optimized for real-time conversations.
                      It provides much faster response times (around 75ms) compared to standard models,
                      which significantly improves the natural flow of conversations.
                    </p>
                  </div>
                </HoverCardContent>
              </HoverCard>
            </div>
          )}
          
          <Button
            variant="outline"
            size="sm"
            onClick={handleTestVoice}
            disabled={testingVoice}
          >
            {testingVoice ? (
              <Mic className="h-4 w-4 mr-2 animate-pulse" />
            ) : (
              <Mic className="h-4 w-4 mr-2" />
            )}
            {testingVoice ? "Testing..." : "Test Voice"}
          </Button>
          <div className="text-xs text-muted-foreground mt-2">
            Make sure you've entered a valid API key and voice ID before
            testing. Voice IDs can be found in your ElevenLabs dashboard.
          </div>
        </CardContent>
      </Card>

      {/* Speech Recognition Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mic className="h-5 w-5" />
            Speech Recognition
            <HoverCard>
              <HoverCardTrigger asChild>
                <button className="ml-1 h-5 w-5 text-muted-foreground hover:text-foreground transition-colors">
                  <Info className="h-5 w-5" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent className="w-80">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Speech Recognition</h4>
                  <p className="text-sm text-muted-foreground">
                    Configure Deepgram Nova-2 for high-accuracy, low-latency speech-to-text services.
                    Nova-2 provides significantly better transcription quality and reduced latency
                    compared to other STT services.
                  </p>
                </div>
              </HoverCardContent>
            </HoverCard>
          </CardTitle>
          <CardDescription>
            Configure speech-to-text services for your AI calls
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2 lg:col-span-1">
              <div className="flex justify-between items-center">
                <Label htmlFor="deepgramApiKey">Deepgram API Key</Label>
                {config.deepgramApiKey && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteItem("deepgram")}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete Key
                  </Button>
                )}
              </div>
              <PasswordInput
                id="deepgramApiKey"
                value={config.deepgramApiKey}
                onChange={(e) => updateConfig("deepgramApiKey", e.target.value)}
                placeholder="Enter your Deepgram API key"
              />
            </div>
            <div className="space-y-2 lg:col-span-1">
              <Label htmlFor="deepgramModel">Model</Label>
              <Select
                value={config.deepgramModel}
                onValueChange={(value) => updateConfig("deepgramModel", value)}
              >
                <SelectTrigger id="deepgramModel" className="w-full h-10 rounded-xl">
                  <SelectValue placeholder="Select a model" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="nova-2">Nova-2 (Recommended)</SelectItem>
                  <SelectItem value="nova">Nova</SelectItem>
                  <SelectItem value="enhanced">Enhanced</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 mt-4">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="deepgramEnabled"
                checked={config.deepgramEnabled}
                onCheckedChange={(checked) => updateConfig("deepgramEnabled", checked)}
              />
              <Label htmlFor="deepgramEnabled" className="cursor-pointer">
                Enable Deepgram for speech recognition (falls back to OpenAI Whisper if disabled)
              </Label>
            </div>
          </div>
          
          <div className="text-xs text-muted-foreground mt-2">
            Deepgram Nova-2 provides higher accuracy and lower latency than OpenAI Whisper for speech recognition.
          </div>
        </CardContent>
      </Card>

      {/* Phone Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Phone Integration
            <HoverCard>
              <HoverCardTrigger asChild>
                <button className="ml-1 h-5 w-5 text-muted-foreground hover:text-foreground transition-colors">
                  <Info className="h-5 w-5" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent className="w-80">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Phone Integration</h4>
                  <p className="text-sm text-muted-foreground">
                    Configure Twilio telephony service for making outbound
                    calls. This includes account credentials and phone number
                    settings for call routing and delivery.
                  </p>
                </div>
              </HoverCardContent>
            </HoverCard>
          </CardTitle>
          <CardDescription>
            Configure Twilio settings for making calls
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="twilioAccountSid">Twilio Account SID</Label>
                {config.twilioAccountSid && config.twilioAuthToken && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteItem("twilio")}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete Keys
                  </Button>
                )}
              </div>
              <PasswordInput
                id="twilioAccountSid"
                value={config.twilioAccountSid}
                onChange={(e) =>
                  updateConfig("twilioAccountSid", e.target.value)
                }
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="twilioAuthToken">Twilio Auth Token</Label>
              <PasswordInput
                id="twilioAuthToken"
                value={config.twilioAuthToken}
                onChange={(e) =>
                  updateConfig("twilioAuthToken", e.target.value)
                }
                placeholder="your-auth-token"
              />
            </div>
            <div className="space-y-2 lg:col-span-1">
              <Label htmlFor="twilioPhoneNumber">Twilio Phone Number</Label>
              <Input
                id="twilioPhoneNumber"
                value={config.twilioPhoneNumber}
                onChange={(e) =>
                  updateConfig("twilioPhoneNumber", e.target.value)
                }
                placeholder="+1234567890"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpenTestCallDialog(true)}
              disabled={
                !config.twilioAccountSid ||
                !config.twilioAuthToken ||
                !config.twilioPhoneNumber ||
                testingCall
              }
            >
              {testingCall ? (
                <PhoneCall className="h-4 w-4 mr-2 animate-pulse" />
              ) : (
                <PhoneCall className="h-4 w-4 mr-2" />
              )}
              {testingCall ? "Making Call..." : "Test Call"}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Make sure you've entered valid Twilio credentials and a phone number
            before testing.
          </div>
        </CardContent>
      </Card>

      {/* AI Model Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            AI Model Configuration
            <HoverCard>
              <HoverCardTrigger asChild>
                <button className="ml-1 h-5 w-5 text-muted-foreground hover:text-foreground transition-colors">
                  <Info className="h-5 w-5" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent className="w-80">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">
                    AI Model Configuration
                  </h4>
                  <p className="text-sm text-muted-foreground">
                    Configure the Large Language Model (LLM) provider and
                    settings that power conversation intelligence. Includes
                    model selection, response parameters, and system prompts.
                  </p>
                </div>
              </HoverCardContent>
            </HoverCard>
          </CardTitle>
          <CardDescription>
            Configure the language model for conversations
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="llmProvider">LLM Provider</Label>
              <Select
                value={config.llmProvider}
                onValueChange={(value) =>
                  handleProviderChange(
                    value as "openai" | "anthropic" | "google"
                  )
                }
              >
                <SelectTrigger
                  id="llmProvider"
                  className="w-full h-10 rounded-xl"
                >
                  <SelectValue placeholder="Select LLM provider" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="openai">OpenAI</SelectItem>
                  <SelectItem value="anthropic">Anthropic</SelectItem>
                  <SelectItem value="google">Google AI</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="llmModel">Model</Label>
              <Select
                value={config.llmModel}
                onValueChange={(value) => updateConfig("llmModel", value)}
              >
                <SelectTrigger id="llmModel" className="w-full h-10 rounded-xl">
                  <SelectValue placeholder="Select a model">
                    {config.llmModel && availableModels[config.llmProvider] ? (
                      <span className="font-medium">
                        {availableModels[config.llmProvider].find(
                          (model) => model.id === config.llmModel
                        )?.name || config.llmModel}
                      </span>
                    ) : (
                      "Select a model"
                    )}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {loadingModels ? (
                    <SelectItem value="" disabled>
                      Loading models...
                    </SelectItem>
                  ) : availableModels[config.llmProvider]?.length > 0 ? (
                    availableModels[config.llmProvider].map((model) => (
                      <SelectItem key={model.id} value={model.id}>
                        <div className="flex flex-col">
                          <span className="font-medium">{model.name}</span>
                          {model.description && (
                            <span className="text-xs text-muted-foreground truncate max-w-[300px]">
                              {model.description}
                            </span>
                          )}
                          {model.pricing && (
                            <span className="text-xs text-muted-foreground">
                              Input: ${model.pricing.input}/1K tokens, Output: $
                              {model.pricing.output}/1K tokens
                            </span>
                          )}
                        </div>
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="" disabled>
                      {config.llmApiKey
                        ? "No models available"
                        : "Enter API key to see available models"}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="llmApiKey">API Key</Label>
                {config.llmApiKey && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteItem("llm", config.llmProvider)}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete Key
                  </Button>
                )}
              </div>
              <PasswordInput
                id="llmApiKey"
                value={config.llmApiKey}
                onChange={(e) => handleApiKeyChange(e.target.value)}
                placeholder="sk-..."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="temperature">
                Temperature ({config.temperature})
              </Label>
              <Slider
                id="temperature"
                min={0}
                max={1}
                step={0.1}
                value={[config.temperature]}
                onValueChange={(value) => updateConfig("temperature", value[0])}
                className="py-4"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="systemPrompt">System Prompt</Label>
            <Textarea
              id="systemPrompt"
              value={config.systemPrompt}
              onChange={(e) => updateConfig("systemPrompt", e.target.value)}
              rows={8}
              placeholder="Enter the system prompt for your AI assistant..."
              className="min-h-[120px] sm:min-h-[200px]"
            />
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpenTestLLMChatDialog(true)}
              disabled={!config.llmApiKey || testingLLMChat}
            >
              {testingLLMChat ? (
                <MessageSquare className="h-4 w-4 mr-2 animate-pulse" />
              ) : (
                <MessageSquare className="h-4 w-4 mr-2" />
              )}
              {testingLLMChat ? "Testing..." : "Test AI Chat"}
            </Button>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Test your LLM configuration with a sample prompt to ensure it's
            working correctly.
          </div>
        </CardContent>
      </Card>

      {/* Call Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Call Settings
            <HoverCard>
              <HoverCardTrigger asChild>
                <button className="ml-1 h-5 w-5 text-muted-foreground hover:text-foreground transition-colors">
                  <Info className="h-5 w-5" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent className="w-80">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Call Settings</h4>
                  <p className="text-sm text-muted-foreground">
                    Configure call behavior parameters including maximum
                    duration, retry logic, and timezone settings for optimal
                    call management and scheduling.
                  </p>
                </div>
              </HoverCardContent>
            </HoverCard>
          </CardTitle>
          <CardDescription>
            Configure call behavior and retry logic
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="maxCallDuration">
                Max Call Duration (seconds)
              </Label>
              <Input
                id="maxCallDuration"
                type="number"
                value={config.maxCallDuration}
                onChange={(e) =>
                  updateConfig("maxCallDuration", parseInt(e.target.value))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retryAttempts">Retry Attempts</Label>
              <Input
                id="retryAttempts"
                type="number"
                value={config.retryAttempts}
                onChange={(e) =>
                  updateConfig("retryAttempts", parseInt(e.target.value))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="retryDelay">Retry Delay (seconds)</Label>
              <Input
                id="retryDelay"
                type="number"
                value={config.retryDelay}
                onChange={(e) =>
                  updateConfig("retryDelay", parseInt(e.target.value))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="timeZone">Time Zone</Label>
              <Select
                value={config.timeZone}
                onValueChange={(value) => updateConfig("timeZone", value)}
              >
                <SelectTrigger id="timeZone" className="w-full h-10 rounded-xl">
                  <SelectValue placeholder="Select time zone" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="America/New_York">Eastern Time</SelectItem>
                  <SelectItem value="America/Chicago">Central Time</SelectItem>
                  <SelectItem value="America/Denver">Mountain Time</SelectItem>
                  <SelectItem value="America/Los_Angeles">
                    Pacific Time
                  </SelectItem>
                  <SelectItem value="UTC">UTC</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Webhook Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Webhook Integration
            <HoverCard>
              <HoverCardTrigger asChild>
                <button className="ml-1 h-5 w-5 text-muted-foreground hover:text-foreground transition-colors">
                  <Info className="h-5 w-5" />
                </button>
              </HoverCardTrigger>
              <HoverCardContent className="w-80">
                <div className="space-y-2">
                  <h4 className="text-sm font-semibold">Webhook Integration</h4>
                  <p className="text-sm text-muted-foreground">
                    Configure webhook endpoints to receive real-time
                    notifications about call events, status updates, and
                    completion data for external system integration.
                  </p>
                </div>
              </HoverCardContent>
            </HoverCard>
          </CardTitle>
          <CardDescription>
            Configure webhook secret for receiving call events. The webhook base URL is configured via the WEBHOOK_BASE_URL environment variable in the server.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-2 lg:col-span-2">
              <div className="flex justify-between items-center">
                <Label htmlFor="webhookSecret">Webhook Secret</Label>
                {config.webhookSecret && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleDeleteItem("webhook")}
                    className="text-red-500 hover:text-red-700"
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Delete Secret
                  </Button>
                )}
              </div>
              <PasswordInput
                id="webhookSecret"
                value={config.webhookSecret}
                onChange={(e) => updateConfig("webhookSecret", e.target.value)}
                placeholder="Enter your webhook secret key"
              />
              <div className="text-xs text-muted-foreground mt-2">
                The webhook secret is used to verify that requests are coming
                from our service.
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Deletion</AlertDialogTitle>
            <AlertDialogDescription>
              {itemToDelete?.type === "twilio" &&
                "Are you sure you want to delete your Twilio configuration?"}
              {itemToDelete?.type === "elevenlabs" &&
                "Are you sure you want to delete your ElevenLabs configuration?"}
              {itemToDelete?.type === "deepgram" &&
                "Are you sure you want to delete your Deepgram API key?"}
              {itemToDelete?.type === "llm" &&
                `Are you sure you want to delete your ${itemToDelete.name} API key?`}
              {itemToDelete?.type === "webhook" &&
                "Are you sure you want to delete your Webhook secret?"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-red-500 hover:bg-red-600 text-white"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Test Call Dialog */}
      <AlertDialog
        open={openTestCallDialog}
        onOpenChange={setOpenTestCallDialog}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make Test Call</AlertDialogTitle>
            <AlertDialogDescription>
              This will make a test call using your Twilio configuration. Enter
              the phone number that should receive the test call.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="testCallNumber">Phone Number to Call</Label>
              <Input
                id="testCallNumber"
                placeholder="+1234567890"
                value={testCallNumber}
                onChange={(e) => setTestCallNumber(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Enter a phone number in E.164 format (e.g., +1234567890)
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="testCallMessage">Test Message (Optional)</Label>
              <Textarea
                id="testCallMessage"
                placeholder="This is a test call from your AI calling system."
                value={testCallMessage}
                onChange={(e) => setTestCallMessage(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleTestCall} disabled={testingCall}>
              {testingCall ? "Making Call..." : "Make Test Call"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Test LLM Chat Dialog */}
      <AlertDialog
        open={openTestLLMChatDialog}
        onOpenChange={setOpenTestLLMChatDialog}
      >
        <AlertDialogContent className="max-w-3xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Test AI Chat</AlertDialogTitle>
            <AlertDialogDescription>
              Test your AI model with your current system prompt configuration. 
              This will send a sample customer message to see how the AI responds with your configured personality.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Test Scenario</Label>
              <div className="border rounded-md p-3 bg-muted/50 text-sm">
                <strong>Customer Message:</strong> "Hello, how are you today? Can you tell me about your product or service?"
              </div>
              <p className="text-xs text-muted-foreground">
                The AI will respond to this customer message using your configured system prompt and personality settings.
              </p>
            </div>

            {testLLMResponse && (
              <div className="space-y-2 mt-4">
                <Label>AI Response</Label>
                <div className="border rounded-md p-3 bg-background text-foreground whitespace-pre-wrap">
                  {testLLMResponse}
                </div>
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Close</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleTestLLMChat}
              disabled={testingLLMChat}
            >
              {testingLLMChat ? "Testing..." : "Test AI Response"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Configuration;

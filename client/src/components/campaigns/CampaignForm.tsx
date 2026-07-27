import React, { useState, useEffect, useRef } from "react";
import { X, Plus } from "lucide-react";
import {
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import api from "@/services/api";
import { configApi } from "@/services/configApi";
import { toast } from "@/hooks/useToast";

// Custom styles with consistent spacing
const textareaStyles =
  "w-full rounded-xl border border-input bg-background px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 min-h-[100px]";
const labelStyles = "block text-sm font-medium mb-2";

// Define Props
interface CampaignFormProps {
  campaignId?: string;
  onClose: () => void;
  onSuccess: () => void;
}

// Define the form data structure
interface CampaignFormData {
  name: string;
  description: string;
  goal: string;
  targetAudience: string;
  leadSources: string[];
  primaryLanguage: string;
  supportedLanguages: string[];
  startDate: Date | undefined;
  endDate: Date | undefined;
  script: {
    name: string;
    content: string;
  };
  openingMessage: string;
  transferPhoneNumber: string;
  callTiming: {
    daysOfWeek: string[];
    startTime: string;
    endTime: string;
    timeZone: string;
  };
  llmConfiguration: {
    model: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
  };
  voiceConfiguration: {
    provider: string;
    voiceId: string;
    speed: number;
    pitch: number;
  };
  budget: {
    maxCostPerCall: number;
    totalBudget: number;
  };
}

interface VoiceOption {
  voiceId: string;
  name: string;
}

const AURA_DEFAULT_VOICE = "aura-2-thalia-en";

const selectDeepgramVoice = (
  voices: VoiceOption[],
  currentVoiceId?: string,
  configuredVoiceId?: string,
  preserveCurrentWithoutCatalog = false
) => {
  if (voices.length === 0) {
    return preserveCurrentWithoutCatalog ? currentVoiceId || "" : "";
  }

  const availableVoiceIds = new Set(voices.map((voice) => voice.voiceId));

  if (currentVoiceId && availableVoiceIds.has(currentVoiceId)) {
    return currentVoiceId;
  }

  if (configuredVoiceId && availableVoiceIds.has(configuredVoiceId)) {
    return configuredVoiceId;
  }

  if (availableVoiceIds.has(AURA_DEFAULT_VOICE)) {
    return AURA_DEFAULT_VOICE;
  }

  return voices[0]?.voiceId || "";
};

// Initial form state
const initialFormState: CampaignFormData = {
  name: "",
  description: "",
  goal: "",
  targetAudience: "",
  leadSources: [""],
  primaryLanguage: "English",
  supportedLanguages: ["English"],
  startDate: new Date(), // Always initialize with current date
  endDate: undefined,
  script: {
    name: "Primary Script",
    content: "",
  },
  openingMessage: "",
  transferPhoneNumber: "",
  callTiming: {
    daysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    startTime: "09:00",
    endTime: "17:00",
    timeZone: "Asia/Kolkata",
  },
  llmConfiguration: {
    model: "",
    systemPrompt:
      "You are an AI assistant making a call on behalf of a company. Be professional, friendly, and helpful.",
    temperature: 0.7,
    maxTokens: 500,
  },
  voiceConfiguration: {
    provider: "deepgram",
    voiceId: "", // Will be set from system configuration during form load
    speed: 1.0,
    pitch: 1.0,
  },
  budget: {
    maxCostPerCall: 2.0,
    totalBudget: 1000.0,
  },
};

// Language options
const languages = [
  "English",
  "Hindi",
  "Tamil",
  "Telugu",
  "Marathi",
  "Kannada",
  "Bengali",
  "Gujarati",
];

const CampaignForm = ({
  campaignId,
  onClose,
  onSuccess,
}: CampaignFormProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<CampaignFormData>(initialFormState);
  const [currentTab, setCurrentTab] = useState<"basic" | "script" | "ai">(
    "basic"
  );
  const [systemConfig, setSystemConfig] = useState<any>(null);
  const [availableVoices, setAvailableVoices] = useState<
    Record<string, VoiceOption[]>
  >({});
  const [loadingVoices, setLoadingVoices] = useState<{
    [key: string]: boolean;
  }>({});
  const originalVoiceProviderRef = useRef<string | null>(null);

  // Toast function for notifications
  const showToast = (
    title: string,
    description: string,
    variant: "default" | "destructive" = "default"
  ) => {
    toast({
      title,
      description,
      variant,
    });
  };

  // Load campaign data if editing
  const loadCampaignData = async () => {
    if (!campaignId) return;
    originalVoiceProviderRef.current = null;

    try {
      setIsLoading(true);
      // Real API call to fetch campaign data
      const response = await api.get(`/campaigns/${campaignId}`);
      const campaignData = response.data;
      originalVoiceProviderRef.current =
        campaignData.voiceConfiguration?.provider || null;

      // Map API data to form structure
      const formattedData = {
        ...initialFormState,
        name: campaignData.name,
        description: campaignData.description,
        goal: campaignData.goal,
        targetAudience: campaignData.targetAudience,
        leadSources: campaignData.leadSources || [""],
        primaryLanguage: campaignData.primaryLanguage,
        supportedLanguages: campaignData.supportedLanguages || [
          campaignData.primaryLanguage,
        ],
        startDate: campaignData.startDate
          ? new Date(campaignData.startDate)
          : new Date(),
        endDate: campaignData.endDate
          ? new Date(campaignData.endDate)
          : undefined,
        script: {
          name: campaignData.script?.versions?.[0]?.name || "Primary Script",
          content: campaignData.script?.versions?.[0]?.content || "",
        },
        openingMessage: campaignData.openingMessage || "",
        transferPhoneNumber: campaignData.transferPhoneNumber || "",
        callTiming: {
          daysOfWeek: campaignData.callTiming?.daysOfWeek || [
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
          ],
          startTime: campaignData.callTiming?.startTime || "09:00",
          endTime: campaignData.callTiming?.endTime || "17:00",
          timeZone: campaignData.callTiming?.timeZone || "Asia/Kolkata",
        },
        llmConfiguration: {
          model: campaignData.llmConfiguration?.model || "",
          systemPrompt:
            campaignData.llmConfiguration?.systemPrompt ||
            "You are an AI assistant making a call on behalf of a company. Be professional, friendly, and helpful.",
          temperature: campaignData.llmConfiguration?.temperature || 0.7,
          maxTokens: campaignData.llmConfiguration?.maxTokens || 500,
        },
        voiceConfiguration: {
          provider: "deepgram",
          voiceId: campaignData.voiceConfiguration?.voiceId || "",
          speed: campaignData.voiceConfiguration?.speed || 1.0,
          pitch: campaignData.voiceConfiguration?.pitch || 1.0,
        },
        budget: {
          maxCostPerCall: campaignData.budget?.maxCostPerCall ?? 2.0,
          totalBudget: campaignData.budget?.totalBudget ?? 1000.0,
        },
      };

      setFormData(formattedData);
      setIsLoading(false);
    } catch (error) {
      console.error("Error loading campaign data:", error);
      showToast("Error", "Failed to load campaign data.", "destructive");
      setIsLoading(false);
    }
  };

  // Load system configuration
  // Load voices for a specific TTS provider
  const loadVoicesForProvider = async (provider: string) => {
    console.log(`Loading voices for provider: ${provider}`);

    if (provider !== "deepgram") {
      return [];
    }

    // Set loading state
    setLoadingVoices((prev) => ({ ...prev, [provider]: true }));

    try {
      let voices: VoiceOption[] = [];

      try {
        const result = await configApi.getVoiceOptions();
        if (Array.isArray(result.voices)) {
          voices = result.voices.map(
            (voice: { value: string; name: string }) => ({
              voiceId: voice.value,
              name: voice.name,
            })
          );
        }
      } catch (error) {
        console.error("Error loading Deepgram TTS voices:", error);
      }

      // Update the voices map for this provider
      setAvailableVoices((prev) => ({
        ...prev,
        [provider]: voices,
      }));

      return voices;
    } catch (error) {
      console.error(`Error loading voices for ${provider}:`, error);
      return [];
    } finally {
      // Clear loading state
      setLoadingVoices((prev) => ({ ...prev, [provider]: false }));
    }
  };

  const loadSystemConfiguration = async () => {
    try {
      setIsLoading(true);
      const config = await configApi.getConfiguration();
      const [llmOptionsResult, voiceOptionsResult] = await Promise.allSettled([
        configApi.getLLMOptions(),
        configApi.getVoiceOptions(),
      ]);
      const llmOptions =
        llmOptionsResult.status === "fulfilled"
          ? llmOptionsResult.value
          : { providers: [] };
      const voiceOptions =
        voiceOptionsResult.status === "fulfilled"
          ? voiceOptionsResult.value
          : { voices: [] };
      setSystemConfig(config);

      console.log("Loaded system configuration:", config);

      const deepgramVoices = Array.isArray(voiceOptions.voices)
        ? voiceOptions.voices.map(
            (voice: { value: string; name: string }) => ({
              voiceId: voice.value,
              name: voice.name,
            })
          )
        : [];
      setAvailableVoices((current) => ({
        ...current,
        deepgram: deepgramVoices,
      }));

      const providerInfo = llmOptions.providers?.find(
        (provider: { value?: string }) =>
          provider.value === config.llmConfig?.defaultProvider
      );
      const providerModels = Array.isArray(providerInfo?.models)
        ? providerInfo.models.flatMap(
            (model: { value?: string }) => model.value ? [model.value] : []
          )
        : [];

      // Only update form data if not editing an existing campaign
      if (!campaignId) {
        const bestProvider = "deepgram";
        const bestVoiceId = selectDeepgramVoice(
          deepgramVoices,
          undefined,
          config.deepgramConfig?.ttsVoice
        );

        // Determine best system prompt
        const bestSystemPrompt =
          config.generalSettings?.defaultSystemPrompt ||
          "You are an AI assistant making a call on behalf of a company. Be professional, friendly, and helpful.";

        // Determine best LLM model
        const bestModel =
          config.llmConfig?.defaultModel || providerModels[0] || "";

        // Ensure we have a valid date
        const today = new Date();

        // Set all form data in a single update to avoid race conditions
        setFormData((prev) => ({
          ...prev,
          startDate: today,
          llmConfiguration: {
            ...prev.llmConfiguration,
            model: bestModel,
            systemPrompt: bestSystemPrompt,
            temperature:
              config.llmConfig?.temperature ||
              prev.llmConfiguration.temperature,
            maxTokens:
              config.llmConfig?.maxTokens || prev.llmConfiguration.maxTokens,
          },
          voiceConfiguration: {
            ...prev.voiceConfiguration,
            provider: bestProvider,
            voiceId: bestVoiceId,
            speed: config.voiceConfig?.speed || prev.voiceConfiguration.speed,
            pitch: config.voiceConfig?.pitch || prev.voiceConfiguration.pitch,
          },
          callTiming: {
            ...prev.callTiming,
            timeZone:
              config.generalSettings?.defaultTimeZone ||
              prev.callTiming.timeZone,
          },
        }));

        // Log the important values to verify they're set
        console.log("Set required fields from system config:", {
          startDate: today,
          systemPrompt: bestSystemPrompt,
          voiceId: bestVoiceId,
          model: bestModel,
        });
      }

      setIsLoading(false);
    } catch (error) {
      console.error("Error loading system configuration:", error);

      // Set fallback values for required fields even if config loading fails
      if (!campaignId) {
        showToast(
          "Error",
          "Failed to load system configuration. Please check your system settings.",
          "destructive"
        );
        setFormData((prev) => ({
          ...prev,
          startDate: new Date(),
          llmConfiguration: {
            ...prev.llmConfiguration,
            systemPrompt:
              systemConfig?.generalSettings?.defaultSystemPrompt ||
              "You are an AI assistant making a call on behalf of a company.",
          },
          voiceConfiguration: {
            ...prev.voiceConfiguration,
            voiceId: "", // Don't use default-voice-id fallback
          },
        }));
      }

      showToast(
        "Warning",
        "Could not load system configuration. Using default settings.",
        "default"
      );
      setIsLoading(false);
    }
  };

  useEffect(() => {
    // Load system configuration first
    loadSystemConfiguration();

    // If editing, load campaign data
    if (campaignId) {
      loadCampaignData();
    }
  }, [campaignId]);

  // Load voices when selecting a different provider
  useEffect(() => {
    const provider = formData.voiceConfiguration.provider;
    if (provider && systemConfig) {
      loadVoicesForProvider(provider);
    }
  }, [formData.voiceConfiguration.provider]);

  useEffect(() => {
    if (!campaignId || !systemConfig) {
      return;
    }

    const deepgramVoices = availableVoices.deepgram || [];
    const originallyUsedDeepgram =
      originalVoiceProviderRef.current === "deepgram";
    const normalizedVoiceId = selectDeepgramVoice(
      deepgramVoices,
      originallyUsedDeepgram
        ? formData.voiceConfiguration.voiceId
        : undefined,
      systemConfig.deepgramConfig?.ttsVoice,
      originallyUsedDeepgram
    );

    if (
      formData.voiceConfiguration.provider === "deepgram" &&
      formData.voiceConfiguration.voiceId === normalizedVoiceId
    ) {
      return;
    }

    setFormData((previous) => ({
      ...previous,
      voiceConfiguration: {
        ...previous.voiceConfiguration,
        provider: "deepgram",
        voiceId: normalizedVoiceId,
      },
    }));
  }, [
    availableVoices.deepgram,
    campaignId,
    formData.voiceConfiguration.provider,
    formData.voiceConfiguration.voiceId,
    systemConfig,
  ]);

  // Handle TTS provider change
  const handleTTSProviderChange = async (provider: string) => {
    if (provider !== "deepgram") {
      return;
    }

    console.log("TTS provider changed to: deepgram");

    // Update form data immediately
    setFormData((prev: CampaignFormData) => ({
      ...prev,
      voiceConfiguration: {
        ...prev.voiceConfiguration,
        provider: "deepgram",
        voiceId: "", // Reset voice ID when provider changes
      },
    }));

    if (provider === "deepgram" && !systemConfig?.deepgramConfig?.apiKey) {
      toast({
        title: "Provider Not Configured",
        description:
          "Deepgram API key is not configured. Please add it in the Configuration page.",
        variant: "default",
      });
    }

    try {
      // Load voices for the new provider
      if (systemConfig) {
        setLoadingVoices((prev) => ({ ...prev, [provider]: true }));
        const voices = await loadVoicesForProvider("deepgram");

        // Auto-select first voice if available
        if (voices.length > 0) {
          setFormData((prev: CampaignFormData) => ({
            ...prev,
            voiceConfiguration: {
              ...prev.voiceConfiguration,
              voiceId: voices[0].voiceId,
            },
          }));
          console.log(
            `Auto-selected first voice: ${voices[0].name} (${voices[0].voiceId})`
          );
        } else {
          console.warn(`No voices found for provider: ${provider}`);

          // Show toast for no voices found
          toast({
            title: "No Voices Available",
            description: `No voices found for ${provider}. Please enter a voice ID manually or choose another provider.`,
            variant: "default",
          });
        }
      }
    } catch (error) {
      console.error(`Error loading voices for ${provider}:`, error);
      toast({
        title: "Error Loading Voices",
        description: `Failed to load voices for ${provider}. Please try again or enter a voice ID manually.`,
        variant: "destructive",
      });
    } finally {
      setLoadingVoices((prev) => ({ ...prev, [provider]: false }));
    }
  };

  // Update form data
  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    const { name, value } = e.target;

    if (name.includes(".")) {
      const [parent, child] = name.split(".");
      setFormData((prev: CampaignFormData) => ({
        ...prev,
        [parent]: {
          ...(prev[parent as keyof CampaignFormData] as any),
          [child]: value,
        },
      }));
    } else {
      setFormData((prev: CampaignFormData) => ({
        ...prev,
        [name]: value,
      }));
    }
  };

  // Handle lead sources
  const addLeadSource = () => {
    setFormData((prev: CampaignFormData) => ({
      ...prev,
      leadSources: [...prev.leadSources, ""],
    }));
  };

  const updateLeadSource = (index: number, value: string) => {
    setFormData((prev: CampaignFormData) => {
      const updatedSources = [...prev.leadSources];
      updatedSources[index] = value;
      return {
        ...prev,
        leadSources: updatedSources,
      };
    });
  };

  const removeLeadSource = (index: number) => {
    setFormData((prev: CampaignFormData) => {
      const updatedSources = [...prev.leadSources];
      updatedSources.splice(index, 1);
      return {
        ...prev,
        leadSources: updatedSources,
      };
    });
  };

  // Handle supported languages
  const handleLanguageChange = (language: string, checked: boolean) => {
    setFormData((prev: CampaignFormData) => {
      let updatedLanguages = [...prev.supportedLanguages];

      if (checked && !updatedLanguages.includes(language)) {
        updatedLanguages.push(language);
      } else if (!checked && updatedLanguages.includes(language)) {
        updatedLanguages = updatedLanguages.filter(
          (l: string) => l !== language
        );
      }

      return {
        ...prev,
        supportedLanguages: updatedLanguages,
      };
    });
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      setIsLoading(true);
      const originallyUsedDeepgram =
        !campaignId || originalVoiceProviderRef.current === "deepgram";
      const normalizedVoiceId = selectDeepgramVoice(
        availableVoices.deepgram || [],
        originallyUsedDeepgram
          ? formData.voiceConfiguration.voiceId
          : undefined,
        systemConfig?.deepgramConfig?.ttsVoice,
        Boolean(campaignId) && originallyUsedDeepgram
      );

      // Validate form data
      if (
        !formData.name ||
        !formData.description ||
        !formData.goal ||
        !formData.targetAudience
      ) {
        showToast(
          "Missing Required Fields",
          "Please fill in all required fields.",
          "destructive"
        );
        setIsLoading(false);
        return;
      }

      // Additional validation for required fields
      if (!normalizedVoiceId) {
        showToast(
          "Voice ID Required",
          "Please select an available Deepgram voice for the campaign.",
          "destructive"
        );
        setCurrentTab("ai");
        setIsLoading(false);
        return;
      }

      if (!formData.startDate) {
        showToast(
          "Start Date Required",
          "Please select a start date for the campaign.",
          "destructive"
        );
        setCurrentTab("basic");
        setIsLoading(false);
        return;
      }

      // Format script data correctly to match the server model
      const scriptData = {
        versions: [
          {
            name: formData.script.name || "Primary Script",
            content: formData.script.content || "",
            isActive: true,
          },
        ],
      };

      // Format dates for API submission - ensure all required fields have valid values
      const submissionData = {
        // Don't spread formData directly to avoid potential nested object issues
        name: formData.name,
        description: formData.description,
        goal: formData.goal,
        targetAudience: formData.targetAudience,
        leadSources: formData.leadSources,
        primaryLanguage: formData.primaryLanguage,
        supportedLanguages: formData.supportedLanguages,
        status: "Draft", // Default status for new campaigns
        script: scriptData,
        openingMessage: formData.openingMessage,
        transferPhoneNumber: formData.transferPhoneNumber,
        // Explicitly format date fields as strings
        // Explicitly format date fields as strings
        startDate:
          formData.startDate instanceof Date
            ? formData.startDate.toISOString()
            : new Date().toISOString(),
        endDate:
          formData.endDate instanceof Date
            ? formData.endDate.toISOString()
            : null,
        callTiming: {
          daysOfWeek: formData.callTiming.daysOfWeek,
          startTime: formData.callTiming.startTime,
          endTime: formData.callTiming.endTime,
          timeZone: formData.callTiming.timeZone,
        },
        llmConfiguration: {
          // The agent takes its LLM from the account-level provider config, not
          // from the campaign, but Campaign.llmConfiguration.model is a required
          // schema field - so keep sending a non-empty value.
          model:
            formData.llmConfiguration.model ||
            systemConfig?.llmConfig?.model ||
            "gpt-4o",
          // Ensure systemPrompt is always provided as a non-empty string
          systemPrompt:
            formData.llmConfiguration.systemPrompt ||
            "You are an AI assistant making a call on behalf of a company. Be professional, friendly, and helpful.",
          temperature: Number(formData.llmConfiguration.temperature) || 0.7,
          maxTokens: Number(formData.llmConfiguration.maxTokens) || 500,
        },
        voiceConfiguration: {
          provider: "deepgram",
          voiceId: normalizedVoiceId,
          speed: Number(formData.voiceConfiguration.speed) || 1.0,
          pitch: Number(formData.voiceConfiguration.pitch) || 1.0,
        },
        budget: {
          maxCostPerCall: Number(formData.budget.maxCostPerCall) || 2.0,
          totalBudget: Number(formData.budget.totalBudget) || 1000.0,
        },
      };

      // Debug log to verify required fields are present
      console.log("Critical fields check:", {
        startDate: submissionData.startDate,
        systemPrompt: submissionData.llmConfiguration.systemPrompt,
        voiceId: submissionData.voiceConfiguration.voiceId,
      });

      // Additional validation right before submission to catch any missing values
      if (!submissionData.startDate) {
        console.error("startDate is still missing after all validations");
        submissionData.startDate = new Date().toISOString();
      }

      if (!submissionData.llmConfiguration.systemPrompt) {
        console.error("systemPrompt is still missing after all validations");
        submissionData.llmConfiguration.systemPrompt =
          systemConfig?.generalSettings?.defaultSystemPrompt ||
          "You are an AI assistant making a call on behalf of a company.";
      }

      if (!submissionData.voiceConfiguration.voiceId) {
        console.error("voiceId is still missing after all validations");
        submissionData.voiceConfiguration.voiceId = normalizedVoiceId;
      }

      // Explicitly sanitize the submissionData to ensure it has the three required fields
      // These fields must be present as non-empty strings or the server will reject the request

      // 1. Ensure startDate is a valid ISO string
      if (
        typeof submissionData.startDate !== "string" ||
        !submissionData.startDate
      ) {
        submissionData.startDate = new Date().toISOString();
      }

      // 2. Ensure systemPrompt is a non-empty string
      if (!submissionData.llmConfiguration.systemPrompt) {
        submissionData.llmConfiguration.systemPrompt =
          systemConfig?.generalSettings?.defaultSystemPrompt ||
          "You are an AI assistant making a call on behalf of a company.";
      }

      // 3. Ensure voiceId is a non-empty Deepgram Aura voice.
      if (!submissionData.voiceConfiguration.voiceId) {
        submissionData.voiceConfiguration.voiceId = normalizedVoiceId;
      }

      // Double-check that the required fields are present and log them
      const sanitizationCheck = {
        startDate: !!submissionData.startDate,
        systemPrompt: !!submissionData.llmConfiguration.systemPrompt,
        voiceId: !!submissionData.voiceConfiguration.voiceId,
      };

      console.log(
        "Final sanitization check for required fields:",
        sanitizationCheck
      );

      // Real API call to create or update the campaign
      console.log(
        "Submitting campaign:",
        JSON.stringify(submissionData, null, 2)
      );

      let response;
      if (campaignId) {
        // Update existing campaign
        response = await api.put(`/campaigns/${campaignId}`, submissionData);
      } else {
        // Create new campaign
        response = await api.post("/campaigns", submissionData);
      }

      console.log("Campaign saved successfully:", response.data);

      showToast(
        campaignId ? "Campaign Updated" : "Campaign Created",
        campaignId
          ? "The campaign has been updated successfully."
          : "The campaign has been created successfully."
      );

      setIsLoading(false);
      if (onSuccess) onSuccess();
      if (onClose) onClose();
    } catch (error: any) {
      console.error("Error saving campaign:", error);

      // Enhanced error logging to help diagnose the issue
      if (error.response && error.response.data) {
        console.error("Server response data:", error.response.data);

        // Show more specific error message if available
        const errorMessage =
          error.response.data.error ||
          error.response.data.message ||
          "Failed to save campaign. Please try again.";
        showToast("Error", errorMessage, "destructive");
      } else {
        showToast(
          "Error",
          "Failed to save campaign. Please check your network connection and try again.",
          "destructive"
        );
      }

      // Log the current state of the critical fields for debugging
      console.error("Current form data state:", {
        startDate: formData.startDate,
        systemPrompt: formData.llmConfiguration.systemPrompt,
        voiceId: formData.voiceConfiguration.voiceId,
      });

      setIsLoading(false);
    }
  };

  return (
    <SheetContent className="w-full sm:max-w-2xl lg:max-w-3xl p-0">
      <div className="flex flex-col h-full">
        <div className="px-4 sm:px-6 py-4 border-b">
          <SheetHeader>
            <SheetTitle>
              {campaignId ? "Edit Campaign" : "Create New Campaign"}
            </SheetTitle>
            <SheetDescription>
              {campaignId
                ? "Update campaign details and configuration"
                : "Create a new Lumina Outreach campaign"}
            </SheetDescription>
          </SheetHeader>
        </div>

        <ScrollArea className="flex-1">
          <div className="px-4 sm:px-6 py-4 sm:py-6">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto"></div>
                  <p className="mt-4 text-muted-foreground">
                    {campaignId
                      ? "Loading campaign data..."
                      : "Creating campaign..."}
                  </p>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Tabs Navigation */}
                <div className="flex border-b mb-6 -mx-2 px-2 overflow-x-auto">
                  <button
                    type="button"
                    className={`px-3 sm:px-5 py-3 text-sm sm:text-base whitespace-nowrap ${
                      currentTab === "basic" ? "border-b-2 border-primary" : ""
                    }`}
                    onClick={() => setCurrentTab("basic")}
                  >
                    Basic Info
                  </button>
                  <button
                    type="button"
                    className={`px-3 sm:px-5 py-3 text-sm sm:text-base whitespace-nowrap ${
                      currentTab === "script" ? "border-b-2 border-primary" : ""
                    }`}
                    onClick={() => setCurrentTab("script")}
                  >
                    Call Script
                  </button>
                  <button
                    type="button"
                    className={`px-3 sm:px-5 py-3 text-sm sm:text-base whitespace-nowrap ${
                      currentTab === "ai" ? "border-b-2 border-primary" : ""
                    }`}
                    onClick={() => setCurrentTab("ai")}
                  >
                    Voice
                  </button>
                </div>

                {/* Tab Content with proper spacing */}
                <div className="space-y-6 pb-6">
                  {/* Basic Info Tab */}
                  {currentTab === "basic" && (
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 gap-6">
                        <div className="space-y-2">
                          <label className={labelStyles}>Campaign Name *</label>
                          <Input
                            type="text"
                            name="name"
                            value={formData.name}
                            onChange={handleChange}
                            placeholder="Enter campaign name"
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <label className={labelStyles}>Description *</label>
                          <textarea
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            className={textareaStyles}
                            placeholder="Describe the purpose of this campaign"
                            required
                          />
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium mb-1">
                              Campaign Goal *
                            </label>
                            <Input
                              type="text"
                              name="goal"
                              value={formData.goal}
                              onChange={handleChange}
                              placeholder="e.g., Book demos, qualify leads"
                              required
                            />
                          </div>

                          <div>
                            <label className="block text-sm font-medium mb-1">
                              Target Audience *
                            </label>
                            <Input
                              type="text"
                              name="targetAudience"
                              value={formData.targetAudience}
                              onChange={handleChange}
                              placeholder="e.g., Tech companies in Bangalore"
                              required
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium mb-1">
                              Start Date *
                            </label>
                            <DatePicker
                              date={formData.startDate}
                              setDate={(date) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  startDate: date,
                                }))
                              }
                              placeholder="Select start date"
                            />
                            {!formData.startDate && (
                              <p className="text-xs text-red-500 mt-1">
                                Start date is required
                              </p>
                            )}
                          </div>

                          <div>
                            <label className="block text-sm font-medium mb-1">
                              End Date (Optional)
                            </label>
                            <DatePicker
                              date={formData.endDate}
                              setDate={(date) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  endDate: date,
                                }))
                              }
                              placeholder="Select end date"
                            />
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium mb-1">
                            Lead Sources *
                          </label>
                          <div className="space-y-2">
                            {formData.leadSources.map(
                              (source: string, index: number) => (
                                <div
                                  key={index}
                                  className="flex items-center gap-2"
                                >
                                  <Input
                                    type="text"
                                    value={source}
                                    onChange={(
                                      e: React.ChangeEvent<HTMLInputElement>
                                    ) =>
                                      updateLeadSource(index, e.target.value)
                                    }
                                    placeholder="e.g., Website Form, Trade Show"
                                    required
                                  />
                                  {formData.leadSources.length > 1 && (
                                    <button
                                      type="button"
                                      onClick={() => removeLeadSource(index)}
                                      className="p-2 text-muted-foreground hover:text-destructive"
                                    >
                                      <X size={16} />
                                    </button>
                                  )}
                                </div>
                              )
                            )}
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={addLeadSource}
                              className="mt-2"
                            >
                              <Plus size={16} className="mr-2" />
                              Add Lead Source
                            </Button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium mb-1">
                              Primary Language *
                            </label>
                            <Select
                              value={formData.primaryLanguage}
                              onValueChange={(value) =>
                                setFormData((prev) => ({
                                  ...prev,
                                  primaryLanguage: value,
                                }))
                              }
                            >
                              <SelectTrigger className="w-full rounded-xl">
                                <SelectValue placeholder="Select a language" />
                              </SelectTrigger>
                              <SelectContent>
                                {languages.map((language: string) => (
                                  <SelectItem key={language} value={language}>
                                    {language}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <label className="block text-sm font-medium mb-1">
                              Supported Languages
                            </label>
                            <div className="bg-muted/50 p-3 rounded-xl max-h-[120px] overflow-y-auto">
                              <div className="flex flex-wrap gap-2">
                                {languages.map((language: string) => {
                                  const isSelected =
                                    formData.supportedLanguages.includes(
                                      language
                                    );
                                  return (
                                    <Badge
                                      key={language}
                                      variant={
                                        isSelected ? "default" : "outline"
                                      }
                                      className={`cursor-pointer transition-colors ${
                                        isSelected
                                          ? ""
                                          : "hover:bg-secondary/20"
                                      }`}
                                      onClick={() =>
                                        handleLanguageChange(
                                          language,
                                          !isSelected
                                        )
                                      }
                                    >
                                      {language}
                                    </Badge>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Script Tab */}
                  {currentTab === "script" && (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium mb-1">
                          Script Name
                        </label>
                        <Input
                          type="text"
                          name="script.name"
                          value={formData.script.name}
                          onChange={handleChange}
                          placeholder="e.g., Primary Script, Version A"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-1">
                          Opening Message
                        </label>
                        <div className="text-xs text-muted-foreground mb-2">
                          This message will be spoken as soon as the call is
                          answered.
                        </div>
                        <textarea
                          name="openingMessage"
                          value={formData.openingMessage}
                          onChange={handleChange}
                          className={textareaStyles}
                          placeholder="Enter the opening message here..."
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-1">
                          Script Content *
                        </label>
                        <div className="text-xs text-muted-foreground mb-2">
                          You can use variables like {"{agent_name}"},{" "}
                          {"{company_name}"}, {"{product_name}"} in your script.
                        </div>
                        <textarea
                          name="script.content"
                          value={formData.script.content}
                          onChange={handleChange}
                          className={textareaStyles}
                          placeholder="Enter your call script here..."
                          required
                        />
                      </div>
                    </div>
                  )}

                  {/* Voice Tab */}
                  {currentTab === "ai" && (
                    <div className="space-y-4">
                      {systemConfig && (
                        <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-xl text-sm border border-blue-200 dark:border-blue-800">
                          <p className="font-medium">
                            Using your account configuration
                          </p>
                          <p className="text-muted-foreground text-xs mt-1">
                            The LLM and Deepgram credentials saved on the
                            Configuration page are used for every call in this
                            campaign.
                          </p>
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium mb-1">
                          Voice Provider
                        </label>
                        <Select
                          value={formData.voiceConfiguration.provider}
                          onValueChange={handleTTSProviderChange}
                        >
                          <SelectTrigger className="w-full rounded-xl">
                            <SelectValue placeholder="Select a voice provider" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="deepgram">
                              Deepgram TTS
                            </SelectItem>
                          </SelectContent>
                        </Select>
                        <p className="text-xs text-muted-foreground mt-1">
                          Using Deepgram from your account configuration
                        </p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-1">
                          Voice
                        </label>
                        {loadingVoices[
                          formData.voiceConfiguration.provider
                        ] ? (
                          <div className="space-y-2">
                            <div className="w-full h-10 rounded-xl border border-input bg-background px-3 py-2 flex items-center">
                              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                              <span className="text-sm text-muted-foreground">
                                Loading voices...
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Fetching available voices for{" "}
                              {formData.voiceConfiguration.provider}
                            </p>
                          </div>
                        ) : availableVoices[
                            formData.voiceConfiguration.provider
                          ]?.length > 0 ? (
                          <Select
                            value={formData.voiceConfiguration.voiceId}
                            onValueChange={(value) =>
                              setFormData((prev) => ({
                                ...prev,
                                voiceConfiguration: {
                                  ...prev.voiceConfiguration,
                                  voiceId: value,
                                },
                              }))
                            }
                            required
                          >
                            <SelectTrigger
                              className={`w-full rounded-xl ${
                                !formData.voiceConfiguration.voiceId
                                  ? "border-red-500"
                                  : ""
                              }`}
                            >
                              <SelectValue placeholder="Select a voice" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableVoices[
                                formData.voiceConfiguration.provider
                              ].map((voice: VoiceOption) => (
                                <SelectItem
                                  key={voice.voiceId}
                                  value={voice.voiceId}
                                >
                                  {voice.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <div className="space-y-2">
                            <Input
                              value={formData.voiceConfiguration.voiceId}
                              disabled
                              placeholder="Voice options unavailable"
                            />
                            <p className="text-xs text-red-500">
                              Deepgram voice options are unavailable. Check
                              provider configuration and reload the voices.
                            </p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                loadVoicesForProvider(
                                  formData.voiceConfiguration.provider
                                )
                              }
                              className="text-xs"
                            >
                              Load Voices
                            </Button>
                          </div>
                        )}
                        {!formData.voiceConfiguration.voiceId && (
                          <p className="text-xs text-red-500 mt-1">
                            Voice ID is required
                          </p>
                        )}
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-1">
                          Transfer Phone Number
                        </label>
                        <Input
                          name="transferPhoneNumber"
                          value={formData.transferPhoneNumber}
                          onChange={handleChange}
                          placeholder="+911234567890"
                        />
                        <p className="text-xs text-muted-foreground mt-1">
                          Where the agent forwards a call when the lead asks for
                          a human. Leave blank to disable transfers.
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Form Actions */}
                <div className="flex flex-row justify-end gap-2 pt-6 border-t mt-6">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={onClose}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={isLoading}>
                    {isLoading
                      ? "Saving..."
                      : campaignId
                      ? "Update Campaign"
                      : "Create Campaign"}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </ScrollArea>
      </div>
    </SheetContent>
  );
};

export default CampaignForm;

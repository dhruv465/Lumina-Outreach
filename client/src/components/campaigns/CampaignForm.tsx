import React, { useState, useEffect } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Slider } from "@/components/ui/slider";
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
}

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
  callTiming: {
    daysOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    startTime: "09:00",
    endTime: "17:00",
    timeZone: "Asia/Kolkata",
  },
  llmConfiguration: {
    model: "gpt-4o",
    systemPrompt:
      "You are an AI assistant making a call on behalf of a company. Be professional, friendly, and helpful.",
    temperature: 0.7,
    maxTokens: 500,
  },
  voiceConfiguration: {
    provider: "elevenlabs",
    voiceId: "", // Will be set from system configuration during form load
    speed: 1.0,
    pitch: 1.0,
  },
};

// Time zone options
const timeZones = [
  "Asia/Kolkata",
  "America/New_York",
  "America/Los_Angeles",
  "Europe/London",
  "Australia/Sydney",
];

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

// LLM model options
const llmModels = [
  "gpt-4o",
  "gpt-3.5-turbo",
  "claude-3-opus",
  "claude-3-sonnet",
  "gemini-pro",
];

// Voice provider options - will be dynamically loaded from system configuration
const defaultVoiceProviders = ["elevenlabs", "google", "aws"];

const CampaignForm = ({
  campaignId,
  onClose,
  onSuccess,
}: CampaignFormProps) => {
  const [isLoading, setIsLoading] = useState(false);
  const [formData, setFormData] = useState<CampaignFormData>(initialFormState);
  const [currentTab, setCurrentTab] = useState<
    "basic" | "script" | "scheduling" | "ai"
  >("basic");
  const [systemConfig, setSystemConfig] = useState<any>(null);
  const [availableLLMModels, setAvailableLLMModels] =
    useState<string[]>(llmModels);
  const [availableVoiceProviders, setAvailableVoiceProviders] = useState<string[]>(defaultVoiceProviders);
  const [availableVoices, setAvailableVoices] = useState<{[key: string]: any[]}>({});
  const [loadingVoices, setLoadingVoices] = useState<{[key: string]: boolean}>({});

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

    try {
      setIsLoading(true);
      // Real API call to fetch campaign data
      const response = await api.get(`/campaigns/${campaignId}`);
      const campaignData = response.data;

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
          model: campaignData.llmConfiguration?.model || "gpt-4o",
          systemPrompt:
            campaignData.llmConfiguration?.systemPrompt ||
            "You are an AI assistant making a call on behalf of a company. Be professional, friendly, and helpful.",
          temperature: campaignData.llmConfiguration?.temperature || 0.7,
          maxTokens: campaignData.llmConfiguration?.maxTokens || 500,
        },
        voiceConfiguration: {
          provider: campaignData.voiceConfiguration?.provider || "elevenlabs",
          voiceId: campaignData.voiceConfiguration?.voiceId || "",
          speed: campaignData.voiceConfiguration?.speed || 1.0,
          pitch: campaignData.voiceConfiguration?.pitch || 1.0,
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
  const loadVoicesForProvider = async (provider: string, config: any) => {
    console.log(`Loading voices for provider: ${provider}`);
    
    // Set loading state
    setLoadingVoices(prev => ({ ...prev, [provider]: true }));
    
    try {
      let voices: any[] = [];
      
      switch (provider) {
        case "elevenlabs":
          if (config.elevenLabsConfig?.apiKey) {
            try {
              const result = await configApi.testElevenLabsConnection({
                apiKey: config.elevenLabsConfig.apiKey,
              });
              if (result.success && result.details?.availableVoices) {
                voices = result.details.availableVoices;
                console.log(`Loaded ${voices.length} ElevenLabs voices`);
              }
            } catch (error) {
              console.error("Error loading ElevenLabs voices:", error);
              // Fallback to stored voices if API call fails
              if (config.elevenLabsConfig?.availableVoices?.length > 0) {
                voices = config.elevenLabsConfig.availableVoices;
                console.log(`Using stored ElevenLabs voices: ${voices.length}`);
              }
            }
          }
          break;
          
        case "deepgram":
          try {
            // Use the dedicated TTS provider voices endpoint instead of test connection
            const response = await api.get(`/tts-provider/voices?provider=deepgram`);
            if (response.data.success && response.data.voices) {
              voices = response.data.voices;
              console.log(`Loaded ${voices.length} Deepgram TTS voices`);
            }
          } catch (error) {
            console.error("Error loading Deepgram TTS voices:", error);
            // Fallback to test connection if available
            if (config.ttsConfig?.deepgramTTS?.apiKey) {
              try {
                const result = await configApi.testDeepgramTTSConnection({
                  apiKey: config.ttsConfig.deepgramTTS.apiKey,
                });
                if (result.success && result.details?.availableVoices) {
                  voices = result.details.availableVoices;
                  console.log(`Loaded ${voices.length} Deepgram TTS voices via fallback`);
                }
              } catch (fallbackError) {
                console.error("Error loading Deepgram TTS voices via fallback:", fallbackError);
              }
            }
          }
          break;
          
        case "openai":
          // OpenAI has predefined voices
          voices = [
            { voiceId: "alloy", name: "Alloy" },
            { voiceId: "echo", name: "Echo" },
            { voiceId: "fable", name: "Fable" },
            { voiceId: "onyx", name: "Onyx" },
            { voiceId: "nova", name: "Nova" },
            { voiceId: "shimmer", name: "Shimmer" }
          ];
          console.log("Using predefined OpenAI TTS voices");
          break;
          
        case "google":
          // TODO: Implement Google TTS voice loading
          console.log("Google TTS voice loading not implemented yet");
          break;
          
        case "aws":
          // TODO: Implement AWS Polly voice loading
          console.log("AWS Polly voice loading not implemented yet");
          break;
          
        default:
          console.warn(`Unknown TTS provider: ${provider}`);
      }
      
      // Update the voices map for this provider
      setAvailableVoices(prev => ({
        ...prev,
        [provider]: voices
      }));
      
      return voices;
    } catch (error) {
      console.error(`Error loading voices for ${provider}:`, error);
      return [];
    } finally {
      // Clear loading state
      setLoadingVoices(prev => ({ ...prev, [provider]: false }));
    }
  };

  // Load available TTS providers from system configuration
  const loadTTSProvidersAndVoices = async (config: any) => {
    const enabledProviders: string[] = [];

    console.log("Loading TTS providers from config:", config);

    // Check ElevenLabs
    if (config.elevenLabsConfig?.isEnabled && config.elevenLabsConfig?.apiKey) {
      enabledProviders.push("elevenlabs");
      console.log("ElevenLabs is enabled and configured");
    }

    // Check Deepgram TTS
    if (config.ttsConfig?.deepgramTTS?.isEnabled && config.ttsConfig?.deepgramTTS?.apiKey) {
      enabledProviders.push("deepgram");
      console.log("Deepgram TTS is enabled and configured");
    }

    // Check OpenAI TTS
    if (config.ttsConfig?.openai?.isEnabled && config.ttsConfig?.openai?.apiKey) {
      enabledProviders.push("openai");
      console.log("OpenAI TTS is enabled and configured");
    }

    // Check Google TTS
    if (config.ttsConfig?.google?.isEnabled && config.ttsConfig?.google?.apiKey) {
      enabledProviders.push("google");
      console.log("Google TTS is enabled and configured");
    }

    // Check AWS Polly
    if (config.ttsConfig?.aws?.isEnabled && config.ttsConfig?.aws?.accessKeyId) {
      enabledProviders.push("aws");
      console.log("AWS Polly is enabled and configured");
    }

    // Also check the main TTS provider setting from Configuration page
    const mainTTSProvider = config.ttsProvider;
    if (mainTTSProvider && !enabledProviders.includes(mainTTSProvider)) {
      console.log("Adding main TTS provider from configuration:", mainTTSProvider);
      enabledProviders.push(mainTTSProvider);
    }

    // Fallback to showing all available providers if none are explicitly enabled
    if (enabledProviders.length === 0) {
      console.warn("No TTS providers enabled, showing all available providers");
      const allProviders = ["elevenlabs", "deepgram", "openai", "google", "aws"];
      setAvailableVoiceProviders(allProviders);
    } else {
      console.log("Enabled TTS providers:", enabledProviders);
      setAvailableVoiceProviders(enabledProviders);
    }

    // Load voices for the main TTS provider if it exists
    if (mainTTSProvider) {
      await loadVoicesForProvider(mainTTSProvider, config);
    }
  };

  const loadSystemConfiguration = async () => {
    try {
      setIsLoading(true);
      const config = await configApi.getConfiguration();
      setSystemConfig(config);
      
      console.log("Loaded system configuration:", config);
      
      // Load TTS providers and voices
      await loadTTSProvidersAndVoices(config);
      
      // Filter LLM models based on the configured provider
      if (config.llmConfig?.providers) {
        const defaultProvider = config.llmConfig.defaultProvider;
        const providerInfo = config.llmConfig.providers.find(
          (p: any) => p.name === defaultProvider
        );

        if (
          providerInfo &&
          providerInfo.availableModels &&
          providerInfo.availableModels.length > 0
        ) {
          setAvailableLLMModels(providerInfo.availableModels);
        }
      }

      // Only update form data if not editing an existing campaign
      if (!campaignId) {
        // Determine the best voice provider and voice ID from available options
        let bestProvider = '';
        let bestVoiceId = '';
        
        // Priority 1: Use the main TTS provider from Configuration page
        if (config.ttsProvider) {
          bestProvider = config.ttsProvider;
          console.log("Using main TTS provider from configuration:", bestProvider);
          
          // Get the voice ID from Configuration page
          if (config.voiceId) {
            bestVoiceId = config.voiceId;
            console.log("Using voice ID from configuration:", bestVoiceId);
          }
        }
        
        // Priority 2: Use the first available provider from our dynamic list
        if (!bestProvider && availableVoiceProviders.length > 0) {
          bestProvider = availableVoiceProviders[0];
          console.log("Using first available provider:", bestProvider);
        }
        
        // Priority 3: Get the first voice for the selected provider
        if (bestProvider && !bestVoiceId && availableVoices[bestProvider]?.length > 0) {
          bestVoiceId = availableVoices[bestProvider][0].voiceId;
          console.log(`Using first available voice: ${availableVoices[bestProvider][0].name} (${bestVoiceId}) from ${bestProvider}`);
        }
        
        // Fallback to system configuration if still no provider/voice found
        if (!bestProvider || !bestVoiceId) {
          // Priority 4: voiceAIConfig conversationalAI defaultVoiceId (system default voice)
          if (config.voiceAIConfig?.conversationalAI?.defaultVoiceId) {
            bestVoiceId = config.voiceAIConfig.conversationalAI.defaultVoiceId;
            bestProvider = bestProvider || "elevenlabs"; // Keep existing provider or default to elevenlabs
            console.log("Using system default voice ID:", bestVoiceId);
          }
          // Priority 5: ElevenLabs first voice
          else if (config.elevenLabsConfig?.availableVoices?.length > 0) {
            bestVoiceId = config.elevenLabsConfig.availableVoices[0].voiceId;
            bestProvider = bestProvider || "elevenlabs";
            console.log("Using first ElevenLabs voice:", bestVoiceId);
          }
          // Priority 6: Final fallback
          else {
            console.warn("No voices available in system configuration");
            if (availableVoiceProviders.length === 0) {
              showToast("Warning", "No TTS providers configured in system. Please configure TTS providers in the Configuration page.", "destructive");
            }
            bestProvider = bestProvider || "elevenlabs";
            bestVoiceId = bestVoiceId || "";
          }
        }
        
        // Determine best system prompt
        const bestSystemPrompt = config.llmConfig?.defaultSystemPrompt || 
                               config.generalSettings?.defaultSystemPrompt ||
                               'You are an AI assistant making a call on behalf of a company. Be professional, friendly, and helpful.';
        
        // Determine best LLM model
        const bestModel = config.llmConfig?.defaultModel || 
                       (config.llmConfig?.providers?.[0]?.availableModels?.[0]) || 
                       "gpt-4o";
        
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
            temperature: config.llmConfig?.temperature || prev.llmConfiguration.temperature,
            maxTokens: config.llmConfig?.maxTokens || prev.llmConfiguration.maxTokens,
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
            timeZone: config.generalSettings?.defaultTimeZone || prev.callTiming.timeZone,
          },
        }));
        
        // Log the important values to verify they're set
        console.log("Set required fields from system config:", {
          startDate: today,
          systemPrompt: bestSystemPrompt,
          voiceId: bestVoiceId,
          model: bestModel
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
        setFormData(prev => ({
          ...prev,
          startDate: new Date(),
          llmConfiguration: {
            ...prev.llmConfiguration,
              systemPrompt: systemConfig?.generalSettings?.defaultSystemPrompt || 'You are an AI assistant making a call on behalf of a company.',
          },
          voiceConfiguration: {
            ...prev.voiceConfiguration,
            voiceId: '', // Don't use default-voice-id fallback
          }
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

  // Handle TTS provider change
  const handleTTSProviderChange = async (provider: string) => {
    console.log("TTS provider changed to:", provider);
    
    // Update form data
    setFormData((prev: CampaignFormData) => ({
      ...prev,
      voiceConfiguration: {
        ...prev.voiceConfiguration,
        provider: provider,
        voiceId: "", // Reset voice ID when provider changes
      },
    }));
    
    // Load voices for the new provider
    if (systemConfig) {
      const voices = await loadVoicesForProvider(provider, systemConfig);
      
      // Auto-select first voice if available
      if (voices.length > 0) {
        setFormData((prev: CampaignFormData) => ({
          ...prev,
          voiceConfiguration: {
            ...prev.voiceConfiguration,
            voiceId: voices[0].voiceId,
          },
        }));
        console.log(`Auto-selected first voice: ${voices[0].name} (${voices[0].voiceId})`);
      }
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

  // Handle checkbox changes (days of week)
  const handleDayChange = (day: string, checked: boolean) => {
    setFormData((prev: CampaignFormData) => {
      const currentDays = [...prev.callTiming.daysOfWeek];

      if (checked && !currentDays.includes(day)) {
        currentDays.push(day);
      } else if (!checked && currentDays.includes(day)) {
        const index = currentDays.indexOf(day);
        currentDays.splice(index, 1);
      }

      return {
        ...prev,
        callTiming: {
          ...prev.callTiming,
          daysOfWeek: currentDays,
        },
      };
    });
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

  // Handle number inputs for temperature, speed, etc.
  const handleNumberChange = (name: string, value: string) => {
    const [parent, child] = name.split(".");
    const numValue = parseFloat(value);

    if (!isNaN(numValue)) {
      setFormData((prev: CampaignFormData) => {
        const updatedData = { ...prev };
        if (parent === "llmConfiguration") {
          updatedData.llmConfiguration = {
            ...updatedData.llmConfiguration,
            [child]: numValue,
          };
        } else if (parent === "voiceConfiguration") {
          updatedData.voiceConfiguration = {
            ...updatedData.voiceConfiguration,
            [child]: numValue,
          };
        }
        return updatedData;
      });
    }
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      setIsLoading(true);

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
      if (!formData.voiceConfiguration.voiceId || formData.voiceConfiguration.voiceId === '') {
        showToast(
          "Voice ID Required",
          "Please select or enter a Voice ID for the campaign.",
          "destructive"
        );
        setCurrentTab('ai');
        setIsLoading(false);
        return;
      }

      if (!formData.llmConfiguration.systemPrompt || formData.llmConfiguration.systemPrompt === '') {
        showToast(
          "System Prompt Required",
          "Please provide a system prompt for the AI model.",
          "destructive"
        );
        setCurrentTab('ai');
        setIsLoading(false);
        return;
      }

      if (!formData.startDate) {
        showToast(
          "Start Date Required",
          "Please select a start date for the campaign.",
          "destructive"
        );
        setCurrentTab('basic');
        setIsLoading(false);
        return;
      }

      // Format script data correctly to match the server model
      const scriptData = {
        versions: [
          {
            name: formData.script.name || "Primary Script",
            content: formData.script.content || "",
            isActive: true
          }
        ]
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
        // Explicitly format date fields as strings
        // Explicitly format date fields as strings
        startDate: formData.startDate instanceof Date 
          ? formData.startDate.toISOString() 
          : new Date().toISOString(),
        endDate: formData.endDate instanceof Date 
          ? formData.endDate.toISOString() 
          : null,
        callTiming: {
          daysOfWeek: formData.callTiming.daysOfWeek,
          startTime: formData.callTiming.startTime,
          endTime: formData.callTiming.endTime,
          timeZone: formData.callTiming.timeZone,
        },
        llmConfiguration: {
          model: formData.llmConfiguration.model || "gpt-4o",
          // Ensure systemPrompt is always provided as a non-empty string
          systemPrompt: formData.llmConfiguration.systemPrompt || 
            "You are an AI assistant making a call on behalf of a company. Be professional, friendly, and helpful.",
          temperature: Number(formData.llmConfiguration.temperature) || 0.7,
          maxTokens: Number(formData.llmConfiguration.maxTokens) || 500,
        },
        voiceConfiguration: {
          provider: formData.voiceConfiguration.provider || "elevenlabs",
          // Ensure voiceId is always provided as a non-empty string from available voices
          voiceId: formData.voiceConfiguration.voiceId || 
            (systemConfig?.elevenLabsConfig?.availableVoices?.[0]?.voiceId || ""),
          speed: Number(formData.voiceConfiguration.speed) || 1.0,
          pitch: Number(formData.voiceConfiguration.pitch) || 1.0,
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
        submissionData.llmConfiguration.systemPrompt = systemConfig?.generalSettings?.defaultSystemPrompt || "You are an AI assistant making a call on behalf of a company.";
      }
      
      if (!submissionData.voiceConfiguration.voiceId) {
        console.error("voiceId is still missing after all validations");
        // Try to get a voice ID from any available source
        const fallbackVoiceId = systemConfig?.elevenLabsConfig?.availableVoices?.[0]?.voiceId || 
                               "default-voice-id";
        submissionData.voiceConfiguration.voiceId = fallbackVoiceId;
      }

      // Explicitly sanitize the submissionData to ensure it has the three required fields
      // These fields must be present as non-empty strings or the server will reject the request
      
      // 1. Ensure startDate is a valid ISO string
      if (typeof submissionData.startDate !== 'string' || !submissionData.startDate) {
        submissionData.startDate = new Date().toISOString();
      }
      
      // 2. Ensure systemPrompt is a non-empty string
      if (!submissionData.llmConfiguration.systemPrompt) {
        submissionData.llmConfiguration.systemPrompt = 
          systemConfig?.generalSettings?.defaultSystemPrompt || "You are an AI assistant making a call on behalf of a company.";
      }
      
      // 3. Ensure voiceId is a non-empty string and is valid
      if (!submissionData.voiceConfiguration.voiceId || submissionData.voiceConfiguration.voiceId === "default-voice-id") {
        const availableVoices = systemConfig?.elevenLabsConfig?.availableVoices || [];
        if (availableVoices.length > 0) {
          submissionData.voiceConfiguration.voiceId = availableVoices[0].voiceId;
          console.log(`Using first available voice: ${availableVoices[0].name} (${availableVoices[0].voiceId})`);
        } else {
          console.error("No voices available in system configuration");
          throw new Error("No voices configured in the system. Please configure ElevenLabs voices in system settings.");
        }
      }
      
      // Double-check that the required fields are present and log them
      const sanitizationCheck = {
        startDate: !!submissionData.startDate,
        systemPrompt: !!submissionData.llmConfiguration.systemPrompt,
        voiceId: !!submissionData.voiceConfiguration.voiceId
      };
      
      console.log("Final sanitization check for required fields:", sanitizationCheck);

      // Real API call to create or update the campaign
      console.log("Submitting campaign:", JSON.stringify(submissionData, null, 2));

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
        const errorMessage = error.response.data.error || error.response.data.message || "Failed to save campaign. Please try again.";
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
        voiceId: formData.voiceConfiguration.voiceId
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
                      currentTab === "scheduling"
                        ? "border-b-2 border-primary"
                        : ""
                    }`}
                    onClick={() => setCurrentTab("scheduling")}
                  >
                    Scheduling
                  </button>
                  <button
                    type="button"
                    className={`px-3 sm:px-5 py-3 text-sm sm:text-base whitespace-nowrap ${
                      currentTab === "ai" ? "border-b-2 border-primary" : ""
                    }`}
                    onClick={() => setCurrentTab("ai")}
                  >
                    AI & Voice
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
                          This message will be spoken as soon as the call is answered.
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

                  {/* Scheduling Tab */}
                  {currentTab === "scheduling" && (
                    <div className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium mb-1">
                          Days of Week
                        </label>
                        <div className="bg-muted/50 p-3 rounded-xl">
                          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                            {[
                              "Monday",
                              "Tuesday",
                              "Wednesday",
                              "Thursday",
                              "Friday",
                              "Saturday",
                              "Sunday",
                            ].map((day: string) => (
                              <div
                                key={day}
                                className="flex items-center gap-2"
                              >
                                <Checkbox
                                  id={`day-${day}`}
                                  checked={formData.callTiming.daysOfWeek.includes(
                                    day
                                  )}
                                  onCheckedChange={(checked: boolean) =>
                                    handleDayChange(day, checked)
                                  }
                                />
                                <label
                                  htmlFor={`day-${day}`}
                                  className="text-sm cursor-pointer"
                                >
                                  {day}
                                </label>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            Start Time
                          </label>
                          <Input
                            type="time"
                            name="callTiming.startTime"
                            value={formData.callTiming.startTime}
                            onChange={handleChange}
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium mb-1">
                            End Time
                          </label>
                          <Input
                            type="time"
                            name="callTiming.endTime"
                            value={formData.callTiming.endTime}
                            onChange={handleChange}
                          />
                        </div>

                        <div>
                          <label className="block text-sm font-medium mb-1">
                            Time Zone
                          </label>
                          <Select
                            value={formData.callTiming.timeZone}
                            onValueChange={(value) =>
                              setFormData((prev) => ({
                                ...prev,
                                callTiming: {
                                  ...prev.callTiming,
                                  timeZone: value,
                                },
                              }))
                            }
                          >
                            <SelectTrigger className="w-full rounded-xl">
                              <SelectValue placeholder="Select a time zone" />
                            </SelectTrigger>
                            <SelectContent>
                              {timeZones.map((tz: string) => (
                                <SelectItem key={tz} value={tz}>
                                  {tz}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* AI & Voice Tab */}
                  {currentTab === "ai" && (
                    <div className="space-y-4">
                      {systemConfig && (
                        <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-xl text-sm border border-blue-200 dark:border-blue-800">
                          <p className="font-medium">
                            Using system configuration settings
                          </p>
                          <p className="text-muted-foreground text-xs mt-1">
                            The AI and voice settings shown here are based on
                            the system-wide configuration.
                            {systemConfig.llmConfig?.defaultProvider && (
                              <span>
                                {" "}
                                Using {
                                  systemConfig.llmConfig.defaultProvider
                                }{" "}
                                as the LLM provider.
                              </span>
                            )}
                          </p>
                        </div>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            LLM Model
                          </label>
                          <Select
                            value={formData.llmConfiguration.model}
                            onValueChange={(value) =>
                              setFormData((prev) => ({
                                ...prev,
                                llmConfiguration: {
                                  ...prev.llmConfiguration,
                                  model: value,
                                },
                              }))
                            }
                          >
                            <SelectTrigger className="w-full rounded-xl">
                              <SelectValue placeholder="Select a model" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableLLMModels.map((model: string) => (
                                <SelectItem key={model} value={model}>
                                  {model}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div>
                          <label className="block text-sm font-medium mb-1">
                            Voice Provider
                          </label>
                          <Select
                            value={formData.voiceConfiguration.provider}
                            onValueChange={handleTTSProviderChange}
                            disabled={systemConfig?.elevenLabsConfig?.isEnabled}
                          >
                            <SelectTrigger className="w-full rounded-xl">
                              <SelectValue placeholder="Select a voice provider" />
                            </SelectTrigger>
                            <SelectContent>
                              {availableVoiceProviders.map((provider: string) => (
                                <SelectItem key={provider} value={provider}>
                                  {provider === "elevenlabs"
                                    ? "ElevenLabs"
                                    : provider === "deepgram"
                                    ? "Deepgram TTS"
                                    : provider === "openai"
                                    ? "OpenAI TTS"
                                    : provider === "google"
                                    ? "Google TTS"
                                    : provider === "aws"
                                    ? "AWS Polly"
                                    : provider.charAt(0).toUpperCase() + provider.slice(1)}
                                </SelectItem>
                              ))}
                              {availableVoiceProviders.length === 0 && (
                                <SelectItem value="" disabled>
                                  No TTS providers configured
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                          {systemConfig?.elevenLabsConfig?.isEnabled && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Voice provider is set by system configuration
                            </p>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="block text-sm font-medium mb-1">
                          System Prompt *
                        </label>
                        <textarea
                          name="llmConfiguration.systemPrompt"
                          value={formData.llmConfiguration.systemPrompt}
                          onChange={handleChange}
                          className={`${textareaStyles} ${!formData.llmConfiguration.systemPrompt ? "border-red-500" : ""}`}
                          placeholder="Instructions for the AI model"
                          required
                        />
                        {!formData.llmConfiguration.systemPrompt && (
                          <p className="text-xs text-red-500 mt-1">
                            System prompt is required
                          </p>
                        )}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            Voice
                          </label>
                          {loadingVoices[formData.voiceConfiguration.provider] ? (
                            <div className="space-y-2">
                              <div className="w-full h-10 rounded-xl border border-input bg-background px-3 py-2 flex items-center">
                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary mr-2"></div>
                                <span className="text-sm text-muted-foreground">Loading voices...</span>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Fetching available voices for {formData.voiceConfiguration.provider}
                              </p>
                            </div>
                          ) : availableVoices[formData.voiceConfiguration.provider]?.length > 0 ? (
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
                              <SelectTrigger className={`w-full rounded-xl ${!formData.voiceConfiguration.voiceId ? "border-red-500" : ""}`}>
                                <SelectValue placeholder="Select a voice" />
                              </SelectTrigger>
                              <SelectContent>
                                {availableVoices[formData.voiceConfiguration.provider].map(
                                  (voice: any) => (
                                    <SelectItem
                                      key={voice.voiceId}
                                      value={voice.voiceId}
                                    >
                                      {voice.name}
                                    </SelectItem>
                                  )
                                )}
                              </SelectContent>
                            </Select>
                          ) : (
                            <div className="space-y-2">
                              <Input
                                type="text"
                                name="voiceConfiguration.voiceId"
                                value={formData.voiceConfiguration.voiceId}
                                onChange={handleChange}
                                className={!formData.voiceConfiguration.voiceId ? "border-red-500" : ""}
                                placeholder="Enter voice ID from provider"
                                required
                              />
                              <p className="text-xs text-muted-foreground">
                                No voices loaded for {formData.voiceConfiguration.provider}. 
                                Check provider configuration or enter voice ID manually.
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() => loadVoicesForProvider(formData.voiceConfiguration.provider, systemConfig)}
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
                            Max Tokens
                          </label>
                          <Input
                            type="number"
                            value={formData.llmConfiguration.maxTokens}
                            onChange={(
                              e: React.ChangeEvent<HTMLInputElement>
                            ) =>
                              handleNumberChange(
                                "llmConfiguration.maxTokens",
                                e.target.value
                              )
                            }
                            min="100"
                            max="4000"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-medium mb-1">
                            Temperature: {formData.llmConfiguration.temperature}
                          </label>
                          <Slider
                            value={[formData.llmConfiguration.temperature]}
                            onValueChange={(value) =>
                              handleNumberChange(
                                "llmConfiguration.temperature",
                                value[0].toString()
                              )
                            }
                            min={0}
                            max={2}
                            step={0.1}
                            className="py-4"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>0 (Precise)</span>
                            <span>2 (Creative)</span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium mb-1">
                            Voice Speed: {formData.voiceConfiguration.speed}
                          </label>
                          <Slider
                            value={[formData.voiceConfiguration.speed]}
                            onValueChange={(value) =>
                              handleNumberChange(
                                "voiceConfiguration.speed",
                                value[0].toString()
                              )
                            }
                            min={0.25}
                            max={4.0}
                            step={0.05}
                            className="py-4"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>0.25 (Slow)</span>
                            <span>4.0 (Fast)</span>
                          </div>
                        </div>

                        <div>
                          <label className="block text-sm font-medium mb-1">
                            Voice Pitch: {formData.voiceConfiguration.pitch}
                          </label>
                          <Slider
                            value={[formData.voiceConfiguration.pitch]}
                            onValueChange={(value) =>
                              handleNumberChange(
                                "voiceConfiguration.pitch",
                                value[0].toString()
                              )
                            }
                            min={-1.0}
                            max={1.0}
                            step={0.1}
                            className="py-4"
                          />
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>-1.0 (Lower)</span>
                            <span>1.0 (Higher)</span>
                          </div>
                        </div>
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

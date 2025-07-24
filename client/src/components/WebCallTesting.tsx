import React, { useState, useEffect, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";
import { useQuery } from "@tanstack/react-query";
import api from "@/services/api";
import { useAuth } from "@/hooks/useAuth";
import WebCallAudioProcessor, {
  AudioProcessorErrorType,
  AudioProcessorError,
} from "./WebCallAudioProcessor";
import WebCallAudioPlayer from "./WebCallAudioPlayer";
import WebCallTranscript from "./WebCallTranscript";
import WebCallControls from "./WebCallControls";
import WebCallTranscriptExport from "./WebCallTranscriptExport";
import RealTimeCallMonitoring from "./RealTimeCallMonitoring";
import WebCallDebugPanel from "./WebCallDebugPanel";
import { Card, CardHeader, CardContent, CardTitle } from "./ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Skeleton } from "./ui/skeleton";
import { Badge } from "./ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import {
  AlertCircle,
  RefreshCw,
  Users,
  PhoneCall,
  Play,
  Square,
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Activity,
  MessageSquare,
  BarChart3,
  Settings,
} from "lucide-react";
import { Button } from "./ui/button";

// Types (same as original)
interface WebCallTestingProps {
  campaignId?: string;
  onCallEnd?: (callData: WebCallResult) => void;
  height?: string | number;
  width?: string | number;
  className?: string;
}

interface Campaign {
  _id: string;
  name: string;
  description: string;
  status: "Draft" | "Active" | "Paused" | "Completed";
}

interface WebCallState {
  status:
    | "idle"
    | "connecting"
    | "connected"
    | "speaking"
    | "listening"
    | "processing"
    | "ended"
    | "error";
  transcript: TranscriptEntry[];
  currentSpeaker: "agent" | "user" | null;
  error?: string;
}

interface WebCallError {
  type:
    | "connection"
    | "audio_permission"
    | "audio_playback"
    | "server"
    | "unknown";
  message: string;
  timestamp: number;
  recoverable: boolean;
  details?: string;
}

interface TranscriptEntry {
  id: string;
  speaker: "agent" | "user";
  text: string;
  timestamp: number;
  isFinal: boolean;
}

interface WebCallResult {
  callId: string;
  duration: number;
  transcript: TranscriptEntry[];
  metrics: {
    responseTime: number;
    userSpeakingTime: number;
    agentSpeakingTime: number;
    interruptions: number;
  };
  campaignId: string;
  startTime: Date;
  endTime: Date;
}

/**
 * Redesigned WebCallTesting Component
 *
 * Modern, intuitive interface for testing campaign agents
 */
const WebCallTesting: React.FC<WebCallTestingProps> = ({
  campaignId: initialCampaignId,
  onCallEnd,
  height = "100%",
  width = "100%",
  className = "",
}) => {
  // State (same as original but simplified)
  const [selectedCampaignId, setSelectedCampaignId] = useState<
    string | undefined
  >(initialCampaignId);
  const [callState, setCallState] = useState<WebCallState>({
    status: "idle",
    transcript: [],
    currentSpeaker: null,
  });
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1); // Used in WebCallControls onVolumeChange
  const [currentAudioBuffer, setCurrentAudioBuffer] =
    useState<ArrayBuffer | null>(null);
  const [callId, setCallId] = useState<string | null>(null);
  const [testId, setTestId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<any>({});
  const [activeTab, setActiveTab] = useState<string>("transcript");
  const [error, setError] = useState<WebCallError | null>(null);
  const [isRecovering, setIsRecovering] = useState(false);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  // Refs
  const audioProcessorRef = useRef<WebCallAudioProcessor | null>(null);
  const reconnectTimeoutRef = useRef<number | null>(null);
  const socketUrlRef = useRef<string>("");

  // Get user authentication state (must be before useQuery)
  const { user } = useAuth();

  // Simplified error handling
  const handleError = useCallback(
    (
      errorType: WebCallError["type"],
      message: string,
      recoverable: boolean = true,
      details?: string
    ) => {
      const newError: WebCallError = {
        type: errorType,
        message,
        timestamp: Date.now(),
        recoverable,
        details,
      };

      setError(newError);
      setCallState((prev) => ({
        ...prev,
        status: "error",
        error: message,
      }));

      console.error(
        `WebCallTesting error (${errorType}):`,
        message,
        details || ""
      );
      return newError;
    },
    []
  );

  // Reset error state
  const resetErrorState = useCallback(() => {
    setError(null);
    setIsRecovering(false);
    setReconnectAttempts(0);

    if (reconnectTimeoutRef.current !== null) {
      window.clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  // Fetch available campaigns (simplified)
  const {
    data: campaignsData,
    isLoading: isLoadingCampaigns,
    refetch: refetchCampaigns,
    error: campaignsError,
  } = useQuery({
    queryKey: ["campaigns-for-testing"],
    queryFn: async () => {
      try {
        console.log("Fetching campaigns for web call testing...");

        const userData = localStorage.getItem("user");
        if (!userData) {
          throw new Error("User not authenticated");
        }

        const user = JSON.parse(userData);
        if (!user.token) {
          throw new Error("No authentication token");
        }

        const response = await api.get("/campaigns", {
          headers: {
            Authorization: `Bearer ${user.token}`,
          },
          params: {
            limit: 100,
          },
        });

        let campaigns = [];
        if (response.data?.campaigns) {
          campaigns = response.data.campaigns;
        } else if (Array.isArray(response.data)) {
          campaigns = response.data;
        } else if (response.data?.data) {
          campaigns = response.data.data;
        }

        const testableCampaigns = campaigns.filter(
          (campaign: Campaign) =>
            campaign.status === "Active" ||
            campaign.status === "Draft" ||
            campaign.status === "Paused"
        );

        return testableCampaigns;
      } catch (err: any) {
        console.error("Error fetching campaigns:", err);
        if (err.response?.status === 401) {
          throw new Error("Authentication failed. Please log in again.");
        }
        throw err;
      }
    },
    enabled: !!user,
    staleTime: 30000,
    retry: (failureCount, error: any) => {
      if (error?.response?.status === 401 || error?.response?.status === 403) {
        return false;
      }
      return failureCount < 2;
    },
  });

  // Refresh campaigns function
  const refreshCampaigns = useCallback(async () => {
    try {
      resetErrorState();
      await refetchCampaigns();
      return true;
    } catch (error) {
      handleError(
        "unknown",
        "Failed to refresh campaigns. Please try again.",
        true
      );
      return false;
    }
  }, [refetchCampaigns, handleError, resetErrorState]);

  // Test API connection
  const testAPIConnection = useCallback(async () => {
    console.log("Testing API connection...");
    try {
      const userData = localStorage.getItem("user");
      if (!userData) return false;

      const user = JSON.parse(userData);
      const response = await fetch("/api/campaigns", {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${user.token}`,
        },
      });

      console.log("API test response:", response.status);
      return response.ok;
    } catch (error) {
      console.error("API test failed:", error);
      return false;
    }
  }, []);

  // Simplified call controls
  const startCall = async () => {
    if (!selectedCampaignId) {
      handleError(
        "unknown",
        "Please select a campaign before starting a call",
        true
      );
      return;
    }

    resetErrorState();
    setCallState({
      status: "connecting",
      transcript: [],
      currentSpeaker: null,
    });

    // Simplified socket connection logic would go here
    console.log("Starting call with campaign:", selectedCampaignId);
  };

  const endCall = () => {
    resetErrorState();
    setCallState((prev) => ({
      ...prev,
      status: "ended",
      currentSpeaker: null,
      error: undefined,
    }));
    console.log("Ending call");
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
  };

  // Status helpers
  const getStatusColor = () => {
    switch (callState.status) {
      case "idle":
        return "bg-gray-400";
      case "connecting":
        return "bg-yellow-500";
      case "connected":
        return "bg-blue-500";
      case "speaking":
        return "bg-green-500";
      case "listening":
        return "bg-blue-500";
      case "processing":
        return "bg-purple-500";
      case "ended":
        return "bg-gray-500";
      case "error":
        return "bg-red-500";
      default:
        return "bg-gray-400";
    }
  };

  const getStatusLabel = () => {
    switch (callState.status) {
      case "idle":
        return "Ready";
      case "connecting":
        return "Connecting...";
      case "connected":
        return "Connected";
      case "speaking":
        return "Agent Speaking";
      case "listening":
        return "Listening";
      case "processing":
        return "Processing";
      case "ended":
        return "Call Ended";
      case "error":
        return "Error";
      default:
        return "Unknown";
    }
  };

  const isCallActive =
    callState.status !== "idle" &&
    callState.status !== "ended" &&
    callState.status !== "error";

  // Loading state
  if (isLoadingCampaigns) {
    return (
      <div
        className={`web-call-testing ${className}`}
        style={{ width, height }}
      >
        <div className="h-full flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
            <p className="text-slate-600">Loading campaigns...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`web-call-testing ${className}`} style={{ width, height }}>
      <div className="h-full flex flex-col lg:flex-row gap-6">
        {/* Left Panel - Campaign Selection & Controls */}
        <div className="lg:w-1/3 space-y-6">
          {/* Campaign Selection */}
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center">
                <Users className="h-5 w-5 mr-2 text-blue-600" />
                Campaign Selection
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Select
                value={selectedCampaignId}
                onValueChange={setSelectedCampaignId}
                disabled={isCallActive}
              >
                <SelectTrigger className="h-12">
                  <SelectValue
                    placeholder={
                      campaignsData && campaignsData.length > 0
                        ? "Select a campaign to test"
                        : "No campaigns available"
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {campaignsData && campaignsData.length > 0 ? (
                    campaignsData.map((campaign: Campaign) => (
                      <SelectItem key={campaign._id} value={campaign._id}>
                        <div className="flex items-center justify-between w-full">
                          <span className="font-medium">{campaign.name}</span>
                          <Badge
                            variant={
                              campaign.status === "Active"
                                ? "default"
                                : "secondary"
                            }
                            className="ml-2"
                          >
                            {campaign.status}
                          </Badge>
                        </div>
                      </SelectItem>
                    ))
                  ) : (
                    <SelectItem value="no-campaigns" disabled>
                      No campaigns available
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>

              {/* Campaign Status */}
              {campaignsData && campaignsData.length > 0 && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-lg">
                  <div className="flex items-center text-green-700">
                    <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                    <span className="text-sm font-medium">
                      {campaignsData.length} campaign
                      {campaignsData.length !== 1 ? "s" : ""} ready for testing
                    </span>
                  </div>
                </div>
              )}

              {/* Error States */}
              {campaignsError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="text-red-700 text-sm">
                    <div className="font-medium mb-1">
                      Error loading campaigns
                    </div>
                    <div className="text-xs mb-2">{campaignsError.message}</div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => refreshCampaigns()}
                      >
                        Retry
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => testAPIConnection()}
                      >
                        Test Connection
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {!campaignsError &&
                (!campaignsData || campaignsData.length === 0) && (
                  <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="text-amber-700 text-sm">
                      <div className="font-medium mb-1">
                        No campaigns available
                      </div>
                      <div className="text-xs mb-2">
                        Create a campaign to start testing your voice agents
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => (window.location.href = "/campaigns")}
                      >
                        Create Campaign
                      </Button>
                    </div>
                  </div>
                )}
            </CardContent>
          </Card>

          {/* Call Status & Controls */}
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60">
            <CardHeader className="pb-4">
              <CardTitle className="text-lg flex items-center">
                <PhoneCall className="h-5 w-5 mr-2 text-blue-600" />
                Call Controls
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Status Display */}
              <div className="text-center p-4 bg-slate-50 rounded-lg">
                <div className="flex items-center justify-center gap-3 mb-2">
                  <div
                    className={`w-4 h-4 rounded-full ${getStatusColor()} shadow-lg`}
                  ></div>
                  <span className="font-semibold text-lg text-slate-900">
                    {getStatusLabel()}
                  </span>
                </div>
                {callState.currentSpeaker && (
                  <div className="text-sm text-slate-600">
                    {callState.currentSpeaker === "agent"
                      ? "🤖 Agent speaking"
                      : "🎤 You are speaking"}
                  </div>
                )}
              </div>

              {/* Error Display */}
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                    <div className="text-red-700 text-sm">
                      <div className="font-medium">
                        {error.type.replace("_", " ")}
                      </div>
                      <div className="text-xs mt-1">{error.message}</div>
                      {error.recoverable && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs mt-2"
                          onClick={() => resetErrorState()}
                        >
                          <RefreshCw className="h-3 w-3 mr-1" />
                          Retry
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Main Call Controls */}
              <div className="space-y-3">
                {!isCallActive ? (
                  <Button
                    onClick={startCall}
                    disabled={
                      !selectedCampaignId || campaignsData?.length === 0
                    }
                    className="w-full h-12 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold"
                  >
                    <Play className="h-5 w-5 mr-2" />
                    Start Voice Test
                  </Button>
                ) : (
                  <Button
                    onClick={endCall}
                    variant="destructive"
                    className="w-full h-12 font-semibold"
                  >
                    <Square className="h-5 w-5 mr-2" />
                    End Call
                  </Button>
                )}

                {/* Secondary Controls */}
                {isCallActive && (
                  <div className="flex gap-2">
                    <Button
                      onClick={toggleMute}
                      variant={isMuted ? "destructive" : "outline"}
                      className="flex-1 h-10"
                    >
                      {isMuted ? (
                        <MicOff className="h-4 w-4 mr-2" />
                      ) : (
                        <Mic className="h-4 w-4 mr-2" />
                      )}
                      {isMuted ? "Unmute" : "Mute"}
                    </Button>
                    <Button
                      variant="outline"
                      className="flex-1 h-10"
                      onClick={() => setVolume(volume > 0 ? 0 : 1)}
                    >
                      {volume > 0 ? (
                        <Volume2 className="h-4 w-4 mr-2" />
                      ) : (
                        <VolumeX className="h-4 w-4 mr-2" />
                      )}
                      Audio
                    </Button>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Quick Stats */}
          {isCallActive && (
            <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg flex items-center">
                  <Activity className="h-5 w-5 mr-2 text-blue-600" />
                  Live Stats
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="text-center p-2 bg-slate-50 rounded">
                    <div className="font-semibold text-slate-900">
                      {callState.transcript.length}
                    </div>
                    <div className="text-slate-600 text-xs">Messages</div>
                  </div>
                  <div className="text-center p-2 bg-slate-50 rounded">
                    <div className="font-semibold text-slate-900">
                      {callId ? new Date().toLocaleTimeString() : "--:--"}
                    </div>
                    <div className="text-slate-600 text-xs">Duration</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right Panel - Conversation & Analysis */}
        <div className="lg:w-2/3 space-y-6">
          {/* Audio Visualization */}
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60">
            <CardContent className="p-6">
              <WebCallAudioPlayer
                audioBuffer={currentAudioBuffer}
                autoPlay={true}
                showControls={false}
                showVisualization={true}
                onPlaybackStart={() => {
                  setCallState((prev) => ({
                    ...prev,
                    currentSpeaker: "agent",
                  }));
                }}
                onPlaybackEnd={() => {
                  setCallState((prev) => ({
                    ...prev,
                    currentSpeaker: null,
                  }));
                }}
              />
            </CardContent>
          </Card>

          {/* Main Content Tabs */}
          <Card className="bg-white/80 backdrop-blur-sm border-slate-200/60 flex-grow">
            <CardHeader className="pb-4">
              <Tabs
                defaultValue="transcript"
                value={activeTab}
                onValueChange={setActiveTab}
              >
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger
                    value="transcript"
                    className="flex items-center gap-2"
                  >
                    <MessageSquare className="h-4 w-4" />
                    Conversation
                  </TabsTrigger>
                  <TabsTrigger
                    value="metrics"
                    disabled={!isCallActive}
                    className="flex items-center gap-2"
                  >
                    <BarChart3 className="h-4 w-4" />
                    Metrics
                  </TabsTrigger>
                  <TabsTrigger
                    value="debug"
                    disabled={!isCallActive}
                    className="flex items-center gap-2"
                  >
                    <Settings className="h-4 w-4" />
                    Debug
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent className="flex-grow">
              <Tabs
                defaultValue="transcript"
                value={activeTab}
                onValueChange={setActiveTab}
              >
                <TabsContent value="transcript" className="h-96 mt-0">
                  <div className="flex flex-col h-full">
                    {testId && callState.status === "ended" && (
                      <div className="mb-3 flex justify-end">
                        <WebCallTranscriptExport testId={testId} />
                      </div>
                    )}
                    <div className="flex-grow border border-slate-200 rounded-lg overflow-hidden">
                      <WebCallTranscript
                        transcript={callState.transcript}
                        currentSpeaker={callState.currentSpeaker}
                        height="100%"
                      />
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="metrics" className="h-96 mt-0">
                  <div className="border border-slate-200 rounded-lg h-full overflow-hidden">
                    <RealTimeCallMonitoring metrics={metrics} />
                  </div>
                </TabsContent>
                <TabsContent value="debug" className="h-96 mt-0">
                  <div className="border border-slate-200 rounded-lg h-full overflow-hidden">
                    <WebCallDebugPanel
                      socket={socket}
                      isConnected={isConnected}
                    />
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default WebCallTesting;

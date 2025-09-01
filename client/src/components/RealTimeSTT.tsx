import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Mic, MicOff, RotateCcw, AlertCircle, CheckCircle } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { configApi } from "@/services/configApi";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface RealTimeSTTProps {
  apiKey?: string;
  onVerificationComplete?: (success: boolean) => void;
  autoStart?: boolean;
}

const RealTimeSTT: React.FC<RealTimeSTTProps> = ({
  apiKey: propApiKey,
  onVerificationComplete,
  autoStart = false,
}) => {
  const [isRecording, setIsRecording] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<
    "idle" | "connected" | "error" | "verifying" | "verified"
  >("idle");
  const [apiKey, setApiKey] = useState<string | null>(propApiKey || null);
  const [showVerificationSuccess, setShowVerificationSuccess] = useState(false);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Load API key on component mount
  useEffect(() => {
    // If API key is provided as a prop, use it
    if (propApiKey) {
      setApiKey(propApiKey);
      return;
    }

    const loadApiKey = async () => {
      try {
        const config = await configApi.getConfiguration();

        // Look in different possible places for the API key
        const foundApiKey =
          config.deepgramApiKey ||
          config.sttConfig?.deepgramApiKey ||
          config.asrConfig?.apiKey ||
          config.deepgramConfig?.apiKey;

        if (foundApiKey) {
          setApiKey(foundApiKey);
          console.log("API key loaded from configuration");
        } else {
          toast({
            title: "API Key Not Found",
            description:
              "Deepgram API key is not configured. Please add it in the Configuration page.",
            variant: "destructive",
          });
        }
      } catch (error) {
        console.error("Error loading API key:", error);
        toast({
          title: "Failed to Load Configuration",
          description: "Could not load Deepgram API key from configuration.",
          variant: "destructive",
        });
      }
    };

    loadApiKey();

    // Clean up on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
      }
    };
  }, [propApiKey]);

  // Auto-start recording if specified
  useEffect(() => {
    if (autoStart && apiKey && !isRecording && connectionStatus === "idle") {
      startRecording();
    }
  }, [autoStart, apiKey, isRecording, connectionStatus]);

  const startRecording = async (isVerification = false) => {
    try {
      setIsLoading(true);

      if (isVerification) {
        setConnectionStatus("verifying");
        setTranscript("");
      }

      // Check if API key is available
      if (!apiKey) {
        toast({
          title: "API Key Missing",
          description:
            "Deepgram API key is required. Please configure it in the Configuration page.",
          variant: "destructive",
        });
        setIsLoading(false);
        if (onVerificationComplete) onVerificationComplete(false);
        return;
      }

      // Request microphone access
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

        // Set up WebSocket connection to Deepgram
        const socket = new WebSocket("wss://api.deepgram.com/v1/listen", [
          "token",
          apiKey,
        ]);

        socket.onopen = () => {
          // Configure Deepgram streaming parameters
          socket.send(
            JSON.stringify({
              sampling_rate: 16000,
              channels: 1,
              encoding: "linear16",
              language: "en",
              model: "nova-2",
              interim_results: true,
            })
          );

          if (isVerification) {
            setConnectionStatus("verified");
            if (onVerificationComplete) onVerificationComplete(true);
            setShowVerificationSuccess(true);

            // For verification, we'll close the socket after 2 seconds
            setTimeout(() => {
              if (socket.readyState === WebSocket.OPEN) {
                socket.close();
              }
              setIsLoading(false);
            }, 2000);

            toast({
              title: "Connection Successful",
              description: "Successfully connected to Deepgram STT service.",
            });
            return;
          }

          setConnectionStatus("connected");

          // Set up MediaRecorder for audio capture
          const mediaRecorder = new MediaRecorder(stream);
          mediaRecorderRef.current = mediaRecorder;
          audioChunksRef.current = [];

          mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
              audioChunksRef.current.push(event.data);

              // Convert audio to format acceptable by Deepgram
              const reader = new FileReader();
              reader.readAsArrayBuffer(event.data);
              reader.onloadend = () => {
                const arrayBuffer = reader.result as ArrayBuffer;
                if (socket.readyState === WebSocket.OPEN) {
                  socket.send(arrayBuffer);
                }
              };
            }
          };

          mediaRecorder.start(250); // Send data every 250ms
          setIsRecording(true);
          setIsLoading(false);
        };

        socket.onmessage = (event) => {
          const data = JSON.parse(event.data);
          if (
            data.channel &&
            data.channel.alternatives &&
            data.channel.alternatives.length > 0
          ) {
            const newTranscript = data.channel.alternatives[0].transcript;
            if (newTranscript) {
              setTranscript((prev) => {
                // For continuous speech, we want to accumulate the transcript
                if (newTranscript.length > prev.length) {
                  return newTranscript;
                }
                return prev + " " + newTranscript;
              });
            }
          }
        };

        socket.onerror = (error) => {
          console.error("WebSocket Error:", error);
          setConnectionStatus("error");
          if (onVerificationComplete && isVerification) {
            onVerificationComplete(false);
          }
          toast({
            title: "Connection Error",
            description:
              "Failed to connect to Deepgram service. Check your API key and network connection.",
            variant: "destructive",
          });
          setIsLoading(false);
          setIsRecording(false);
        };

        socket.onclose = () => {
          console.log("WebSocket connection closed");
          if (connectionStatus !== "verified") {
            setConnectionStatus("idle");
          }
          setIsRecording(false);
        };

        socketRef.current = socket;
      } catch (micError) {
        console.error("Microphone access error:", micError);
        toast({
          title: "Microphone Access Denied",
          description:
            "Please allow microphone access to use speech-to-text functionality.",
          variant: "destructive",
        });
        setIsLoading(false);
        setIsRecording(false);
        if (onVerificationComplete && isVerification) {
          onVerificationComplete(false);
        }
      }
    } catch (error) {
      console.error("Error starting recording:", error);
      toast({
        title: "Recording Error",
        description: "Failed to set up recording. Please try again.",
        variant: "destructive",
      });
      setIsLoading(false);
      setIsRecording(false);
      if (onVerificationComplete && isVerification) {
        onVerificationComplete(false);
      }
    }
  };

  const stopRecording = () => {
    try {
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();

        // Stop all audio tracks
        mediaRecorderRef.current.stream
          .getTracks()
          .forEach((track) => track.stop());
      }

      if (socketRef.current) {
        socketRef.current.close();
      }

      setIsRecording(false);
      setConnectionStatus("idle");

      // Keep the transcript visible after stopping
    } catch (error) {
      console.error("Error stopping recording:", error);
      toast({
        title: "Error",
        description: "Failed to properly stop recording.",
        variant: "destructive",
      });
    }
  };

  const resetTranscript = () => {
    setTranscript("");
  };

  const verifyConnection = () => {
    startRecording(true);
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Mic className="h-5 w-5" />
          Real-time Speech-to-Text
        </CardTitle>
        <CardDescription>
          Test real-time voice transcription using Deepgram
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {connectionStatus === "verifying" && (
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-4 flex items-center">
            <RotateCcw className="h-5 w-5 mr-2 text-blue-500 animate-spin" />
            <div>
              <p className="font-medium">Verifying Connection</p>
              <p className="text-sm text-muted-foreground">
                Connecting to Deepgram API...
              </p>
            </div>
          </div>
        )}

        {connectionStatus === "verified" && (
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 mb-4 flex items-center">
            <CheckCircle className="h-5 w-5 mr-2 text-green-500" />
            <div>
              <p className="font-medium">Connection Verified</p>
              <p className="text-sm text-muted-foreground">
                Successfully connected to Deepgram API
              </p>
            </div>
          </div>
        )}

        {connectionStatus === "error" && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-4 flex items-center">
            <AlertCircle className="h-5 w-5 mr-2 text-red-500" />
            <div>
              <p className="font-medium">Connection Error</p>
              <p className="text-sm text-muted-foreground">
                Failed to connect to Deepgram API. Please check your API key.
              </p>
            </div>
          </div>
        )}

        <div className="flex justify-between">
          <Button
            onClick={() => (isRecording ? stopRecording() : startRecording())}
            disabled={isLoading || connectionStatus === "verifying"}
            variant={isRecording ? "destructive" : "default"}
            className="w-40"
          >
            {isLoading ? (
              <>
                <RotateCcw className="mr-2 h-4 w-4 animate-spin" />
                Connecting...
              </>
            ) : isRecording ? (
              <>
                <MicOff className="mr-2 h-4 w-4" />
                Stop Recording
              </>
            ) : (
              <>
                <Mic className="mr-2 h-4 w-4" />
                Start Recording
              </>
            )}
          </Button>

          <Button
            variant="outline"
            onClick={resetTranscript}
            disabled={!transcript || isLoading}
          >
            Clear Transcript
          </Button>
        </div>

        <div className="p-4 bg-muted rounded-lg min-h-[200px] max-h-[400px] overflow-y-auto">
          {transcript ? (
            <p className="whitespace-pre-wrap">{transcript}</p>
          ) : (
            <p className="text-muted-foreground">
              {isRecording ? "Speak now..." : "Transcript will appear here"}
            </p>
          )}
        </div>

        <div className="flex items-center">
          <div
            className="h-2 w-2 rounded-full mr-2"
            style={{
              backgroundColor:
                connectionStatus === "connected"
                  ? "#22c55e"
                  : connectionStatus === "verified"
                  ? "#22c55e"
                  : connectionStatus === "verifying"
                  ? "#3b82f6"
                  : connectionStatus === "error"
                  ? "#ef4444"
                  : "#a1a1aa",
            }}
          />
          <span className="text-sm text-muted-foreground">
            {connectionStatus === "connected"
              ? "Connected to Deepgram"
              : connectionStatus === "verified"
              ? "Verified connection to Deepgram"
              : connectionStatus === "verifying"
              ? "Verifying connection..."
              : connectionStatus === "error"
              ? "Connection error"
              : "Not connected"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
};

export default RealTimeSTT;

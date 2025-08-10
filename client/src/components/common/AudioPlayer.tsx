import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Download,
  RotateCcw,
  ChevronDown,
  SkipBack,
  SkipForward,
} from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import { Skeleton } from "@/components/ui/Skeleton";
import { Slider } from "@/components/ui/slider";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import api from "@/services/api";

interface AudioPlayerProps {
  audioUrl: string;
  isPlaying: boolean;
  onPlayPause: (isPlaying: boolean) => void;
  callId: string;
  leadName?: string;
  campaignName?: string;
}

const AudioPlayer = ({
  audioUrl,
  isPlaying,
  onPlayPause,
  callId,
  leadName,
  campaignName,
}: AudioPlayerProps) => {
  const waveformRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const [loading, setLoading] = useState(true);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [useSimplePlayer, setUseSimplePlayer] = useState(false);
  const [actuallyPlaying, setActuallyPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Test function to verify server endpoint (for debugging)
  const testServerEndpoint = async (callId: string) => {
    try {
      console.log("Testing server endpoint for call ID:", callId);
      const testUrl = `/calls/${callId}/recording?stream=true`;
      console.log("Test URL:", testUrl);

      const response = await api.get(testUrl, {
        responseType: "blob",
        headers: {
          Accept: "audio/mpeg, audio/wav, audio/*",
        },
        timeout: 10000,
      });

      console.log("Test response:", {
        status: response.status,
        contentType: response.headers["content-type"],
        size: response.data?.size,
        hasData: !!response.data,
      });

      return response.data?.size > 0;
    } catch (error) {
      console.error("Test endpoint failed:", error);
      return false;
    }
  };

  // Function to fetch authenticated audio and create blob URL
  const fetchAuthenticatedAudio = async (url: string): Promise<string> => {
    try {
      console.log("Fetching authenticated audio for URL:", url);

      // Check if it's already a streaming URL
      if (
        url.includes("/api/calls/") &&
        url.includes("/recording") &&
        url.includes("stream=true")
      ) {
        console.log("URL is already a streaming URL, using directly");

        // Remove the base URL if present to make it relative
        let apiUrl = url;
        if (url.startsWith("http://") || url.startsWith("https://")) {
          const urlObj = new URL(url);
          apiUrl = urlObj.pathname + urlObj.search;
        }

        console.log("Using API URL:", apiUrl);

        const response = await api.get(apiUrl, {
          responseType: "blob",
          headers: {
            Accept: "audio/mpeg, audio/wav, audio/*",
          },
          timeout: 30000, // 30 second timeout
        });

        console.log("Direct streaming API response status:", response.status);
        console.log("Direct streaming API response headers:", response.headers);
        console.log(
          "Direct streaming API response data type:",
          typeof response.data
        );
        console.log(
          "Direct streaming API response data size:",
          response.data?.size || "unknown"
        );

        // Create blob URL
        const blob = new Blob([response.data], {
          type: response.headers["content-type"] || "audio/mpeg",
        });
        const blobUrl = URL.createObjectURL(blob);
        console.log("Created blob URL from direct streaming:", blobUrl);
        return blobUrl;
      }

      // Check if it's a proxy URL that needs streaming parameter added
      else if (url.includes("/api/calls/") && url.includes("/recording")) {
        // Extract call ID from URL like "/api/calls/CALL_ID/recording"
        const callIdMatch = url.match(/\/api\/calls\/([^\/]+)\/recording/);
        if (callIdMatch) {
          const extractedCallId = callIdMatch[1];
          console.log("Extracted call ID:", extractedCallId);

          // Use the streaming endpoint to fetch the audio with Twilio authentication
          const streamingUrl = `/calls/${extractedCallId}/recording?stream=true`;
          console.log("Using streaming URL:", streamingUrl);

          const response = await api.get(streamingUrl, {
            responseType: "blob",
            headers: {
              Accept: "audio/mpeg, audio/wav, audio/*",
            },
          });

          console.log("Streaming API response status:", response.status);
          console.log("Streaming API response headers:", response.headers);
          console.log(
            "Streaming API response data type:",
            typeof response.data
          );
          console.log(
            "Streaming API response data size:",
            response.data?.size || "unknown"
          );

          // Create blob URL
          const blob = new Blob([response.data], {
            type: response.headers["content-type"] || "audio/mpeg",
          });
          const blobUrl = URL.createObjectURL(blob);
          console.log("Created blob URL from streaming endpoint:", blobUrl);
          return blobUrl;
        }
      }

      // For direct URLs, we need to use the call ID to fetch through our API
      console.log("Processing direct URL for authenticated access:", url);

      // Try to extract call ID from various URL patterns
      let extractedCallId = null;

      // Pattern 1: /api/calls/CALL_ID/recording
      let callIdMatch = url.match(/\/api\/calls\/([^\/]+)\/recording/);
      if (callIdMatch) {
        extractedCallId = callIdMatch[1];
      }

      // Pattern 2: URL contains call ID in query params or path
      if (!extractedCallId) {
        callIdMatch = url.match(/[?&]callId=([^&]+)/);
        if (callIdMatch) {
          extractedCallId = callIdMatch[1];
        }
      }

      // Pattern 3: Use the callId prop if available
      if (!extractedCallId && callId) {
        extractedCallId = callId;
        console.log("Using callId prop:", extractedCallId);
      }

      if (extractedCallId) {
        console.log("Fetching audio through API for call ID:", extractedCallId);
        try {
          const streamingUrl = `/calls/${extractedCallId}/recording?stream=true`;
          console.log(
            "Using streaming URL for extracted call ID:",
            streamingUrl
          );

          const response = await api.get(streamingUrl, {
            responseType: "blob",
            headers: {
              Accept: "audio/mpeg, audio/wav, audio/*",
            },
          });

          console.log("Streaming API response status:", response.status);
          console.log(
            "Streaming API response data size:",
            response.data?.size || "unknown"
          );

          const blob = new Blob([response.data], {
            type: response.headers["content-type"] || "audio/mpeg",
          });
          const blobUrl = URL.createObjectURL(blob);
          console.log("Created blob URL from streaming API fetch:", blobUrl);
          return blobUrl;
        } catch (apiFetchError) {
          console.error("API fetch failed:", apiFetchError);
          throw new Error(
            `Failed to fetch authenticated audio: ${
              apiFetchError instanceof Error
                ? apiFetchError.message
                : "Unknown error"
            }`
          );
        }
      } else {
        console.error("Could not extract call ID from URL:", url);
        console.log("Available callId prop:", callId);

        // Last resort: if we have a callId prop, try using that
        if (callId) {
          console.log("Using callId prop as fallback:", callId);
          try {
            const streamingUrl = `/calls/${callId}/recording?stream=true`;
            console.log("Using streaming URL with callId prop:", streamingUrl);

            const response = await api.get(streamingUrl, {
              responseType: "blob",
              headers: {
                Accept: "audio/mpeg, audio/wav, audio/*",
              },
            });

            const blob = new Blob([response.data], {
              type: response.headers["content-type"] || "audio/mpeg",
            });
            const blobUrl = URL.createObjectURL(blob);
            console.log(
              "Created blob URL using callId prop streaming:",
              blobUrl
            );
            return blobUrl;
          } catch (fallbackError) {
            console.error("Fallback API fetch failed:", fallbackError);
            throw new Error(
              `Failed to fetch authenticated audio: ${
                fallbackError instanceof Error
                  ? fallbackError.message
                  : "Unknown error"
              }`
            );
          }
        } else {
          throw new Error(
            "Unable to authenticate audio access - no call ID available"
          );
        }
      }
    } catch (error) {
      console.error("Error fetching authenticated audio:", error);

      // Log detailed error information
      if ((error as any).response) {
        const axiosError = error as any;
        console.error("API Error Details:", {
          status: axiosError.response.status,
          statusText: axiosError.response.statusText,
          data: axiosError.response.data,
          headers: axiosError.response.headers,
          url: axiosError.config?.url,
        });
      } else if ((error as any).request) {
        console.error(
          "Network Error - No response received:",
          (error as any).request
        );
      } else {
        console.error("Error setting up request:", (error as any).message);
      }

      throw error;
    }
  };

  // Expose test function globally for debugging
  useEffect(() => {
    (window as any).testAudioEndpoint = () => testServerEndpoint(callId);
  }, [callId]);

  useEffect(() => {
    if (!waveformRef.current) return;

    // Clean up previous blob URL
    if (blobUrl) {
      URL.revokeObjectURL(blobUrl);
      setBlobUrl(null);
    }

    const initializeWaveSurfer = async () => {
      try {
        console.group("🎵 AudioPlayer Initialization");
        console.log("Call ID:", callId);
        console.log("Original URL:", audioUrl);
        console.log("Lead Name:", leadName);
        console.log("Campaign:", campaignName);
        console.log("DOM ref available:", !!waveformRef.current);

        setLoading(true);
        setError(null);
        setActuallyPlaying(false);

        // Stop any existing audio before initializing new instance
        if (wavesurferRef.current) {
          try {
            wavesurferRef.current.pause();
          } catch (e) {
            console.warn("Error stopping existing WaveSurfer:", e);
          }
        }
        if (audioRef.current) {
          audioRef.current.pause();
        }

        // Fetch authenticated audio and get blob URL
        console.log("🔐 Fetching authenticated audio...");
        const audioUrlToUse = await fetchAuthenticatedAudio(audioUrl);
        console.log(
          "✅ Audio URL processed:",
          audioUrlToUse.substring(0, 100) + "..."
        );
        setBlobUrl(audioUrlToUse);

        // Clean up existing WaveSurfer instance
        if (wavesurferRef.current) {
          try {
            wavesurferRef.current.pause();
            wavesurferRef.current.destroy();
          } catch (e) {
            console.warn("Error cleaning up previous WaveSurfer instance:", e);
          }
          wavesurferRef.current = null;
        }

        // Also ensure simple audio player is stopped
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current.src = "";
        }

        // Create new WaveSurfer instance
        const wavesurfer = WaveSurfer.create({
          container: waveformRef.current!,
          waveColor: "#9ca3af", // gray-400
          progressColor: "#6366f1", // indigo-500
          cursorColor: "#6366f1", // visible cursor that follows playback
          barWidth: 2,
          barGap: 2,
          barRadius: 3,
          height: 60,
          responsive: true,
          normalize: true, // Normalize the waveform
          pixelRatio: window.devicePixelRatio || 1,
        });

        wavesurfer.on("ready", () => {
          console.log("✅ WaveSurfer ready!");
          console.log("Duration:", wavesurfer.getDuration(), "seconds");
          console.log("Should auto-play:", isPlaying);
          console.groupEnd(); // Close the initialization group

          setLoading(false);
          setDuration(wavesurfer.getDuration());
          // Set initial volume
          wavesurfer.setVolume(volume);

          // Don't auto-play on ready to prevent duplicate playback
          // The useEffect will handle play/pause state changes
        });

        wavesurfer.on("audioprocess", () => {
          setCurrentTime(wavesurfer.getCurrentTime());
        });

        wavesurfer.on("play", () => {
          console.log("WaveSurfer started playing");
          setActuallyPlaying(true);
          // Only update parent state if it's not already playing
          if (!isPlaying) {
            onPlayPause(true);
          }
        });

        wavesurfer.on("pause", () => {
          console.log("WaveSurfer paused");
          setActuallyPlaying(false);
          // Only update parent state if it's currently playing
          if (isPlaying) {
            onPlayPause(false);
          }
        });

        wavesurfer.on("finish", () => {
          console.log("WaveSurfer finished playing");
          setActuallyPlaying(false);
          onPlayPause(false);
        });

        wavesurfer.on("error", (err) => {
          console.group("🔴 WaveSurfer Error Details");
          console.error("Original URL:", audioUrl);
          console.error("Processed URL:", audioUrlToUse);
          console.error("Call ID:", callId);
          console.error("Error object:", err);
          console.error("Error details:", {
            message: err?.message || "Unknown error",
            stack: err?.stack,
            type: typeof err,
            audioUrl: audioUrlToUse,
            timestamp: new Date().toISOString(),
          });
          console.groupEnd();

          setLoading(false);

          // Provide more specific error messages based on error type
          let errorMessage = "Failed to load audio recording";
          if (err?.message?.includes("CORS")) {
            errorMessage =
              "Audio blocked by CORS policy. Try using authenticated endpoint.";
          } else if (
            err?.message?.includes("404") ||
            err?.message?.includes("Not Found")
          ) {
            errorMessage =
              "Audio recording not found. Please check the call ID.";
          } else if (
            err?.message?.includes("403") ||
            err?.message?.includes("Forbidden")
          ) {
            errorMessage = "Access denied. Please check authentication.";
          } else if (err?.message?.includes("timeout")) {
            errorMessage = "Audio loading timed out. Please try again.";
          } else if (err?.message) {
            errorMessage = `Audio error: ${err.message}`;
          }

          setError(errorMessage);
        });

        wavesurfer.on("loading", (percent) => {
          console.log(`Loading audio: ${percent}%`);
          if (percent === 100) {
            console.log("Audio loading completed");
          }
        });

        // Add a timeout for loading
        const loadingTimeout = setTimeout(() => {
          if (loading) {
            console.error("Audio loading timeout");
            setLoading(false);
            setError("Audio loading timed out. Please try again.");
          }
        }, 30000); // 30 second timeout

        wavesurfer.on("ready", () => {
          clearTimeout(loadingTimeout);
        });

        wavesurfer.on("error", () => {
          clearTimeout(loadingTimeout);
        });

        // Use click event for seeking to clicked position
        waveformRef.current!.addEventListener("click", (e) => {
          if (wavesurfer && !loading) {
            const rect = waveformRef.current!.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const progress = clickX / rect.width;
            const seekTime = progress * wavesurfer.getDuration();
            
            console.log("Waveform clicked - seeking to:", seekTime, "seconds");
            wavesurfer.seekTo(progress);
            
            // If currently playing, continue playing after seek
            if (isPlaying && !actuallyPlaying) {
              setTimeout(() => {
                if (wavesurfer && isPlaying) {
                  wavesurfer.play();
                }
              }, 50);
            }
          }
        });

        wavesurferRef.current = wavesurfer;

        // Load the audio file
        console.log("Loading audio file:", audioUrlToUse);
        wavesurfer.load(audioUrlToUse);

        // Test if the audio URL is accessible by creating a test audio element
        const testAudio = new Audio();
        testAudio.muted = true; // Ensure test audio is muted
        testAudio.preload = "metadata"; // Only load metadata, not the full audio
        testAudio.oncanplaythrough = () => {
          console.log("Audio URL is accessible and can play");
        };
        testAudio.onerror = (e) => {
          console.error("Test audio failed to load:", e);
          console.log("Audio URL that failed:", audioUrlToUse);
        };
        testAudio.src = audioUrlToUse;

        // Clean up test audio after 5 seconds
        setTimeout(() => {
          testAudio.src = "";
          testAudio.remove();
        }, 5000);
      } catch (error) {
        console.error("Error initializing WaveSurfer:", error);
        console.log("Falling back to simple HTML5 audio player");
        setLoading(false);
        setUseSimplePlayer(true);

        // Try to set up simple audio player
        try {
          const audioUrlToUse = await fetchAuthenticatedAudio(audioUrl);
          setBlobUrl(audioUrlToUse);
        } catch (fallbackError) {
          console.error("Fallback audio player also failed:", fallbackError);
          setError("Failed to load audio recording");
        }
      }
    };

    initializeWaveSurfer();

    // Clean up on unmount
    return () => {
      // Stop any playing audio before cleanup
      if (wavesurferRef.current) {
        try {
          wavesurferRef.current.pause();
          wavesurferRef.current.destroy();
        } catch (e) {
          console.warn("Error during WaveSurfer cleanup:", e);
        }
        wavesurferRef.current = null;
      }

      // Stop simple audio player if active
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }

      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [audioUrl]);

  // Handle play/pause
  useEffect(() => {
    console.log(
      "Play/pause state changed:",
      isPlaying,
      "actuallyPlaying:",
      actuallyPlaying
    );

    // Avoid infinite loops by checking if state is already correct
    if (isPlaying === actuallyPlaying) {
      console.log('State already synchronized, skipping action');
      return;
    }

    if (useSimplePlayer && audioRef.current) {
      console.log(
        "Controlling simple audio player:",
        isPlaying ? "play" : "pause"
      );
      if (isPlaying && !actuallyPlaying) {
        audioRef.current.play().catch((e) => {
          console.error("Simple player play error:", e);
          setActuallyPlaying(false);
          onPlayPause(false); // Reset state on error
        });
      } else if (!isPlaying && actuallyPlaying) {
        audioRef.current.pause();
      }
    } else if (wavesurferRef.current && !loading && duration > 0) {
      console.log("Controlling WaveSurfer:", isPlaying ? "play" : "pause");
      console.log("WaveSurfer ready state - duration:", duration);
      try {
        if (isPlaying && !actuallyPlaying) {
          try {
            wavesurferRef.current.play();
          } catch (playError) {
            console.log("WaveSurfer not ready yet, waiting...", playError);
            // Try again after a short delay
            setTimeout(() => {
              if (wavesurferRef.current && isPlaying && !actuallyPlaying) {
                try {
                  wavesurferRef.current.play();
                } catch (retryError) {
                  console.error("WaveSurfer play retry failed:", retryError);
                  setActuallyPlaying(false);
                  onPlayPause(false);
                }
              }
            }, 100);
          }
        } else if (!isPlaying && actuallyPlaying) {
          wavesurferRef.current.pause();
        }
      } catch (error) {
        console.error("WaveSurfer control error:", error);
        setActuallyPlaying(false);
        onPlayPause(false); // Reset state on error
      }
    } else {
      console.log("Cannot control audio player yet:", {
        useSimplePlayer,
        hasWaveSurfer: !!wavesurferRef.current,
        loading,
        duration,
      });
    }
  }, [isPlaying, useSimplePlayer, loading, actuallyPlaying, duration]);

  // Handle mute/unmute
  useEffect(() => {
    if (wavesurferRef.current) {
      wavesurferRef.current.setMuted(muted);
    }
  }, [muted]);

  // Handle volume change
  useEffect(() => {
    if (wavesurferRef.current && !muted) {
      wavesurferRef.current.setVolume(volume);
    }
  }, [volume, muted]);

  // Handle playback rate change
  useEffect(() => {
    if (wavesurferRef.current) {
      // Try to use WaveSurfer's playbackRate if available, otherwise fallback to HTML5 Audio
      try {
        if (typeof wavesurferRef.current.setPlaybackRate === "function") {
          wavesurferRef.current.setPlaybackRate(playbackRate);
        } else {
          // Fallback to manipulating HTML audio element directly
          const audioElement = document.querySelector(
            `#waveform-${callId} audio`
          );
          if (audioElement) {
            (audioElement as HTMLAudioElement).playbackRate = playbackRate;
          }
        }
      } catch (err) {
        console.error("Error setting playback rate:", err);
        // Fallback to manipulating HTML audio element directly
        const audioElement = document.querySelector(
          `#waveform-${callId} audio`
        );
        if (audioElement) {
          (audioElement as HTMLAudioElement).playbackRate = playbackRate;
        }
      }
    }
  }, [playbackRate, callId]);

  // Handle click outside volume slider
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (showVolumeSlider) {
        const volumeSlider = document.getElementById(`volume-slider-${callId}`);
        const volumeButton = document.getElementById(`volume-button-${callId}`);

        if (
          volumeSlider &&
          volumeButton &&
          !volumeSlider.contains(event.target as Node) &&
          !volumeButton.contains(event.target as Node)
        ) {
          setShowVolumeSlider(false);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [showVolumeSlider, callId]);

  // Stop all audio sources to prevent duplicate playback
  const stopAllAudio = () => {
    // Stop WaveSurfer
    if (wavesurferRef.current) {
      try {
        wavesurferRef.current.pause();
      } catch (e) {
        console.warn("Error pausing WaveSurfer:", e);
      }
    }

    // Stop simple audio player
    if (audioRef.current) {
      audioRef.current.pause();
    }

    setActuallyPlaying(false);
  };

  // Handle playback control
  const handlePlayPause = () => {
    console.log("🎵 Play/pause button clicked!");
    console.log("Current isPlaying state:", isPlaying);
    console.log("Current actuallyPlaying state:", actuallyPlaying);
    console.log("Loading state:", loading);
    console.log("Error state:", error);
    console.log("Will change to:", !isPlaying);

    // Ensure we're not in an error state or loading
    if (loading) {
      console.warn("Cannot play/pause while loading");
      return;
    }

    if (error) {
      console.warn("Cannot play/pause while in error state");
      return;
    }

    // If we're going to play, first stop all audio to prevent duplicates
    if (!isPlaying) {
      stopAllAudio();
      // Small delay to ensure audio is stopped before starting new playback
      setTimeout(() => {
        onPlayPause(true);
      }, 50);
    } else {
      onPlayPause(false);
    }
  };

  const handleVolumeChange = (value: number[]) => {
    setVolume(value[0]);
    if (value[0] > 0 && muted) {
      setMuted(false);
    } else if (value[0] === 0 && !muted) {
      setMuted(true);
    }
  };

  const handlePlaybackRateChange = (rate: number) => {
    setPlaybackRate(rate);
  };

  const handleRestart = () => {
    console.log("Restart button clicked");
    if (useSimplePlayer && audioRef.current) {
      audioRef.current.currentTime = 0;
      if (!isPlaying) {
        onPlayPause(true);
      }
    } else if (wavesurferRef.current) {
      wavesurferRef.current.seekTo(0);
      if (!isPlaying) {
        onPlayPause(true);
      }
    }
  };

  const handleSkipBackward = () => {
    console.log("Skip backward clicked");
    if (useSimplePlayer && audioRef.current) {
      const newTime = Math.max(0, currentTime - 5);
      audioRef.current.currentTime = newTime;
    } else if (wavesurferRef.current) {
      try {
        if (typeof wavesurferRef.current.skip === "function") {
          wavesurferRef.current.skip(-5);
        } else {
          const newTime = Math.max(0, currentTime - 5);
          wavesurferRef.current.seekTo(newTime / duration);
        }
      } catch (err) {
        console.error("Error skipping backward:", err);
        const newTime = Math.max(0, currentTime - 5);
        wavesurferRef.current.seekTo(newTime / duration);
      }
    }
  };

  const handleSkipForward = () => {
    console.log("Skip forward clicked");
    if (useSimplePlayer && audioRef.current) {
      const newTime = Math.min(duration, currentTime + 5);
      audioRef.current.currentTime = newTime;
    } else if (wavesurferRef.current) {
      try {
        if (typeof wavesurferRef.current.skip === "function") {
          wavesurferRef.current.skip(5);
        } else {
          const newTime = Math.min(duration, currentTime + 5);
          wavesurferRef.current.seekTo(newTime / duration);
        }
      } catch (err) {
        console.error("Error skipping forward:", err);
        const newTime = Math.min(duration, currentTime + 5);
        wavesurferRef.current.seekTo(newTime / duration);
      }
    }
  };

  const handleDownload = async () => {
    try {
      let filename = `${leadName || "Call"}_${
        new Date().toISOString().split("T")[0]
      }.mp3`;

      // Always use authenticated API to fetch the audio
      console.log("Downloading audio for call ID:", callId);

      const streamingUrl = `/calls/${callId}/recording?stream=true`;
      console.log("Downloading audio using streaming URL:", streamingUrl);

      const response = await api.get(streamingUrl, {
        responseType: "blob",
        headers: {
          Accept: "audio/mpeg, audio/wav, audio/*",
        },
      });

      // Determine file extension from content type
      const contentType = response.headers["content-type"] || "audio/mpeg";
      const extension = contentType.includes("wav") ? "wav" : "mp3";
      filename = `${leadName || "Call"}_${
        new Date().toISOString().split("T")[0]
      }.${extension}`;

      const downloadUrl = URL.createObjectURL(
        new Blob([response.data], { type: contentType })
      );

      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up blob URL
      URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error("Error downloading audio:", error);
    }
  };

  const formatTime = (seconds: number): string => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="bg-muted/30 p-4 rounded-lg border mt-2">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-4 min-w-0 flex-1">
          <Button
            variant="outline"
            size="sm"
            className={`rounded-full h-10 w-10 p-0 flex items-center justify-center flex-shrink-0 border-2 hover:bg-accent hover:text-accent-foreground transition-all ${
              loading || error !== null
                ? "opacity-50 cursor-not-allowed"
                : "opacity-100 cursor-pointer"
            } ${
              isPlaying || actuallyPlaying 
                ? "bg-primary text-primary-foreground hover:bg-primary/90" 
                : "bg-background"
            }`}
            onClick={handlePlayPause}
            disabled={loading || error !== null}
            title={
              loading
                ? "Loading..."
                : error
                ? "Error - cannot play"
                : isPlaying || actuallyPlaying
                ? "Pause Audio"
                : "Play Audio"
            }
            aria-label={
              loading
                ? "Loading audio"
                : error
                ? "Error - cannot play audio"
                : isPlaying || actuallyPlaying
                ? "Pause audio"
                : "Play audio"
            }
            style={{ minWidth: "40px", minHeight: "40px" }}
          >
            {loading ? (
              <div className="h-5 w-5 border-2 border-current border-t-transparent rounded-full animate-spin" />
            ) : isPlaying || actuallyPlaying ? (
              <Pause className="h-5 w-5" />
            ) : (
              <Play className="h-5 w-5 ml-0.5" />
            )}
          </Button>

          <div className="text-sm">
            <div className="font-medium">{leadName || "Call Recording"}</div>
            <div className="text-muted-foreground text-xs">
              {campaignName || "Campaign"}
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          <div className="text-xs text-muted-foreground">
            {formatTime(currentTime)} / {formatTime(duration)}
          </div>

          <div className="relative">
            <Button
              id={`volume-button-${callId}`}
              variant="ghost"
              size="sm"
              className="rounded-full h-8 w-8 p-0"
              onClick={() => {
                setShowVolumeSlider(!showVolumeSlider);
                if (volume === 0) {
                  setVolume(1);
                  setMuted(false);
                }
              }}
            >
              {muted || volume === 0 ? (
                <VolumeX className="h-4 w-4" />
              ) : (
                <Volume2 className="h-4 w-4" />
              )}
            </Button>

            {showVolumeSlider && (
              <div
                id={`volume-slider-${callId}`}
                className="absolute right-0 top-full mt-2 bg-background border rounded-md p-2 shadow-md z-10 w-32"
              >
                <Slider
                  value={[muted ? 0 : volume]}
                  min={0}
                  max={1}
                  step={0.01}
                  onValueChange={handleVolumeChange}
                  className="w-full"
                />
              </div>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 px-2">
                {playbackRate}x <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handlePlaybackRateChange(0.5)}>
                0.5x
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePlaybackRateChange(0.75)}>
                0.75x
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePlaybackRateChange(1)}>
                1x (Normal)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePlaybackRateChange(1.25)}>
                1.25x
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePlaybackRateChange(1.5)}>
                1.5x
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handlePlaybackRateChange(2)}>
                2x
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <Button
            variant="ghost"
            size="sm"
            className="rounded-full h-8 w-8 p-0"
            onClick={handleDownload}
            title="Download recording"
          >
            <Download className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-center space-x-3 mb-3">
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full h-8 w-8 p-0"
          onClick={handleRestart}
          disabled={loading}
          title="Restart"
        >
          <RotateCcw className="h-4 w-4" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="rounded-full h-8 w-8 p-0"
          onClick={handleSkipBackward}
          disabled={loading || currentTime < 5}
          title="Skip back 5 seconds"
        >
          <SkipBack className="h-4 w-4" />
        </Button>

        {/* Central Play/Pause Button */}
        <Button
          variant={isPlaying || actuallyPlaying ? "default" : "outline"}
          size="sm"
          className={`rounded-full h-12 w-12 p-0 flex items-center justify-center border-2 transition-all ${
            loading || error !== null
              ? "opacity-50 cursor-not-allowed"
              : "opacity-100 cursor-pointer hover:scale-105"
          }`}
          onClick={handlePlayPause}
          disabled={loading || error !== null}
          title={
            loading
              ? "Loading..."
              : error
              ? "Error - cannot play"
              : isPlaying || actuallyPlaying
              ? "Pause Audio"
              : "Play Audio"
          }
        >
          {loading ? (
            <div className="h-6 w-6 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : isPlaying || actuallyPlaying ? (
            <Pause className="h-6 w-6" />
          ) : (
            <Play className="h-6 w-6 ml-0.5" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="rounded-full h-8 w-8 p-0"
          onClick={handleSkipForward}
          disabled={loading || currentTime > duration - 5}
          title="Skip forward 5 seconds"
        >
          <SkipForward className="h-4 w-4" />
        </Button>
      </div>

      {error ? (
        <div className="h-[60px] w-full flex flex-col justify-center items-center space-y-2">
          <div className="text-sm text-destructive">{error}</div>
          <div className="flex space-x-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setError(null);
                setLoading(true);
                setUseSimplePlayer(false);
                // Force re-initialization by creating a new instance
                if (wavesurferRef.current) {
                  wavesurferRef.current.destroy();
                  wavesurferRef.current = null;
                }
                // The useEffect dependency will trigger re-initialization
              }}
            >
              Retry WaveSurfer
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                setError(null);
                setLoading(true);
                setUseSimplePlayer(true);
                try {
                  const audioUrlToUse = await fetchAuthenticatedAudio(audioUrl);
                  setBlobUrl(audioUrlToUse);
                  setLoading(false);
                } catch (fallbackError) {
                  console.error(
                    "Simple player fallback failed:",
                    fallbackError
                  );
                  setError("Failed to load audio recording");
                  setLoading(false);
                }
              }}
            >
              Use Simple Player
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                console.log("Testing server endpoint...");
                const result = await testServerEndpoint(callId);
                console.log("Test result:", result);
                alert(
                  `Server endpoint test: ${
                    result ? "SUCCESS" : "FAILED"
                  } - Check console for details`
                );
              }}
            >
              Test Server
            </Button>
          </div>
        </div>
      ) : useSimplePlayer ? (
        <div className="w-full">
          {blobUrl ? (
            <>
              <audio
                ref={audioRef}
                src={blobUrl}
                controls
                className="w-full"
                onLoadedData={() => {
                  console.log("Simple audio player loaded successfully");
                  if (audioRef.current) {
                    setDuration(audioRef.current.duration);
                  }
                }}
                onTimeUpdate={() => {
                  if (audioRef.current) {
                    setCurrentTime(audioRef.current.currentTime);
                  }
                }}
                onPlay={() => {
                  console.log("Simple audio player started playing");
                  setActuallyPlaying(true);
                  if (!isPlaying) {
                    onPlayPause(true);
                  }
                }}
                onPause={() => {
                  console.log("Simple audio player paused");
                  setActuallyPlaying(false);
                  if (isPlaying) {
                    onPlayPause(false);
                  }
                }}
                onEnded={() => {
                  console.log("Simple audio player ended");
                  setActuallyPlaying(false);
                  onPlayPause(false);
                }}
                onError={(e) => {
                  console.error("Simple audio player error:", e);
                  setError("Failed to load audio recording");
                }}
              />
              <div className="text-xs text-muted-foreground text-center mt-2">
                Using simple audio player (WaveSurfer failed to load)
              </div>
            </>
          ) : (
            <div className="h-[60px] w-full flex flex-col justify-center items-center space-y-2">
              <div className="text-sm text-muted-foreground">
                Loading authenticated audio...
              </div>
              <Skeleton className="h-[30px] w-full rounded-md" />
            </div>
          )}
        </div>
      ) : (
        // Fixed: Always render waveform container and overlay loading states
        <div className="relative h-[60px] w-full">
          <div
            id={`waveform-${callId}`}
            ref={waveformRef}
            className="w-full h-full"
          />

          {loading && (
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm flex flex-col justify-center items-center space-y-1 rounded-md">
              <Skeleton className="h-[30px] w-full rounded-md mb-2" />
              <div className="w-full flex space-x-1">
                {Array(16)
                  .fill(0)
                  .map((_, i) => (
                    <Skeleton
                      key={i}
                      className="h-[20px] flex-1 rounded-md"
                      style={{
                        height: `${Math.max(5, Math.random() * 20)}px`,
                        opacity: 0.7 + Math.random() * 0.3,
                      }}
                    />
                  ))}
              </div>
              <div className="text-xs text-muted-foreground">
                Loading audio waveform...
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AudioPlayer;

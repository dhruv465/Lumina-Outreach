import React, { useState } from 'react';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
import { 
  Mic, 
  MicOff, 
  Phone, 
  PhoneOff, 
  Volume2, 
  VolumeX,
  Settings
} from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui/tooltip';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from './ui/popover';

interface WebCallControlsProps {
  isCallActive: boolean;
  isMuted: boolean;
  onStartCall: () => void;
  onEndCall: () => void;
  onToggleMute: () => void;
  onVolumeChange?: (volume: number) => void;
  disableStartButton?: boolean;
  className?: string;
}

/**
 * WebCallControls Component
 * 
 * Provides controls for managing web call testing sessions including
 * mute/unmute, end call, and volume controls
 */
const WebCallControls: React.FC<WebCallControlsProps> = ({
  isCallActive,
  isMuted,
  onStartCall,
  onEndCall,
  onToggleMute,
  onVolumeChange,
  disableStartButton = false,
  className = ''
}) => {
  const [volume, setVolume] = useState(1);
  const [showVolumeControls, setShowVolumeControls] = useState(false);
  
  // Handle volume change
  const handleVolumeChange = (value: number[]) => {
    const newVolume = value[0];
    setVolume(newVolume);
    
    if (onVolumeChange) {
      onVolumeChange(newVolume);
    }
  };
  
  // Toggle volume mute
  const toggleVolumeMute = () => {
    if (volume === 0) {
      // Unmute to previous level or default to 0.5
      const newVolume = volume === 0 ? 0.5 : volume;
      setVolume(newVolume);
      if (onVolumeChange) {
        onVolumeChange(newVolume);
      }
    } else {
      // Mute
      setVolume(0);
      if (onVolumeChange) {
        onVolumeChange(0);
      }
    }
  };
  
  return (
    <div className={`web-call-controls flex items-center justify-center gap-3 ${className}`}>
      {/* Call start/end button */}
      {!isCallActive ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              onClick={onStartCall} 
              disabled={disableStartButton}
              className="bg-green-600 hover:bg-green-700"
            >
              <Phone className="mr-2 h-4 w-4" />
              Start Call
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Start a test call with the selected campaign</p>
          </TooltipContent>
        </Tooltip>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button 
                onClick={onEndCall}
                variant="destructive"
              >
                <PhoneOff className="mr-2 h-4 w-4" />
                End Call
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>End the current test call</p>
            </TooltipContent>
          </Tooltip>
        )}
        
        {/* Mute/unmute button */}
        {isCallActive && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onClick={onToggleMute}
                variant={isMuted ? 'default' : 'outline'}
              >
                {isMuted ? (
                  <>
                    <MicOff className="mr-2 h-4 w-4" />
                    Unmute
                  </>
                ) : (
                  <>
                    <Mic className="mr-2 h-4 w-4" />
                    Mute
                  </>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>{isMuted ? 'Unmute your microphone' : 'Mute your microphone'}</p>
            </TooltipContent>
          </Tooltip>
        )}
        
        {/* Volume controls */}
        <Popover open={showVolumeControls} onOpenChange={setShowVolumeControls}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon">
                  {volume === 0 ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>
              <p>Adjust volume</p>
            </TooltipContent>
          </Tooltip>
          
          <PopoverContent className="w-80">
            <div className="space-y-4">
              <h4 className="font-medium">Volume Controls</h4>
              <div className="flex items-center gap-2">
                <Button 
                  variant="ghost" 
                  size="icon" 
                  onClick={toggleVolumeMute}
                >
                  {volume === 0 ? (
                    <VolumeX className="h-4 w-4" />
                  ) : (
                    <Volume2 className="h-4 w-4" />
                  )}
                </Button>
                <Slider
                  value={[volume * 100]}
                  min={0}
                  max={100}
                  step={1}
                  onValueChange={(value) => handleVolumeChange([value[0] / 100])}
                  className="flex-1"
                />
                <span className="w-8 text-right text-sm">{Math.round(volume * 100)}%</span>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        
        {/* Additional settings button */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="outline" size="icon">
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Call settings</p>
          </TooltipContent>
        </Tooltip>
    </div>
  );
};

export default WebCallControls;

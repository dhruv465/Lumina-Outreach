import React from 'react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, AlertCircle, Play, Pause } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface CallMetricsCardProps {
  title: string;
  value: string | number;
  change?: string | number;
  trend?: 'up' | 'down' | 'neutral';
  tooltipText?: string;
  icon?: React.ReactNode;
  className?: string;
  isLoading?: boolean;
}

export function CallMetricsCard({
  title,
  value,
  change,
  trend = 'neutral',
  tooltipText,
  icon,
  className,
  isLoading = false
}: CallMetricsCardProps) {
  return (
    <Card className={cn("overflow-hidden bg-card/80 backdrop-blur-sm", className)}>
      <CardHeader className="flex flex-row items-center justify-between p-4 pb-2 space-y-0">
        <div className="flex items-center gap-1.5">
          <h3 className="text-sm font-medium">{title}</h3>
          {tooltipText && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="text-xs max-w-xs">{tooltipText}</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
        {icon && <div className="text-muted-foreground">{icon}</div>}
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {isLoading ? (
          <div className="h-8 w-20 bg-muted/60 animate-pulse rounded" />
        ) : (
          <div className="flex items-end gap-2">
            <div className="text-2xl font-semibold leading-none tracking-tight">
              {value}
            </div>
            {change && (
              <Badge variant={trend === 'up' ? 'default' : trend === 'down' ? 'destructive' : 'outline'} className="mb-1 h-5 text-xs">
                {change}
              </Badge>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface CallControlsProps {
  isPlaying: boolean;
  onPlayPause: () => void;
  onRestart?: () => void;
  duration: string;
  currentTime: string;
  className?: string;
  isDisabled?: boolean;
}

export function CallControls({
  isPlaying,
  onPlayPause,
  onRestart,
  duration,
  currentTime,
  className,
  isDisabled = false
}: CallControlsProps) {
  return (
    <div className={cn("flex items-center gap-3 bg-muted/20 p-2.5 rounded-md", className)}>
      <Button 
        variant="outline" 
        size="sm" 
        className="h-8 w-8 p-0 rounded-full"
        onClick={onPlayPause}
        disabled={isDisabled}
      >
        {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
      </Button>
      
      <div className="text-sm space-x-1.5">
        <span className="font-medium">{currentTime}</span>
        <span className="text-muted-foreground">/</span>
        <span className="text-muted-foreground">{duration}</span>
      </div>
      
      {onRestart && (
        <Button 
          variant="ghost" 
          size="sm" 
          className="h-7 w-7 p-0 ml-auto rounded-full"
          onClick={onRestart}
          disabled={isDisabled}
        >
          <AlertCircle className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

export function CallTranscriptPanel({
  messages,
  isLoading,
  className
}: {
  messages: any[];
  isLoading?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("bg-card/60 rounded-md border overflow-hidden", className)}>
      <Tabs defaultValue="transcript">
        <div className="flex items-center justify-between px-4 py-2 border-b">
          <TabsList className="h-8 bg-muted/40">
            <TabsTrigger value="transcript" className="text-xs px-3">Transcript</TabsTrigger>
            <TabsTrigger value="summary" className="text-xs px-3">Summary</TabsTrigger>
          </TabsList>
          
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="h-6 text-xs">AI Analysis</Badge>
          </div>
        </div>
        
        <TabsContent value="transcript" className="p-0 m-0">
          <div className="h-[400px] overflow-y-auto p-4 space-y-4">
            {isLoading ? (
              <div className="space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="flex flex-col gap-1">
                    <div className="w-20 h-4 bg-muted/60 animate-pulse rounded-sm" />
                    <div className="w-full h-8 bg-muted/40 animate-pulse rounded-sm" />
                  </div>
                ))}
              </div>
            ) : (
              messages.length > 0 ? (
                messages.map((message, index) => (
                  <div key={index} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={message.role === 'ai' ? 'default' : 'secondary'} className="h-5 text-xs">
                        {message.role === 'ai' ? 'AI' : 'Customer'}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    </div>
                    <div className={cn(
                      "text-sm p-3 rounded-md",
                      message.role === 'ai' ? 'bg-primary/10' : 'bg-muted/40'
                    )}>
                      {message.content}
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                  <p>No transcript available</p>
                </div>
              )
            )}
          </div>
        </TabsContent>
        
        <TabsContent value="summary" className="p-4 m-0">
          <div className="space-y-4">
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Key Points</h4>
              <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                <li>Customer was interested in pricing options</li>
                <li>Discussed implementation timeline (2-3 weeks)</li>
                <li>Concerned about integration with existing systems</li>
              </ul>
            </div>
            
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Action Items</h4>
              <ul className="list-disc list-inside text-sm space-y-1 text-muted-foreground">
                <li>Send detailed pricing proposal</li>
                <li>Schedule follow-up call next week</li>
                <li>Connect with technical team for integration questions</li>
              </ul>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

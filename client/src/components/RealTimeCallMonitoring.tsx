import React from 'react';
import { Card } from './ui/card';
import { Progress } from './ui/progress';
import { Separator } from './ui/separator';

interface MetricsProps {
  metrics: {
    responseTime?: number;
    sttLatency?: number;
    llmLatency?: number;
    ttsLatency?: number;
    detailed?: {
      latency?: {
        speechToText?: { avg: number; min: number; max: number };
        llmProcessing?: { avg: number; min: number; max: number };
        textToSpeech?: { avg: number; min: number; max: number };
        totalResponse?: { avg: number; min: number; max: number };
      };
      timing?: {
        userSpeakingTime?: number;
        agentSpeakingTime?: number;
        silenceDuration?: { avg: number; total: number };
        turnTakingDelay?: { avg: number; min: number; max: number };
      };
      interruptions?: {
        count?: number;
        userInterruptingAgent?: number;
        agentInterruptingUser?: number;
      };
      turnCount?: number;
    };
  };
  className?: string;
}

/**
 * RealTimeCallMonitoring Component
 * 
 * Displays real-time metrics for web call testing
 */
const RealTimeCallMonitoring: React.FC<MetricsProps> = ({ metrics, className = '' }) => {
  // Format milliseconds to seconds with 2 decimal places
  const formatMs = (ms?: number): string => {
    if (ms === undefined) return 'N/A';
    return `${(ms / 1000).toFixed(2)}s`;
  };

  // Format milliseconds to seconds for display in progress bar
  const getProgressValue = (value?: number, max = 5000): number => {
    if (value === undefined) return 0;
    return Math.min((value / max) * 100, 100);
  };

  // Get color based on latency value
  const getLatencyColor = (value?: number): string => {
    if (value === undefined) return 'bg-gray-300';
    if (value < 500) return 'bg-green-500';
    if (value < 1000) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  // Calculate total call duration
  const totalCallDuration = 
    (metrics.detailed?.timing?.userSpeakingTime || 0) + 
    (metrics.detailed?.timing?.agentSpeakingTime || 0) +
    (metrics.detailed?.timing?.silenceDuration?.total || 0);

  // Calculate speaking percentages
  const userSpeakingPercentage = totalCallDuration > 0 
    ? ((metrics.detailed?.timing?.userSpeakingTime || 0) / totalCallDuration) * 100 
    : 0;
  
  const agentSpeakingPercentage = totalCallDuration > 0 
    ? ((metrics.detailed?.timing?.agentSpeakingTime || 0) / totalCallDuration) * 100 
    : 0;
  
  const silencePercentage = totalCallDuration > 0 
    ? ((metrics.detailed?.timing?.silenceDuration?.total || 0) / totalCallDuration) * 100 
    : 0;

  return (
    <div className={`real-time-metrics ${className}`}>
      <Card className="p-4">
        <h3 className="text-lg font-medium mb-4">Real-Time Metrics</h3>
        
        {/* Latency Metrics */}
        <div className="mb-6">
          <h4 className="text-sm font-medium mb-2">Latency Metrics</h4>
          
          <div className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Speech-to-Text:</span>
                <span>{formatMs(metrics.sttLatency)}</span>
              </div>
              <Progress 
                value={getProgressValue(metrics.sttLatency, 2000)} 
                className={getLatencyColor(metrics.sttLatency)}
              />
            </div>
            
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>LLM Processing:</span>
                <span>{formatMs(metrics.llmLatency)}</span>
              </div>
              <Progress 
                value={getProgressValue(metrics.llmLatency, 5000)} 
                className={getLatencyColor(metrics.llmLatency)}
              />
            </div>
            
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Text-to-Speech:</span>
                <span>{formatMs(metrics.ttsLatency)}</span>
              </div>
              <Progress 
                value={getProgressValue(metrics.ttsLatency, 3000)} 
                className={getLatencyColor(metrics.ttsLatency)}
              />
            </div>
            
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span>Total Response Time:</span>
                <span>{formatMs(metrics.responseTime)}</span>
              </div>
              <Progress 
                value={getProgressValue(metrics.responseTime, 10000)} 
                className={getLatencyColor(metrics.responseTime)}
              />
            </div>
          </div>
          
          {metrics.detailed?.latency?.totalResponse && (
            <div className="mt-2 text-xs text-gray-500">
              <div className="flex justify-between">
                <span>Min: {formatMs(metrics.detailed.latency.totalResponse.min)}</span>
                <span>Avg: {formatMs(metrics.detailed.latency.totalResponse.avg)}</span>
                <span>Max: {formatMs(metrics.detailed.latency.totalResponse.max)}</span>
              </div>
            </div>
          )}
        </div>
        
        <Separator className="my-4" />
        
        {/* Speaking Time */}
        <div className="mb-6">
          <h4 className="text-sm font-medium mb-2">Speaking Time</h4>
          
          <div className="h-6 w-full bg-gray-200 rounded-full overflow-hidden">
            <div className="flex h-full">
              <div 
                className="bg-blue-500" 
                style={{ width: `${userSpeakingPercentage}%` }}
                title={`User: ${formatMs(metrics.detailed?.timing?.userSpeakingTime)}`}
              ></div>
              <div 
                className="bg-green-500" 
                style={{ width: `${agentSpeakingPercentage}%` }}
                title={`Agent: ${formatMs(metrics.detailed?.timing?.agentSpeakingTime)}`}
              ></div>
              <div 
                className="bg-gray-300" 
                style={{ width: `${silencePercentage}%` }}
                title={`Silence: ${formatMs(metrics.detailed?.timing?.silenceDuration?.total)}`}
              ></div>
            </div>
          </div>
          
          <div className="flex justify-between mt-2 text-xs">
            <div className="flex items-center">
              <div className="w-3 h-3 bg-blue-500 rounded-full mr-1"></div>
              <span>User: {formatMs(metrics.detailed?.timing?.userSpeakingTime)}</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-green-500 rounded-full mr-1"></div>
              <span>Agent: {formatMs(metrics.detailed?.timing?.agentSpeakingTime)}</span>
            </div>
            <div className="flex items-center">
              <div className="w-3 h-3 bg-gray-300 rounded-full mr-1"></div>
              <span>Silence: {formatMs(metrics.detailed?.timing?.silenceDuration?.total)}</span>
            </div>
          </div>
        </div>
        
        <Separator className="my-4" />
        
        {/* Additional Metrics */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <h4 className="text-sm font-medium mb-2">Turn Taking</h4>
            <div className="text-sm">
              <div className="flex justify-between mb-1">
                <span>Total Turns:</span>
                <span>{metrics.detailed?.turnCount || 0}</span>
              </div>
              <div className="flex justify-between mb-1">
                <span>Avg Delay:</span>
                <span>{formatMs(metrics.detailed?.timing?.turnTakingDelay?.avg)}</span>
              </div>
            </div>
          </div>
          
          <div>
            <h4 className="text-sm font-medium mb-2">Interruptions</h4>
            <div className="text-sm">
              <div className="flex justify-between mb-1">
                <span>Total:</span>
                <span>{metrics.detailed?.interruptions?.count || 0}</span>
              </div>
              <div className="flex justify-between mb-1">
                <span>By User:</span>
                <span>{metrics.detailed?.interruptions?.userInterruptingAgent || 0}</span>
              </div>
              <div className="flex justify-between mb-1">
                <span>By Agent:</span>
                <span>{metrics.detailed?.interruptions?.agentInterruptingUser || 0}</span>
              </div>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
};

export default RealTimeCallMonitoring;
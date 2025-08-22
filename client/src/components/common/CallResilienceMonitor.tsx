/**
 * Enhanced Call Monitoring Component
 * 
 * Displays real-time call health, connection status, and resilience metrics
 * for active voice calls with live updates and alerts.
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { Progress } from '../ui/progress';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import {
  Activity,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Clock,
  Mic,
  Volume2,
  Brain,
  Shield,
  TrendingUp
} from 'lucide-react';

interface CallHealth {
  callId: string;
  overall: 'healthy' | 'warning' | 'critical' | 'failed';
  components: {
    connection: 'healthy' | 'degraded' | 'failed';
    audio: 'healthy' | 'degraded' | 'failed';
    tts: 'healthy' | 'degraded' | 'failed';
    stt: 'healthy' | 'degraded' | 'failed';
    llm: 'healthy' | 'degraded' | 'failed';
  };
  metrics: {
    duration: number;
    messagesExchanged: number;
    audioLatency: number;
    responseTime: number;
    errorRate: number;
    fallbacksUsed: number;
    connectionStability: number;
    audioQuality: number;
    interruptionCount: number;
    silenceDetected: number;
  };
  issues: Array<{
    id: string;
    type: 'error' | 'warning' | 'info';
    category: string;
    message: string;
    timestamp: Date;
    resolved: boolean;
    impact: 'low' | 'medium' | 'high' | 'critical';
    suggestion?: string;
  }>;
  lastUpdated: Date;
}

interface CallResilienceProps {
  callId: string;
  onEndCall?: () => void;
  onReconnect?: () => void;
}

export const CallResilienceMonitor: React.FC<CallResilienceProps> = ({
  callId,
  onEndCall,
  onReconnect
}) => {
  const [health, setHealth] = useState<CallHealth | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  // Fetch call health data
  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const response = await fetch(`/api/calls/${callId}/health`);
        if (response.ok) {
          const healthData = await response.json();
          setHealth(healthData);
          setLastUpdate(new Date());
        }
      } catch (error) {
        console.error('Error fetching call health:', error);
      } finally {
        setIsLoading(false);
      }
    };

    // Initial fetch
    fetchHealth();

    // Set up polling for real-time updates
    const interval = setInterval(fetchHealth, 2000); // Update every 2 seconds

    return () => clearInterval(interval);
  }, [callId]);

  if (isLoading) {
    return (
      <Card className="w-full">
        <CardContent className="p-6">
          <div className="flex items-center justify-center">
            <Activity className="h-6 w-6 animate-spin mr-2" />
            <span>Loading call health data...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!health) {
    return (
      <Card className="w-full">
        <CardContent className="p-6">
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              Unable to load call health data for call {callId}
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'healthy': return 'bg-green-500';
      case 'warning': return 'bg-yellow-500';
      case 'degraded': return 'bg-orange-500';
      case 'critical': return 'bg-red-500';
      case 'failed': return 'bg-red-700';
      default: return 'bg-gray-500';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'warning': return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case 'degraded': return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case 'critical': return <XCircle className="h-4 w-4 text-red-500" />;
      case 'failed': return <XCircle className="h-4 w-4 text-red-700" />;
      default: return <Activity className="h-4 w-4 text-gray-500" />;
    }
  };

  const formatDuration = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      return `${hours}:${(minutes % 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
    }
    return `${minutes}:${(seconds % 60).toString().padStart(2, '0')}`;
  };

  const unresolved Issues = health.issues.filter(issue => !issue.resolved);
  const criticalIssues = unresolvedIssues.filter(issue => issue.impact === 'critical');

  return (
    <div className="w-full space-y-4">
      {/* Header with overall status */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Shield className="h-5 w-5" />
              <span>Call Health Monitor</span>
              <Badge variant={health.overall === 'healthy' ? 'default' : 'destructive'}>
                {health.overall}
              </Badge>
            </div>
            <div className="flex items-center space-x-2 text-sm text-gray-500">
              <Clock className="h-4 w-4" />
              <span>{formatDuration(health.metrics.duration)}</span>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Component Health Status */}
          <div className="grid grid-cols-5 gap-4 mb-4">
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                <Wifi className="h-6 w-6" />
              </div>
              <div className="flex items-center justify-center mb-1">
                {getStatusIcon(health.components.connection)}
              </div>
              <span className="text-xs">Connection</span>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                <Volume2 className="h-6 w-6" />
              </div>
              <div className="flex items-center justify-center mb-1">
                {getStatusIcon(health.components.audio)}
              </div>
              <span className="text-xs">Audio</span>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                <Mic className="h-6 w-6" />
              </div>
              <div className="flex items-center justify-center mb-1">
                {getStatusIcon(health.components.tts)}
              </div>
              <span className="text-xs">TTS</span>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                <Activity className="h-6 w-6" />
              </div>
              <div className="flex items-center justify-center mb-1">
                {getStatusIcon(health.components.stt)}
              </div>
              <span className="text-xs">STT</span>
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center mb-2">
                <Brain className="h-6 w-6" />
              </div>
              <div className="flex items-center justify-center mb-1">
                {getStatusIcon(health.components.llm)}
              </div>
              <span className="text-xs">AI</span>
            </div>
          </div>

          {/* Critical Issues Alert */}
          {criticalIssues.length > 0 && (
            <Alert className="mb-4 border-red-500 bg-red-50">
              <XCircle className="h-4 w-4 text-red-500" />
              <AlertDescription>
                <strong>Critical Issues Detected:</strong>
                <ul className="mt-2 space-y-1">
                  {criticalIssues.map(issue => (
                    <li key={issue.id} className="text-sm">
                      • {issue.message}
                      {issue.suggestion && (
                        <span className="text-gray-600"> - {issue.suggestion}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          {/* Action Buttons */}
          <div className="flex space-x-2">
            {health.overall === 'failed' || criticalIssues.length > 0 ? (
              <Button onClick={onReconnect} variant="outline" size="sm">
                <WifiOff className="h-4 w-4 mr-2" />
                Reconnect
              </Button>
            ) : null}
            <Button onClick={onEndCall} variant="destructive" size="sm">
              End Call
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Detailed Metrics */}
      <Tabs defaultValue="metrics" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="metrics">Metrics</TabsTrigger>
          <TabsTrigger value="issues">Issues ({unresolvedIssues.length})</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="metrics" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Call Metrics</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium">Connection Stability</label>
                  <Progress value={health.metrics.connectionStability * 100} className="mt-1" />
                  <span className="text-xs text-gray-500">
                    {(health.metrics.connectionStability * 100).toFixed(1)}%
                  </span>
                </div>
                <div>
                  <label className="text-sm font-medium">Audio Quality</label>
                  <Progress value={health.metrics.audioQuality * 100} className="mt-1" />
                  <span className="text-xs text-gray-500">
                    {(health.metrics.audioQuality * 100).toFixed(1)}%
                  </span>
                </div>
                <div>
                  <label className="text-sm font-medium">Audio Latency</label>
                  <div className="mt-1">
                    <span className="text-lg font-bold">
                      {health.metrics.audioLatency}ms
                    </span>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Response Time</label>
                  <div className="mt-1">
                    <span className="text-lg font-bold">
                      {health.metrics.responseTime}ms
                    </span>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Messages Exchanged</label>
                  <div className="mt-1">
                    <span className="text-lg font-bold">
                      {health.metrics.messagesExchanged}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium">Fallbacks Used</label>
                  <div className="mt-1">
                    <span className="text-lg font-bold">
                      {health.metrics.fallbacksUsed}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="issues" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Active Issues</CardTitle>
            </CardHeader>
            <CardContent>
              {unresolvedIssues.length === 0 ? (
                <div className="text-center py-4 text-gray-500">
                  <CheckCircle className="h-8 w-8 mx-auto mb-2 text-green-500" />
                  No active issues detected
                </div>
              ) : (
                <div className="space-y-3">
                  {unresolvedIssues.map(issue => (
                    <div key={issue.id} className="border rounded-lg p-3">
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <div className="flex items-center space-x-2 mb-1">
                            {getStatusIcon(issue.impact)}
                            <Badge variant={issue.type === 'error' ? 'destructive' : 'secondary'}>
                              {issue.category}
                            </Badge>
                            <span className="text-xs text-gray-500">
                              {new Date(issue.timestamp).toLocaleTimeString()}
                            </span>
                          </div>
                          <p className="text-sm font-medium">{issue.message}</p>
                          {issue.suggestion && (
                            <p className="text-xs text-gray-600 mt-1">
                              💡 {issue.suggestion}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="performance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <TrendingUp className="h-5 w-5 mr-2" />
                Performance Indicators
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <div className="text-2xl font-bold text-blue-600">
                    {(health.metrics.errorRate * 100).toFixed(1)}%
                  </div>
                  <div className="text-sm text-gray-600">Error Rate</div>
                </div>
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <div className="text-2xl font-bold text-green-600">
                    {health.metrics.interruptionCount}
                  </div>
                  <div className="text-sm text-gray-600">Interruptions</div>
                </div>
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <div className="text-2xl font-bold text-purple-600">
                    {health.metrics.silenceDetected}
                  </div>
                  <div className="text-sm text-gray-600">Silence Events</div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Status Footer */}
      <div className="text-xs text-gray-500 text-center">
        Last updated: {lastUpdate.toLocaleTimeString()}
      </div>
    </div>
  );
};

export default CallResilienceMonitor;
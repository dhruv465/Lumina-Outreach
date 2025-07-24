import React, { useState, useEffect } from 'react';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion';
import { Separator } from './ui/separator';

interface DebugPanelProps {
  socket: any;
  isConnected: boolean;
  className?: string;
}

interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  component: string;
  message: string;
  details?: any;
}

interface ErrorReport {
  timestamp: string;
  component: string;
  message: string;
  stack?: string;
  recoverable: boolean;
}

interface DiagnosticInfo {
  sessionId: string;
  totalLogs: number;
  logCounts: {
    info: number;
    warn: number;
    error: number;
    debug: number;
  };
  componentCounts: Record<string, number>;
  totalErrors: number;
  recoverableErrors: number;
  criticalErrors: number;
  recentLogs: LogEntry[];
  recentErrors: ErrorReport[];
  timestamp: string;
}

/**
 * WebCallDebugPanel Component
 * 
 * Displays debugging information for web call testing
 */
const WebCallDebugPanel: React.FC<DebugPanelProps> = ({ socket, isConnected, className = '' }) => {
  const [debugInfo, setDebugInfo] = useState<DiagnosticInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Request debug information
  const requestDebugInfo = () => {
    if (!socket || !isConnected) {
      setError('Socket not connected');
      return;
    }

    setIsLoading(true);
    setError(null);
    socket.emit('webcall:debug');
  };

  // Listen for debug info response
  useEffect(() => {
    if (!socket) return;

    const handleDebugInfo = (data: DiagnosticInfo) => {
      setDebugInfo(data);
      setIsLoading(false);
    };

    socket.on('webcall:debugInfo', handleDebugInfo);

    return () => {
      socket.off('webcall:debugInfo', handleDebugInfo);
    };
  }, [socket]);

  // Get badge color for log level
  const getLevelBadge = (level: string) => {
    switch (level) {
      case 'info':
        return <Badge variant="outline" className="bg-blue-100">info</Badge>;
      case 'warn':
        return <Badge variant="outline" className="bg-yellow-100">warn</Badge>;
      case 'error':
        return <Badge variant="outline" className="bg-red-100">error</Badge>;
      case 'debug':
        return <Badge variant="outline" className="bg-gray-100">debug</Badge>;
      default:
        return <Badge variant="outline">{level}</Badge>;
    }
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString();
  };

  return (
    <div className={`web-call-debug ${className}`}>
      <Card className="p-4">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium">Debug Information</h3>
          <Button 
            size="sm" 
            onClick={requestDebugInfo} 
            disabled={!isConnected || isLoading}
          >
            {isLoading ? 'Loading...' : 'Refresh'}
          </Button>
        </div>

        {error && (
          <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
            {error}
          </div>
        )}

        {!debugInfo && !isLoading && !error && (
          <div className="text-center py-8 text-gray-500">
            Click 'Refresh' to load debug information
          </div>
        )}

        {isLoading && (
          <div className="text-center py-8 text-gray-500">
            Loading debug information...
          </div>
        )}

        {debugInfo && (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="font-medium">Session ID:</span>
                <div className="truncate text-xs">{debugInfo.sessionId}</div>
              </div>
              <div>
                <span className="font-medium">Last Updated:</span>
                <div>{formatTimestamp(debugInfo.timestamp)}</div>
              </div>
            </div>

            <Separator />

            {/* Log Counts */}
            <div>
              <h4 className="text-sm font-medium mb-2">Log Summary</h4>
              <div className="grid grid-cols-4 gap-2 text-center">
                <div className="bg-blue-50 p-2 rounded">
                  <div className="text-xs text-blue-600">Info</div>
                  <div className="font-bold">{debugInfo.logCounts.info}</div>
                </div>
                <div className="bg-yellow-50 p-2 rounded">
                  <div className="text-xs text-yellow-600">Warn</div>
                  <div className="font-bold">{debugInfo.logCounts.warn}</div>
                </div>
                <div className="bg-red-50 p-2 rounded">
                  <div className="text-xs text-red-600">Error</div>
                  <div className="font-bold">{debugInfo.logCounts.error}</div>
                </div>
                <div className="bg-gray-50 p-2 rounded">
                  <div className="text-xs text-gray-600">Debug</div>
                  <div className="font-bold">{debugInfo.logCounts.debug}</div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Error Summary */}
            <div>
              <h4 className="text-sm font-medium mb-2">Error Summary</h4>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="bg-gray-50 p-2 rounded">
                  <div className="text-xs text-gray-600">Total</div>
                  <div className="font-bold">{debugInfo.totalErrors}</div>
                </div>
                <div className="bg-yellow-50 p-2 rounded">
                  <div className="text-xs text-yellow-600">Recoverable</div>
                  <div className="font-bold">{debugInfo.recoverableErrors}</div>
                </div>
                <div className="bg-red-50 p-2 rounded">
                  <div className="text-xs text-red-600">Critical</div>
                  <div className="font-bold">{debugInfo.criticalErrors}</div>
                </div>
              </div>
            </div>

            <Separator />

            {/* Recent Logs */}
            <Accordion type="single" collapsible defaultValue="logs">
              <AccordionItem value="logs">
                <AccordionTrigger>
                  <span className="text-sm font-medium">Recent Logs</span>
                </AccordionTrigger>
                <AccordionContent>
                  <ScrollArea className="h-40">
                    {debugInfo.recentLogs.length > 0 ? (
                      <div className="space-y-2">
                        {debugInfo.recentLogs.map((log, index) => (
                          <div key={index} className="text-xs border-l-2 pl-2" style={{ borderColor: log.level === 'error' ? 'red' : log.level === 'warn' ? 'orange' : 'gray' }}>
                            <div className="flex items-center gap-1">
                              <span className="text-gray-500">{formatTimestamp(log.timestamp)}</span>
                              {getLevelBadge(log.level)}
                              <span className="font-medium">{log.component}</span>
                            </div>
                            <div className="mt-1">{log.message}</div>
                            {log.details && (
                              <div className="mt-1 text-gray-500 overflow-hidden text-ellipsis">
                                {typeof log.details === 'object' 
                                  ? JSON.stringify(log.details).substring(0, 100) + (JSON.stringify(log.details).length > 100 ? '...' : '')
                                  : String(log.details).substring(0, 100) + (String(log.details).length > 100 ? '...' : '')
                                }
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-4 text-gray-500">No logs available</div>
                    )}
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            </Accordion>

            {/* Recent Errors */}
            {debugInfo.recentErrors.length > 0 && (
              <Accordion type="single" collapsible defaultValue="errors">
                <AccordionItem value="errors">
                  <AccordionTrigger>
                    <span className="text-sm font-medium">Recent Errors</span>
                  </AccordionTrigger>
                  <AccordionContent>
                    <ScrollArea className="h-40">
                      <div className="space-y-2">
                        {debugInfo.recentErrors.map((error, index) => (
                          <div key={index} className="text-xs border-l-2 border-red-500 pl-2 bg-red-50 p-2 rounded">
                            <div className="flex items-center gap-1">
                              <span className="text-gray-500">{formatTimestamp(error.timestamp)}</span>
                              <Badge variant={error.recoverable ? "outline" : "destructive"} className="text-xs">
                                {error.recoverable ? 'Recoverable' : 'Critical'}
                              </Badge>
                              <span className="font-medium">{error.component}</span>
                            </div>
                            <div className="mt-1 font-medium text-red-700">{error.message}</div>
                            {error.stack && (
                              <div className="mt-1 text-gray-700 overflow-hidden text-ellipsis">
                                {error.stack.split('\n')[0]}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            )}

            {/* Component Counts */}
            <Accordion type="single" collapsible>
              <AccordionItem value="components">
                <AccordionTrigger>
                  <span className="text-sm font-medium">Component Activity</span>
                </AccordionTrigger>
                <AccordionContent>
                  <ScrollArea className="h-40">
                    <div className="space-y-2">
                      {Object.entries(debugInfo.componentCounts).map(([component, count]) => (
                        <div key={component} className="flex justify-between items-center text-xs">
                          <span>{component}</span>
                          <Badge variant="outline">{count}</Badge>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        )}
      </Card>
    </div>
  );
};

export default WebCallDebugPanel;
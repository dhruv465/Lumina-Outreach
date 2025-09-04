import { useState } from 'react';
import { Wifi, WifiOff, RefreshCw, CheckCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { useSocketIO } from '@/hooks/useSocketIO';

export const ConnectionStatus = () => {
  const { isConnected, connectionError, reconnect } = useSocketIO();
  const [isReconnecting, setIsReconnecting] = useState(false);

  const handleReconnect = async () => {
    setIsReconnecting(true);
    try {
      reconnect();
      // Give it a moment to attempt reconnection
      setTimeout(() => {
        setIsReconnecting(false);
      }, 3000);
    } catch (error) {
      console.error('Manual reconnect failed:', error);
      setIsReconnecting(false);
    }
  };

  // Don't show anything if connected and no error
  if (isConnected && !connectionError) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      <Card className={`p-3 border-l-4 ${isConnected ? 'border-l-green-500 bg-green-50 dark:bg-green-900/20' : 'border-l-red-500 bg-red-50 dark:bg-red-900/20'}`}>
        <div className="flex items-center space-x-2">
          {isConnected ? (
            <CheckCircle className="h-4 w-4 text-green-500" />
          ) : (
            <WifiOff className="h-4 w-4 text-red-500" />
          )}
          <div className="flex-1">
            <p className="text-sm">
              {isConnected ? (
                <span className="text-green-700 dark:text-green-300">Connected</span>
              ) : connectionError ? (
                <span className="text-red-700 dark:text-red-300">{connectionError}</span>
              ) : (
                <span className="text-red-700 dark:text-red-300">Connection lost</span>
              )}
            </p>
          </div>
          {!isConnected && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReconnect}
              disabled={isReconnecting}
              className="ml-2"
            >
              {isReconnecting ? (
                <RefreshCw className="h-3 w-3 animate-spin" />
              ) : (
                <Wifi className="h-3 w-3" />
              )}
              <span className="sr-only">Reconnect</span>
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
};

export default ConnectionStatus;

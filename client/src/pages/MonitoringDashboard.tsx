import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, Download, Settings } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ModelMetricsMonitoring from '../components/monitoring/ModelMetricsMonitoring';
import WebCallMonitoring from '../components/monitoring/WebCallMonitoring';

const MonitoringDashboard = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState('models');

  const handleRefresh = () => {
    setIsRefreshing(true);
    // Simulate refresh
    setTimeout(() => setIsRefreshing(false), 1000);
  };

  const handleExport = () => {
    // TODO: Implement export functionality
    console.log('Export metrics data');
  };

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="flex flex-col space-y-4 sm:flex-row sm:justify-between sm:items-center sm:space-y-0">
        <div className="min-w-0 flex-shrink-0">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight truncate">
            System Monitoring
          </h1>
          <p className="text-muted-foreground text-sm sm:text-base">
            Monitor model performance, metrics, and system health in real-time
          </p>
        </div>
        <div className="flex flex-row gap-2 flex-wrap">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleExport}
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button 
            variant="outline" 
            size="sm"
          >
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </Button>
        </div>
      </div>

      {/* Monitoring Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="models">Model Metrics</TabsTrigger>
          <TabsTrigger value="webcalls">Web Call Testing</TabsTrigger>
        </TabsList>
        
        <TabsContent value="models">
          <ModelMetricsMonitoring />
        </TabsContent>
        
        <TabsContent value="webcalls">
          <WebCallMonitoring />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default MonitoringDashboard;

import { useState, useEffect } from 'react';
import { 
  ResponsiveContainer, 
  Tooltip, Legend, CartesianGrid, 
  BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Button } from '../ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Badge } from '../ui/badge';
import { RefreshCcw, AlertTriangle, CheckCircle } from 'lucide-react';
import axios from 'axios';

// Define types for our metrics data
interface ModelUsageMetrics {
  model: string;
  tier: string;
  usageCount: number;
  successCount: number;
  failureCount: number;
  fallbackCount: number;
  averageResponseTime: number;
}

interface ModelValidationMetrics {
  model: string;
  validationAttempts: number;
  validationSuccesses: number;
  validationFailures: number;
  successRate: number;
}

interface FallbackMetrics {
  originalModel: string;
  fallbackModel: string;
  fallbackCount: number;
  successAfterFallback: number;
  failureAfterFallback: number;
}

interface AlertItem {
  id: string;
  level: string;
  type: string;
  message: string;
  timestamp: string;
  acknowledged?: boolean;
}

const ModelMetricsMonitoring = () => {
  const [activeTab, setActiveTab] = useState('usage');
  const [timeRange, setTimeRange] = useState('24h');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [modelUsage, setModelUsage] = useState<ModelUsageMetrics[]>([]);
  const [modelValidation, setModelValidation] = useState<ModelValidationMetrics[]>([]);
  const [fallbacks, setFallbacks] = useState<FallbackMetrics[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  
  const fetchMetricsData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch Deepgram model metrics
      const response = await axios.get('/api/metrics/deepgram');
      const data = response.data.data;
      
      setModelUsage(data.modelUsage || []);
      setModelValidation(data.modelValidation || []);
      setFallbacks(data.fallbacks || []);
      
      // Fetch alerts
      const alertsResponse = await axios.get('/api/metrics/alerts');
      setAlerts(alertsResponse.data.data || []);
      
    } catch (err) {
      console.error('Error fetching metrics data:', err);
      setError('Failed to load metrics data. Please try again later.');
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchMetricsData();
    
    // Set up polling interval (refresh every 5 minutes)
    const intervalId = setInterval(fetchMetricsData, 5 * 60 * 1000);
    
    return () => clearInterval(intervalId);
  }, [timeRange]);
  
  const acknowledgeAlert = async (alertId: string) => {
    try {
      await axios.post('/api/metrics/alerts/acknowledge', {
        alertId,
        userId: 'current-user' // Replace with actual user ID
      });
      
      // Update UI optimistically
      setAlerts(alerts.map(alert => 
        alert.id === alertId ? {...alert, acknowledged: true} : alert
      ));
    } catch (err) {
      console.error('Error acknowledging alert:', err);
      setError('Failed to acknowledge alert. Please try again.');
    }
  };
  
  const getColorBySuccessRate = (rate: number) => {
    if (rate >= 0.95) return '#22c55e';
    if (rate >= 0.85) return '#eab308';
    return '#ef4444';
  };
  
  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Time Range and Refresh Controls */}
      <div className="flex flex-col space-y-3 sm:flex-row sm:justify-between sm:items-center sm:space-y-0">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Live Dashboard
          </Badge>
          <span className="text-sm text-muted-foreground">
            Auto-refresh every 5 minutes
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Select value={timeRange} onValueChange={setTimeRange}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Time Range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="24h">Last 24 hours</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
            </SelectContent>
          </Select>
          
          <Button 
            onClick={fetchMetricsData} 
            variant="outline" 
            size="sm"
            disabled={loading}
          >
            <RefreshCcw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>
      
      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          <TabsTrigger value="usage" className="text-xs sm:text-sm">Model Usage</TabsTrigger>
          <TabsTrigger value="validation" className="text-xs sm:text-sm">Validation</TabsTrigger>
          <TabsTrigger value="fallbacks" className="text-xs sm:text-sm">Fallbacks</TabsTrigger>
          <TabsTrigger value="alerts" className="text-xs sm:text-sm">
            Alerts
            {alerts.filter(a => !a.acknowledged).length > 0 && (
              <Badge variant="destructive" className="ml-1 px-1.5 py-0.5 text-xs">
                {alerts.filter(a => !a.acknowledged).length}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
        
        <TabsContent value="usage" className="space-y-4 sm:space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Model Usage Summary Cards */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Requests</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold">
                  {modelUsage.reduce((sum, item) => sum + item.usageCount, 0).toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Across all models
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Success Rate</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold text-green-600">
                  {(modelUsage.reduce((sum, item) => sum + item.successCount, 0) / 
                    Math.max(1, modelUsage.reduce((sum, item) => sum + item.usageCount, 0)) * 100).toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Overall performance
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Fallback Rate</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold text-amber-600">
                  {(modelUsage.reduce((sum, item) => sum + item.fallbackCount, 0) / 
                    Math.max(1, modelUsage.reduce((sum, item) => sum + item.usageCount, 0)) * 100).toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Backup activations
                </p>
              </CardContent>
            </Card>
          </div>
          
          {/* Model Usage Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Model Usage Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={modelUsage}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis 
                      dataKey="model" 
                      fontSize={12}
                      tick={{ fill: 'currentColor' }}
                    />
                    <YAxis 
                      fontSize={12}
                      tick={{ fill: 'currentColor' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="successCount" name="Successful" stackId="a" fill="#22c55e" />
                    <Bar dataKey="failureCount" name="Failed" stackId="a" fill="#ef4444" />
                    <Bar dataKey="fallbackCount" name="Fallbacks" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          
          {/* Response Time Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Average Response Time by Model</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={modelUsage}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis 
                      dataKey="model" 
                      fontSize={12}
                      tick={{ fill: 'currentColor' }}
                    />
                    <YAxis 
                      label={{ value: 'Time (ms)', angle: -90, position: 'insideLeft' }} 
                      fontSize={12}
                      tick={{ fill: 'currentColor' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="averageResponseTime" name="Avg Response Time (ms)" fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="validation" className="space-y-4 sm:space-y-6">
          {/* Validation Success Rate Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Validations</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold">
                  {modelValidation.reduce((sum, item) => sum + item.validationAttempts, 0).toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  All model checks
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg. Success Rate</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold text-green-600">
                  {(modelValidation.reduce((sum, item) => sum + item.successRate, 0) / 
                    Math.max(1, modelValidation.length) * 100).toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Validation quality
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Failed Validations</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold text-red-600">
                  {modelValidation.reduce((sum, item) => sum + item.validationFailures, 0).toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Need attention
                </p>
              </CardContent>
            </Card>
          </div>
          
          {/* Validation Success Rate Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Model Validation Success Rates</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={modelValidation}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis 
                      dataKey="model" 
                      fontSize={12}
                      tick={{ fill: 'currentColor' }}
                    />
                    <YAxis 
                      label={{ value: 'Success Rate (%)', angle: -90, position: 'insideLeft' }} 
                      fontSize={12}
                      tick={{ fill: 'currentColor' }}
                    />
                    <Tooltip 
                      formatter={(value: number) => [(value * 100).toFixed(1) + '%']}
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="successRate" name="Success Rate">
                      {modelValidation.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={getColorBySuccessRate(entry.successRate)} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          
          {/* Validation Attempts Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Validation Attempts by Model</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={modelValidation}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis 
                      dataKey="model" 
                      fontSize={12}
                      tick={{ fill: 'currentColor' }}
                    />
                    <YAxis 
                      fontSize={12}
                      tick={{ fill: 'currentColor' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="validationSuccesses" name="Successful" stackId="a" fill="#22c55e" />
                    <Bar dataKey="validationFailures" name="Failed" stackId="a" fill="#ef4444" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="fallbacks" className="space-y-4 sm:space-y-6">
          {/* Fallback Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Fallbacks</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold">
                  {fallbacks.reduce((sum, item) => sum + item.fallbackCount, 0).toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Backup activations
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Success After Fallback</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold text-green-600">
                  {(fallbacks.reduce((sum, item) => sum + item.successAfterFallback, 0) / 
                    Math.max(1, fallbacks.reduce((sum, item) => sum + item.fallbackCount, 0)) * 100).toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Recovery rate
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Most Common Fallback</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-sm font-medium truncate">
                  {fallbacks.length > 0 
                    ? fallbacks.sort((a, b) => b.fallbackCount - a.fallbackCount)[0].originalModel + ' → ' 
                      + fallbacks.sort((a, b) => b.fallbackCount - a.fallbackCount)[0].fallbackModel
                    : 'None'
                  }
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Primary path
                </p>
              </CardContent>
            </Card>
          </div>
          
          {/* Fallback Distribution Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Fallback Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={fallbacks}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis 
                      dataKey="originalModel" 
                      fontSize={12}
                      tick={{ fill: 'currentColor' }}
                    />
                    <YAxis 
                      fontSize={12}
                      tick={{ fill: 'currentColor' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="fallbackCount" name="Fallback Count" fill="#8b5cf6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          
          {/* Fallback Success Rate Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Fallback Success vs Failure</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={fallbacks.map(item => ({
                        name: `${item.originalModel} → ${item.fallbackModel}`,
                        value: item.fallbackCount
                      }))}
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                      nameKey="name"
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    >
                      {fallbacks.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={`hsl(${index * 45}, 70%, 60%)`} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="alerts" className="space-y-4 sm:space-y-6">
          {/* Alert Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Alerts</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold">
                  {alerts.length.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  All notifications
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Unacknowledged Alerts</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold text-amber-600">
                  {alerts.filter(a => !a.acknowledged).length.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Require action
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Critical Alerts</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold text-red-600">
                  {alerts.filter(a => a.level === 'critical').length.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Urgent issues
                </p>
              </CardContent>
            </Card>
          </div>
          
          {/* Alerts List */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Recent Alerts</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {alerts.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    <CheckCircle className="h-12 w-12 mx-auto mb-3 text-green-500" />
                    <p className="text-base font-medium">No alerts found</p>
                    <p className="text-sm">All systems operating normally</p>
                  </div>
                ) : (
                  alerts.slice(0, 10).map(alert => (
                    <Alert 
                      key={alert.id} 
                      variant={
                        alert.level === 'critical' ? 'destructive' : 'default'
                      }
                      className={`${alert.acknowledged ? 'opacity-60' : ''} transition-opacity`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex-1 min-w-0">
                          <AlertTitle className="flex items-center gap-2 text-sm">
                            {alert.level === 'critical' && <AlertTriangle className="h-4 w-4 flex-shrink-0" />}
                            <span className="truncate">{alert.message}</span>
                            <Badge 
                              variant={
                                alert.level === 'critical' ? 'destructive' :
                                alert.level === 'warning' ? 'default' : 'outline'
                              }
                              className="text-xs flex-shrink-0"
                            >
                              {alert.level}
                            </Badge>
                          </AlertTitle>
                          <AlertDescription className="mt-1 text-xs text-muted-foreground">
                            {new Date(alert.timestamp).toLocaleString()} • {alert.type}
                            {alert.acknowledged && (
                              <span className="ml-2">
                                • Acknowledged
                              </span>
                            )}
                          </AlertDescription>
                        </div>
                        
                        {!alert.acknowledged && (
                          <Button 
                            size="sm" 
                            variant="outline"
                            onClick={() => acknowledgeAlert(alert.id)}
                            className="ml-3 flex-shrink-0"
                          >
                            Acknowledge
                          </Button>
                        )}
                      </div>
                    </Alert>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ModelMetricsMonitoring;

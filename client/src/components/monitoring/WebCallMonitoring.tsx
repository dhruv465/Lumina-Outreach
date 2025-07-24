import React, { useState, useEffect } from 'react';
import { 
  ResponsiveContainer, 
  LineChart, Line, 
  BarChart, Bar, 
  XAxis, YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend,
  PieChart, Pie, Cell
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { RefreshCw } from 'lucide-react';
import axios from 'axios';

// Types for web call monitoring data
interface WebCallMetrics {
  testId: string;
  campaignId: string;
  campaignName: string;
  startTime: string;
  endTime: string;
  duration: number;
  metrics: {
    responseTime: {
      avg: number;
      min: number;
      max: number;
    };
    userSpeakingTime: number;
    agentSpeakingTime: number;
    interruptions: number;
    speechToTextLatency: number;
    textToSpeechLatency: number;
    llmLatency: number;
  };
  status: 'completed' | 'error' | 'terminated';
}

interface CampaignPerformance {
  campaignId: string;
  campaignName: string;
  webCallCount: number;
  realCallCount: number;
  webCallAvgResponseTime: number;
  realCallAvgResponseTime: number;
  webCallAvgDuration: number;
  realCallAvgDuration: number;
  webCallSuccessRate: number;
  realCallSuccessRate: number;
}

interface WebCallMonitoringProps {
  className?: string;
}

/**
 * WebCallMonitoring Component
 * 
 * Displays monitoring data for web call tests, including metrics and comparisons with real calls
 */
const WebCallMonitoring: React.FC<WebCallMonitoringProps> = ({ className = '' }) => {
  const [activeTab, setActiveTab] = useState('overview');
  const [timeRange, setTimeRange] = useState('24h');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [webCallTests, setWebCallTests] = useState<WebCallMetrics[]>([]);
  const [campaignPerformance, setCampaignPerformance] = useState<CampaignPerformance[]>([]);
  
  // Fetch web call monitoring data
  const fetchWebCallData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Fetch web call test data
      const response = await axios.get(`/api/webcall/metrics?timeRange=${timeRange}`);
      setWebCallTests(response.data.tests || []);
      
      // Fetch campaign performance comparison data
      const comparisonResponse = await axios.get(`/api/webcall/comparison?timeRange=${timeRange}`);
      setCampaignPerformance(comparisonResponse.data.campaigns || []);
      
    } catch (err) {
      console.error('Error fetching web call monitoring data:', err);
      setError('Failed to load web call monitoring data. Please try again later.');
    } finally {
      setLoading(false);
    }
  };
  
  useEffect(() => {
    fetchWebCallData();
    
    // Set up polling interval (refresh every 5 minutes)
    const intervalId = setInterval(fetchWebCallData, 5 * 60 * 1000);
    
    return () => clearInterval(intervalId);
  }, [timeRange]);
  
  // Format milliseconds to seconds with 2 decimal places
  const formatMs = (ms?: number): string => {
    if (ms === undefined) return 'N/A';
    return `${(ms / 1000).toFixed(2)}s`;
  };
  
  // Calculate total metrics
  const totalWebCalls = webCallTests.length;
  const completedWebCalls = webCallTests.filter(test => test.status === 'completed').length;
  const errorWebCalls = webCallTests.filter(test => test.status === 'error').length;
  const avgResponseTime = webCallTests.length > 0 
    ? webCallTests.reduce((sum, test) => sum + (test.metrics.responseTime.avg || 0), 0) / webCallTests.length 
    : 0;
  const avgDuration = webCallTests.length > 0 
    ? webCallTests.reduce((sum, test) => sum + (test.duration || 0), 0) / webCallTests.length 
    : 0;
  
  // Generate data for charts
  const responseTimeByTest = webCallTests.map(test => ({
    name: test.testId.substring(0, 8),
    avg: test.metrics.responseTime.avg,
    min: test.metrics.responseTime.min,
    max: test.metrics.responseTime.max,
    stt: test.metrics.speechToTextLatency,
    llm: test.metrics.llmLatency,
    tts: test.metrics.textToSpeechLatency,
  }));
  
  const speakingTimeByTest = webCallTests.map(test => ({
    name: test.testId.substring(0, 8),
    user: test.metrics.userSpeakingTime,
    agent: test.metrics.agentSpeakingTime,
    silence: test.duration - test.metrics.userSpeakingTime - test.metrics.agentSpeakingTime,
  }));
  
  const statusDistribution = [
    { name: 'Completed', value: completedWebCalls },
    { name: 'Error', value: errorWebCalls },
    { name: 'Terminated', value: totalWebCalls - completedWebCalls - errorWebCalls },
  ];
  
  const COLORS = ['#22c55e', '#ef4444', '#f59e0b'];
  
  return (
    <div className={`web-call-monitoring ${className}`}>
      {/* Time Range and Refresh Controls */}
      <div className="flex flex-col space-y-3 sm:flex-row sm:justify-between sm:items-center sm:space-y-0 mb-4">
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="text-xs">
            Web Call Monitoring
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
            onClick={fetchWebCallData} 
            variant="outline" 
            size="sm"
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>
      
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid grid-cols-3 w-full max-w-md">
          <TabsTrigger value="overview" className="text-xs sm:text-sm">Overview</TabsTrigger>
          <TabsTrigger value="metrics" className="text-xs sm:text-sm">Detailed Metrics</TabsTrigger>
          <TabsTrigger value="comparison" className="text-xs sm:text-sm">Call Comparison</TabsTrigger>
        </TabsList>
        
        <TabsContent value="overview" className="space-y-4 sm:space-y-6">
          {/* Overview Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Total Web Calls</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold">
                  {totalWebCalls.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  In selected time period
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Success Rate</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold text-green-600">
                  {totalWebCalls > 0 ? ((completedWebCalls / totalWebCalls) * 100).toFixed(1) : '0'}%
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Completed calls
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg Response Time</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold">
                  {formatMs(avgResponseTime)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Agent processing
                </p>
              </CardContent>
            </Card>
            
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground">Avg Call Duration</CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="text-2xl sm:text-3xl font-bold">
                  {formatMs(avgDuration)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Total conversation time
                </p>
              </CardContent>
            </Card>
          </div>
          
          {/* Status Distribution Chart */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Web Call Status Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={statusDistribution}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="value"
                      >
                        {statusDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
            
            {/* Recent Web Calls */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-semibold">Recent Web Calls</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 font-medium">Campaign</th>
                        <th className="text-left py-2 font-medium">Duration</th>
                        <th className="text-left py-2 font-medium">Status</th>
                        <th className="text-left py-2 font-medium">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {webCallTests.slice(0, 5).map((test) => (
                        <tr key={test.testId} className="border-b">
                          <td className="py-2">{test.campaignName}</td>
                          <td className="py-2">{formatMs(test.duration)}</td>
                          <td className="py-2">
                            <Badge variant={
                              test.status === 'completed' ? 'outline' : 
                              test.status === 'error' ? 'destructive' : 'secondary'
                            }>
                              {test.status}
                            </Badge>
                          </td>
                          <td className="py-2 text-muted-foreground">
                            {new Date(test.startTime).toLocaleTimeString()}
                          </td>
                        </tr>
                      ))}
                      {webCallTests.length === 0 && (
                        <tr>
                          <td colSpan={4} className="py-4 text-center text-muted-foreground">
                            No web calls found in the selected time period
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
        
        <TabsContent value="metrics" className="space-y-4 sm:space-y-6">
          {/* Response Time Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Response Time Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={responseTimeByTest.slice(0, 10)}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis 
                      dataKey="name" 
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
                    <Bar dataKey="stt" name="Speech-to-Text" stackId="a" fill="#8b5cf6" />
                    <Bar dataKey="llm" name="LLM Processing" stackId="a" fill="#3b82f6" />
                    <Bar dataKey="tts" name="Text-to-Speech" stackId="a" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          
          {/* Speaking Time Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Speaking Time Distribution</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={speakingTimeByTest.slice(0, 10)}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis 
                      dataKey="name" 
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
                    <Bar dataKey="user" name="User Speaking" stackId="a" fill="#3b82f6" />
                    <Bar dataKey="agent" name="Agent Speaking" stackId="a" fill="#10b981" />
                    <Bar dataKey="silence" name="Silence" stackId="a" fill="#d1d5db" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          
          {/* Response Time Trend */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Response Time Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={responseTimeByTest}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis 
                      dataKey="name" 
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
                    <Line type="monotone" dataKey="avg" name="Avg Response Time" stroke="#8b5cf6" activeDot={{ r: 8 }} />
                    <Line type="monotone" dataKey="min" name="Min Response Time" stroke="#10b981" />
                    <Line type="monotone" dataKey="max" name="Max Response Time" stroke="#ef4444" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="comparison" className="space-y-4 sm:space-y-6">
          {/* Campaign Performance Comparison */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Web Call vs Real Call Performance</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={campaignPerformance}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis 
                      dataKey="campaignName" 
                      fontSize={12}
                      tick={{ fill: 'currentColor' }}
                    />
                    <YAxis 
                      label={{ value: 'Response Time (ms)', angle: -90, position: 'insideLeft' }} 
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
                    <Bar dataKey="webCallAvgResponseTime" name="Web Call Avg Response" fill="#8b5cf6" />
                    <Bar dataKey="realCallAvgResponseTime" name="Real Call Avg Response" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          
          {/* Call Duration Comparison */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Call Duration Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={campaignPerformance}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis 
                      dataKey="campaignName" 
                      fontSize={12}
                      tick={{ fill: 'currentColor' }}
                    />
                    <YAxis 
                      label={{ value: 'Duration (ms)', angle: -90, position: 'insideLeft' }} 
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
                    <Bar dataKey="webCallAvgDuration" name="Web Call Avg Duration" fill="#10b981" />
                    <Bar dataKey="realCallAvgDuration" name="Real Call Avg Duration" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
          
          {/* Success Rate Comparison */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Success Rate Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={campaignPerformance}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                    <XAxis 
                      dataKey="campaignName" 
                      fontSize={12}
                      tick={{ fill: 'currentColor' }}
                    />
                    <YAxis 
                      label={{ value: 'Success Rate (%)', angle: -90, position: 'insideLeft' }} 
                      domain={[0, 100]}
                      fontSize={12}
                      tick={{ fill: 'currentColor' }}
                    />
                    <Tooltip 
                      formatter={(value: number) => [`${value.toFixed(1)}%`]}
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="webCallSuccessRate" name="Web Call Success Rate" fill="#22c55e" />
                    <Bar dataKey="realCallSuccessRate" name="Real Call Success Rate" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default WebCallMonitoring;
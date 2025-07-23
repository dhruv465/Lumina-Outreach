import React, { useState } from 'react';
import { 
  ResponsiveContainer, 
  BarChart, Bar, 
  LineChart, Line,
  XAxis, YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Button } from './ui/button';
import { RefreshCw, Download } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';

interface WebCallAnalysisProps {
  className?: string;
}

/**
 * WebCallAnalysis Component
 * 
 * Provides detailed analysis and comparison between web call tests and real calls
 */
const WebCallAnalysis: React.FC<WebCallAnalysisProps> = ({ className = '' }) => {
  const [activeTab, setActiveTab] = useState('response');
  const [timeRange, setTimeRange] = useState('24h');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>('all');
  
  // Fetch campaign data
  const { data: campaignsData } = useQuery({
    queryKey: ['campaigns-for-analysis'],
    queryFn: async () => {
      try {
        const response = await api.get('/campaigns?status=Active,Draft,Paused');
        return response.data?.campaigns || [];
      } catch (err) {
        console.error('Error fetching campaigns for analysis:', err);
        return [];
      }
    },
    staleTime: 30000, // 30 seconds
  });
  
  // Fetch comparison data
  const { data: comparisonData, isLoading: isLoadingComparison, refetch } = useQuery({
    queryKey: ['webcall-comparison', timeRange, selectedCampaignId],
    queryFn: async () => {
      try {
        const url = selectedCampaignId === 'all' 
          ? `/webcall/comparison?timeRange=${timeRange}`
          : `/webcall/comparison?timeRange=${timeRange}&campaignId=${selectedCampaignId}`;
        
        const response = await api.get(url);
        return response.data?.campaigns || [];
      } catch (err) {
        console.error('Error fetching web call comparison data:', err);
        return [];
      }
    },
    staleTime: 60000, // 1 minute
  });
  
  // Format milliseconds to seconds with 2 decimal places
  const formatMs = (ms?: number): string => {
    if (ms === undefined) return 'N/A';
    return `${(ms / 1000).toFixed(2)}s`;
  };
  
  // Handle export
  const handleExport = () => {
    // Create CSV data
    const headers = [
      'Campaign',
      'Web Call Count',
      'Real Call Count',
      'Web Call Avg Response Time (ms)',
      'Real Call Avg Response Time (ms)',
      'Web Call Avg Duration (ms)',
      'Real Call Avg Duration (ms)',
      'Web Call Success Rate (%)',
      'Real Call Success Rate (%)'
    ];
    
    const rows = comparisonData?.map((campaign: any) => [
      campaign.campaignName,
      campaign.webCallCount,
      campaign.realCallCount,
      campaign.webCallAvgResponseTime,
      campaign.realCallAvgResponseTime,
      campaign.webCallAvgDuration,
      campaign.realCallAvgDuration,
      campaign.webCallSuccessRate,
      campaign.realCallSuccessRate
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map((row: any[]) => row.join(','))
    ].join('\n');
    
    // Create download link
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `webcall-comparison-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  // Generate data for radar chart
  const generateRadarData = () => {
    if (!comparisonData || comparisonData.length === 0) return [];
    
    return comparisonData.map((campaign: any) => {
      // Normalize values to 0-100 scale for radar chart
      const webResponseTime = Math.min(100, (1000 / Math.max(1, campaign.webCallAvgResponseTime)) * 50);
      const realResponseTime = Math.min(100, (1000 / Math.max(1, campaign.realCallAvgResponseTime)) * 50);
      
      const webDuration = Math.min(100, (60000 / Math.max(1, campaign.webCallAvgDuration)) * 50);
      const realDuration = Math.min(100, (60000 / Math.max(1, campaign.realCallAvgDuration)) * 50);
      
      return {
        campaign: campaign.campaignName,
        'Web Response Time': webResponseTime,
        'Real Response Time': realResponseTime,
        'Web Duration': webDuration,
        'Real Duration': realDuration,
        'Web Success Rate': campaign.webCallSuccessRate,
        'Real Success Rate': campaign.realCallSuccessRate
      };
    });
  };
  
  // Calculate performance score
  const calculatePerformanceScore = (campaign: any) => {
    if (!campaign) return { web: 0, real: 0 };
    
    // Calculate normalized scores (0-100)
    // Lower response time is better
    const responseTimeScore = {
      web: Math.min(100, (5000 / Math.max(1, campaign.webCallAvgResponseTime)) * 50),
      real: Math.min(100, (5000 / Math.max(1, campaign.realCallAvgResponseTime)) * 50)
    };
    
    // Higher success rate is better
    const successRateScore = {
      web: campaign.webCallSuccessRate,
      real: campaign.realCallSuccessRate
    };
    
    // Calculate weighted average (response time 40%, success rate 60%)
    return {
      web: (responseTimeScore.web * 0.4) + (successRateScore.web * 0.6),
      real: (responseTimeScore.real * 0.4) + (successRateScore.real * 0.6)
    };
  };
  
  // Get overall performance scores
  const getOverallScores = () => {
    if (!comparisonData || comparisonData.length === 0) {
      return { web: 0, real: 0 };
    }
    
    const scores = comparisonData.map((campaign: any) => calculatePerformanceScore(campaign));
    
    const webTotal = scores.reduce((sum, score) => sum + score.web, 0);
    const realTotal = scores.reduce((sum, score) => sum + score.real, 0);
    
    return {
      web: webTotal / scores.length,
      real: realTotal / scores.length
    };
  };
  
  const overallScores = getOverallScores();
  
  return (
    <div className={`web-call-analysis ${className}`}>
      {/* Controls */}
      <div className="flex flex-col space-y-3 sm:flex-row sm:justify-between sm:items-center sm:space-y-0 mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-semibold">Campaign Performance Analysis</h2>
        </div>
        <div className="flex items-center gap-3">
          <Select value={selectedCampaignId} onValueChange={setSelectedCampaignId}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Campaign" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Campaigns</SelectItem>
              {campaignsData?.map((campaign: any) => (
                <SelectItem key={campaign._id} value={campaign._id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
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
            onClick={() => refetch()} 
            variant="outline" 
            size="sm"
            disabled={isLoadingComparison}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoadingComparison ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          
          <Button 
            onClick={handleExport} 
            variant="outline" 
            size="sm"
            disabled={!comparisonData || comparisonData.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
        </div>
      </div>
      
      {/* Performance Score Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Web Call Performance</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl sm:text-3xl font-bold text-purple-600">
              {overallScores.web.toFixed(1)}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
              <div 
                className="bg-purple-600 h-2.5 rounded-full" 
                style={{ width: `${overallScores.web}%` }}
              ></div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Overall score based on response time and success rate
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Real Call Performance</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl sm:text-3xl font-bold text-blue-600">
              {overallScores.real.toFixed(1)}
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2.5 mt-2">
              <div 
                className="bg-blue-600 h-2.5 rounded-full" 
                style={{ width: `${overallScores.real}%` }}
              ></div>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Overall score based on response time and success rate
            </p>
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">Performance Difference</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className={`text-2xl sm:text-3xl font-bold ${
              overallScores.web > overallScores.real ? 'text-green-600' : 
              overallScores.web < overallScores.real ? 'text-amber-600' : 'text-gray-600'
            }`}>
              {(overallScores.web - overallScores.real).toFixed(1)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {overallScores.web > overallScores.real 
                ? 'Web calls outperforming real calls' 
                : overallScores.web < overallScores.real 
                ? 'Real calls outperforming web calls'
                : 'Equal performance'}
            </p>
          </CardContent>
        </Card>
      </div>
      
      {/* Analysis Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="response">Response Time</TabsTrigger>
          <TabsTrigger value="duration">Call Duration</TabsTrigger>
          <TabsTrigger value="success">Success Rate</TabsTrigger>
          <TabsTrigger value="radar">Performance Radar</TabsTrigger>
        </TabsList>
        
        <TabsContent value="response">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Response Time Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={comparisonData}
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
                      formatter={(value: number) => [`${value}ms`, 'Response Time']}
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="webCallAvgResponseTime" name="Web Call" fill="#8b5cf6" />
                    <Bar dataKey="realCallAvgResponseTime" name="Real Call" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="duration">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Call Duration Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={comparisonData}
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
                      formatter={(value: number) => [formatMs(value), 'Duration']}
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="webCallAvgDuration" name="Web Call" fill="#10b981" />
                    <Bar dataKey="realCallAvgDuration" name="Real Call" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="success">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Success Rate Comparison</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={comparisonData}
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
                      formatter={(value: number) => [`${value.toFixed(1)}%`, 'Success Rate']}
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="webCallSuccessRate" name="Web Call" fill="#22c55e" />
                    <Bar dataKey="realCallSuccessRate" name="Real Call" fill="#3b82f6" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        
        <TabsContent value="radar">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-semibold">Performance Radar Analysis</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-64 sm:h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart outerRadius={90} width={730} height={250} data={generateRadarData()}>
                    <PolarGrid />
                    <PolarAngleAxis dataKey="campaign" />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} />
                    <Radar name="Web Call" dataKey="Web Success Rate" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.6} />
                    <Radar name="Real Call" dataKey="Real Success Rate" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} />
                    <Legend />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px'
                      }}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default WebCallAnalysis;
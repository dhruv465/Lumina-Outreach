import React, { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { 
  Phone, 
  PhoneCall, 
  Mic, 
  MicOff, 
  Volume2, 
  VolumeX, 
  Play, 
  Square, 
  RotateCcw,
  Settings,
  Activity,
  Clock,
  Users,
  TrendingUp,
  Download,
  Share,
  Zap
} from 'lucide-react';
import WebCallTesting from '@/components/WebCallTesting';

const WebCallTestingPage: React.FC = () => {
  const [activeView, setActiveView] = useState<'testing' | 'history' | 'analytics'>('testing');
  
  const handleCallEnd = (callData: any) => {
    console.log('Call ended:', callData);
    // You can add additional handling here if needed
  };

  const stats = [
    { label: 'Total Tests', value: '24', icon: Phone, trend: '+12%' },
    { label: 'Avg Duration', value: '2:34', icon: Clock, trend: '+8%' },
    { label: 'Success Rate', value: '94%', icon: TrendingUp, trend: '+5%' },
    { label: 'Active Campaigns', value: '3', icon: Users, trend: '0%' }
  ];

  return (
    <>
      <Helmet>
        <title>Voice Agent Testing Studio | Lumina Outreach</title>
      </Helmet>

      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50">
        {/* Header */}
        <div className="bg-white/80 backdrop-blur-sm border-b border-slate-200/60 sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-6 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-lg">
                    <PhoneCall className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h1 className="text-2xl font-bold bg-gradient-to-r from-slate-900 to-slate-700 bg-clip-text text-transparent">
                      Voice Agent Testing Studio
                    </h1>
                    <p className="text-sm text-slate-600">
                      Test and refine your AI voice agents in real-time
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="flex items-center space-x-3">
                <Button variant="outline" size="sm" className="hidden sm:flex">
                  <Settings className="h-4 w-4 mr-2" />
                  Settings
                </Button>
                <Button variant="outline" size="sm" className="hidden sm:flex">
                  <Share className="h-4 w-4 mr-2" />
                  Share
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-6 py-8">
          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {stats.map((stat, index) => (
              <Card key={index} className="bg-white/60 backdrop-blur-sm border-slate-200/60 hover:bg-white/80 transition-all duration-200">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-slate-600">{stat.label}</p>
                      <p className="text-2xl font-bold text-slate-900 mt-1">{stat.value}</p>
                      <p className="text-xs text-green-600 mt-1 flex items-center">
                        <TrendingUp className="h-3 w-3 mr-1" />
                        {stat.trend}
                      </p>
                    </div>
                    <div className="p-3 bg-gradient-to-r from-blue-500/10 to-indigo-600/10 rounded-lg">
                      <stat.icon className="h-6 w-6 text-blue-600" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Navigation Tabs */}
          <div className="mb-8">
            <div className="flex space-x-1 bg-white/60 backdrop-blur-sm p-1 rounded-lg border border-slate-200/60 w-fit">
              <button
                onClick={() => setActiveView('testing')}
                className={`px-6 py-2 rounded-md text-sm font-medium transition-all duration-200 flex items-center space-x-2 ${
                  activeView === 'testing'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Zap className="h-4 w-4" />
                <span>Live Testing</span>
              </button>
              <button
                onClick={() => setActiveView('history')}
                className={`px-6 py-2 rounded-md text-sm font-medium transition-all duration-200 flex items-center space-x-2 ${
                  activeView === 'history'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Clock className="h-4 w-4" />
                <span>Test History</span>
              </button>
              <button
                onClick={() => setActiveView('analytics')}
                className={`px-6 py-2 rounded-md text-sm font-medium transition-all duration-200 flex items-center space-x-2 ${
                  activeView === 'analytics'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Activity className="h-4 w-4" />
                <span>Analytics</span>
              </button>
            </div>
          </div>

          {/* Content */}
          {activeView === 'testing' && (
            <div className="space-y-6">
              <Card className="bg-white/60 backdrop-blur-sm border-slate-200/60">
                <CardHeader className="pb-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl text-slate-900">Voice Agent Testing</CardTitle>
                      <CardDescription className="text-slate-600 mt-1">
                        Test your campaign voice agents in real-time using your browser's microphone
                      </CardDescription>
                    </div>
                    <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-200">
                      <div className="w-2 h-2 bg-green-500 rounded-full mr-2 animate-pulse"></div>
                      Ready
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <WebCallTesting 
                    onCallEnd={handleCallEnd}
                    height="700px"
                  />
                </CardContent>
              </Card>
            </div>
          )}

          {activeView === 'history' && (
            <div className="space-y-6">
              <Card className="bg-white/60 backdrop-blur-sm border-slate-200/60">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl text-slate-900">Test History</CardTitle>
                      <CardDescription className="text-slate-600 mt-1">
                        View and analyze your previous voice agent tests
                      </CardDescription>
                    </div>
                    <Button variant="outline" size="sm">
                      <Download className="h-4 w-4 mr-2" />
                      Export
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-12">
                    <Clock className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-900 mb-2">Test History Coming Soon</h3>
                    <p className="text-slate-600 max-w-md mx-auto">
                      We're building a comprehensive history view where you can review past tests, 
                      analyze performance trends, and export detailed reports.
                    </p>
                    <Button className="mt-6" variant="outline">
                      <Activity className="h-4 w-4 mr-2" />
                      Get Notified
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {activeView === 'analytics' && (
            <div className="space-y-6">
              <Card className="bg-white/60 backdrop-blur-sm border-slate-200/60">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-xl text-slate-900">Performance Analytics</CardTitle>
                      <CardDescription className="text-slate-600 mt-1">
                        Deep insights into your voice agent performance and optimization opportunities
                      </CardDescription>
                    </div>
                    <Button variant="outline" size="sm">
                      <TrendingUp className="h-4 w-4 mr-2" />
                      Generate Report
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-center py-12">
                    <Activity className="h-12 w-12 text-slate-400 mx-auto mb-4" />
                    <h3 className="text-lg font-medium text-slate-900 mb-2">Advanced Analytics Coming Soon</h3>
                    <p className="text-slate-600 max-w-md mx-auto">
                      Get detailed insights into conversation flow, response times, user satisfaction, 
                      and AI performance metrics to optimize your voice agents.
                    </p>
                    <Button className="mt-6" variant="outline">
                      <TrendingUp className="h-4 w-4 mr-2" />
                      Request Early Access
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default WebCallTestingPage;
import React from 'react';
import { Helmet } from 'react-helmet-async';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import WebCallTesting from '@/components/WebCallTesting';

const WebCallTestingPage: React.FC = () => {
  const handleCallEnd = (callData: any) => {
    console.log('Call ended:', callData);
    // You can add additional handling here if needed
  };

  return (
    <>
      <Helmet>
        <title>Web Call Testing | Lumina Outreach</title>
      </Helmet>

      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Web Call Testing</h1>
          <p className="text-muted-foreground">
            Test your campaigns with web-based voice calls without making actual phone calls.
          </p>
        </div>

        <Tabs defaultValue="testing" className="space-y-4">
          <TabsList>
            <TabsTrigger value="testing">Testing</TabsTrigger>
            <TabsTrigger value="history">Test History</TabsTrigger>
          </TabsList>
          
          <TabsContent value="testing" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Web Call Testing</CardTitle>
                <CardDescription>
                  Test your campaign voice agents in real-time using your browser's microphone.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <WebCallTesting 
                  onCallEnd={handleCallEnd}
                  height="600px"
                />
              </CardContent>
            </Card>
          </TabsContent>
          
          <TabsContent value="history" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Test History</CardTitle>
                <CardDescription>
                  View and analyze your previous web call tests.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground text-center py-8">
                  Test history feature coming soon.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
};

export default WebCallTestingPage;
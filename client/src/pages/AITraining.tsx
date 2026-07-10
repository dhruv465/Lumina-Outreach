import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { 
  Brain, 
  CheckCircle2, 
  XCircle, 
  MessageSquare, 
  TrendingUp, 
  RefreshCw, 
  ShieldCheck,
  Search,
  Clock,
  Info,
  Zap
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { feedbackApi, CallFeedback } from '@/services/feedbackApi';
import { format } from 'date-fns';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const AITraining = () => {
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');

  // Fetch pending feedback
  const { data: feedbackResponse, isLoading } = useQuery({
    queryKey: ['pendingFeedback'],
    queryFn: () => feedbackApi.getPendingFeedback(),
  });

  // Mutation for reviewing feedback
  const reviewMutation = useMutation({
    mutationFn: ({ id, data }: { id: string, data: { actualIntent?: string; isCorrect: boolean } }) => 
      feedbackApi.reviewFeedback(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pendingFeedback'] });
      toast.success('Feedback reviewed successfully');
    },
    onError: (error: any) => {
      toast.error(`Error: ${error.message}`);
    }
  });

  // Mutation for triggering retraining
  const retrainMutation = useMutation({
    mutationFn: () => feedbackApi.triggerRetraining(),
    onSuccess: (data) => {
      toast.success(data.message || 'Retraining process started');
    },
    onError: (error: any) => {
      toast.error(`Error: ${error.message}`);
    }
  });

  const handleApprove = (feedback: CallFeedback) => {
    reviewMutation.mutate({ 
      id: feedback._id, 
      data: { isCorrect: true } 
    });
  };

  const handleCorrect = (feedback: CallFeedback, correctedIntent: string) => {
    reviewMutation.mutate({ 
      id: feedback._id, 
      data: { actualIntent: correctedIntent, isCorrect: false } 
    });
  };

  const feedbackList = feedbackResponse?.data || [];
  const filteredFeedback = feedbackList.filter(f => 
    f.text.toLowerCase().includes(searchTerm.toLowerCase()) ||
    f.detectedIntent.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Brain className="text-primary h-8 w-8" />
            AI Training & Feedback
          </h1>
          <p className="text-muted-foreground mt-1">
            Review agent interactions and help the AI learn from real-world conversations.
          </p>
        </div>
        <Button 
          onClick={() => retrainMutation.mutate()} 
          disabled={retrainMutation.isPending}
          className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-lg shadow-primary/20"
        >
          {retrainMutation.isPending ? (
            <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Brain className="mr-2 h-4 w-4" />
          )}
          Trigger Agent Retraining
        </Button>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="border-none bg-gradient-to-br from-primary/10 to-primary/5 shadow-sm border-l-4 border-l-primary">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Pending Review
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{isLoading ? '...' : feedbackList.length}</div>
            <p className="text-xs text-muted-foreground mt-1">Phrases waiting for human approval</p>
          </CardContent>
        </Card>

        <Card className="border-none bg-gradient-to-br from-green-500/10 to-green-500/5 shadow-sm border-l-4 border-l-green-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase flex items-center gap-2">
              <ShieldCheck className="h-4 w-4" />
              NLU Accuracy
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">92.4%</div>
            <p className="text-xs text-muted-foreground mt-1">+2.1% from last retraining cycle</p>
          </CardContent>
        </Card>

        <Card className="border-none bg-gradient-to-br from-blue-500/10 to-blue-500/5 shadow-sm border-l-4 border-l-blue-500">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground uppercase flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Learning Velocity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">42</div>
            <p className="text-xs text-muted-foreground mt-1">New patterns identified this week</p>
          </CardContent>
        </Card>
      </div>

      {/* Review Section */}
      <Card className="border-muted/20 shadow-xl bg-card/50 backdrop-blur-sm">
        <CardHeader className="border-b border-muted/10 pb-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <CardTitle>Conversation Feedback Loop</CardTitle>
              <CardDescription>Review detected intents and provide corrections to improve model accuracy.</CardDescription>
            </div>
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="Search phrases or intents..." 
                className="pl-10 bg-background/50 border-muted/20"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow>
                <TableHead className="w-[40%]">User Utterance</TableHead>
                <TableHead>Detected Intent</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell><Skeleton className="h-4 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="h-8 w-20 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : filteredFeedback.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="h-32 text-center text-muted-foreground">
                    No pending feedback found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredFeedback.map((feedback) => (
                  <TableRow key={feedback._id} className="hover:bg-muted/20 transition-colors group">
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-1">
                        <span className="text-foreground italic italic text-base">"{feedback.text}"</span>
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1 uppercase tracking-tighter">
                          <Clock className="h-3 w-3" />
                          {format(new Date(feedback.createdAt), 'MMM d, h:mm a')}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="bg-blue-500/5 text-blue-500 border-blue-500/20 font-mono text-xs">
                        {feedback.detectedIntent}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full rounded-full",
                              feedback.detectedConfidence > 0.8 ? "bg-green-500" : 
                              feedback.detectedConfidence > 0.5 ? "bg-yellow-500" : "bg-red-500"
                            )}
                            style={{ width: `${feedback.detectedConfidence * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium">
                          {Math.round(feedback.detectedConfidence * 100)}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">{feedback.campaignId?.name || 'Unknown'}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-8 w-8 p-0 text-red-500 hover:text-red-600 hover:bg-red-500/10"
                          onClick={() => {
                            const correction = prompt('Enter the correct intent name:', feedback.detectedIntent);
                            if (correction) handleCorrect(feedback, correction);
                          }}
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                        <Button 
                          size="sm" 
                          variant="ghost" 
                          className="h-8 w-8 p-0 text-green-500 hover:text-green-600 hover:bg-green-500/10"
                          onClick={() => handleApprove(feedback)}
                        >
                          <CheckCircle2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Info Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card className="border-muted/20 bg-muted/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Retraining Protocol
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <p>
              When you <span className="text-green-500 font-semibold uppercase">Approve</span> an utterance, it's added to the existing intent's training set to reinforce the pattern.
            </p>
            <p>
              When you <span className="text-red-500 font-semibold uppercase">Correct</span> an intent, the utterance is moved to the target intent, helping the AI distinguish between similar-sounding phrases.
            </p>
            <div className="pt-2 flex items-center gap-2 text-xs font-mono bg-background/50 p-2 rounded border border-muted/20">
              <Info className="h-3 w-3" />
              Retraining job runs automatically at 2:00 AM daily.
            </div>
          </CardContent>
        </Card>

        <Card className="border-muted/20 bg-muted/5">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Zap className="h-5 w-5 text-yellow-500" />
              Active Learning Benefits
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <ul className="space-y-2">
              <li className="flex items-start gap-2">
                <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                </div>
                <span>Reduces call drops by handling common objections more naturally.</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                </div>
                <span>Improves lead qualification by better understanding customer intent.</span>
              </li>
              <li className="flex items-start gap-2">
                <div className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                  <div className="h-1.5 w-1.5 rounded-full bg-primary" />
                </div>
                <span>Allows the agent to adapt to changing market conditions and new product scripts.</span>
              </li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default AITraining;

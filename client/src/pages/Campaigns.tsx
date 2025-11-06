import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '@/services/api';
import {
  Search,
  Plus,
  Filter,
  MoreHorizontal,
  ChevronDown,
  Trash2,
  Edit,
  Play,
  Pause,
  AlertTriangle,
  Info,
  MessageSquare,
  BarChart3,
  Zap,
  X
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';
import CampaignForm from '@/components/campaigns/CampaignForm';
import DeleteCampaignDialog from '@/components/campaigns/DeleteCampaignDialog';
import { Skeleton } from "@/components/ui/skeleton";

// Types

interface Campaign {
  _id: string;
  name: string;
  description: string;
  status: 'Draft' | 'Active' | 'Paused' | 'Completed';
  goal: string;
  targetAudience: string;
  leadSources: string[];
  primaryLanguage: string;
  supportedLanguages: string[];
  startDate: string;
  endDate?: string;
  script: {
    name: string;
    content: string;
    versions: Array<{
      name: string;
      content: string;
      isActive: boolean;
    }>;
  };
  callTiming: {
    daysOfWeek: string[];
    startTime: string;
    endTime: string;
    timeZone: string;
  };
  llmConfiguration: {
    model: string;
    systemPrompt: string;
    temperature: number;
    maxTokens: number;
  };
  voiceConfiguration: {
    provider: string;
    voiceId: string;
    speed: number;
    pitch: number;
  };
  metrics?: {
    totalCalls: number;
    successfulCalls: number;
    avgCallDuration: number;
    conversionRate: number;
  };
}

interface CampaignsData {
  campaigns: Campaign[];
  pagination?: {
    page: number;
    pages: number;
    total: number;
    limit: number;
  };
}

const Campaigns = () => {
  // State
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(5);
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState<string | undefined>();
  
  // Delete dialog state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [campaignToDelete, setCampaignToDelete] = useState<{ id: string; name: string } | null>(null);
  
  // Event handlers
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchTerm(e.target.value);
    setCurrentPage(1);
  };

  const handleCreateCampaign = () => {
    setEditingCampaignId(undefined);
    setShowCampaignForm(true);
  };

  const handleEditCampaign = (campaignId: string) => {
    setEditingCampaignId(campaignId);
    setShowCampaignForm(true);
  };

  const handleViewCampaign = (campaign: Campaign) => {
    setSelectedCampaign(campaign);
    setIsSheetOpen(true);
  };

  const handleChangeCampaignStatus = async (campaignId: string, newStatus: 'Draft' | 'Active' | 'Paused' | 'Completed') => {
    try {
      await api.put(`/campaigns/${campaignId}`, { status: newStatus });
      console.log(`Campaign ${campaignId} status changed to ${newStatus}`);
      
      // Refresh campaigns data
      refetch();
      
      // If campaign details sheet is open, update it
      if (selectedCampaign && selectedCampaign._id === campaignId) {
        setSelectedCampaign({
          ...selectedCampaign,
          status: newStatus
        });
      }
    } catch (error) {
      console.error('Error changing campaign status:', error);
    }
  };

  const handleDeleteCampaign = (campaignId: string, campaignName: string) => {
    setCampaignToDelete({ id: campaignId, name: campaignName });
    setIsDeleteDialogOpen(true);
  };

  const handleDeleteSuccess = () => {
    // Close detail sheet if it's open for this campaign
    if (selectedCampaign && campaignToDelete && selectedCampaign._id === campaignToDelete.id) {
      setIsSheetOpen(false);
      setSelectedCampaign(null);
    }
    
    // Refresh campaigns data
    refetch();
  };

  const handleCampaignFormClose = () => {
    setShowCampaignForm(false);
    setEditingCampaignId(undefined);
  };

  const handleCampaignFormSuccess = () => {
    // Refresh campaigns data
    console.log("Campaign form succeeded, refreshing data...");
    refetch().then(() => {
      console.log("Campaign data refreshed");
    }).catch(err => {
      console.error("Error refreshing campaign data:", err);
    });
  };

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'Active': return 'default';
      case 'Draft': return 'secondary';
      case 'Paused': return 'outline';
      case 'Completed': return 'destructive';
      default: return 'secondary';
    }
  };
  
  // Fetch campaigns from API
  const { data: campaignsData, isLoading, error, refetch } = useQuery<CampaignsData>({
    queryKey: ['campaigns', currentPage, itemsPerPage, searchTerm, statusFilter],
    queryFn: async () => {
      try {
        const params = new URLSearchParams({
          page: currentPage.toString(),
          limit: itemsPerPage.toString(),
        });
        
        if (searchTerm) {
          params.append('search', searchTerm);
        }
        
        if (statusFilter !== 'All') {
          params.append('status', statusFilter);
        }
        
        const response = await api.get(`/campaigns?${params.toString()}`);
        console.log('Campaign API response:', response.data);
        return response.data || { campaigns: [], pagination: { page: 1, pages: 0, total: 0, limit: itemsPerPage } };
      } catch (err) {
        console.error('Error fetching campaigns:', err);
        // Return empty data structure instead of throwing error for new installations
        return { campaigns: [], pagination: { page: 1, pages: 0, total: 0, limit: itemsPerPage } };
      }
    },
    refetchOnWindowFocus: false,
    staleTime: 30000, // 30 seconds
    retry: 3, // Retry up to 3 times on failure
    retryDelay: (attemptIndex: number) => Math.min(1000 * 2 ** attemptIndex, 10000), // Exponential backoff
  });

  // Get filtered campaigns based on data
  const filteredCampaigns = campaignsData?.campaigns || 
    // Handle both formats: array response or object with campaigns property
    (Array.isArray(campaignsData) ? campaignsData : []);

  // Event handlers
  
  // Handle loading state
  if (isLoading) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-40" />
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-32" />
        </div>
        <div className="grid grid-cols-1 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="p-4 sm:p-6">
              <div className="flex items-center justify-between mb-2">
                <Skeleton className="h-6 w-40" />
                <Skeleton className="h-6 w-20" />
              </div>
              <Skeleton className="h-4 w-3/4 mb-2" />
              <Skeleton className="h-4 w-1/2 mb-2" />
              <div className="flex gap-2 mt-4">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-8 w-24" />
              </div>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Handle error state
  if (error) {
    return (
      <div className="space-y-4 sm:space-y-6">
        <h1 className="text-2xl sm:text-3xl font-bold">Campaigns</h1>
        <Card className="p-4 sm:p-6 border-destructive bg-destructive/10">
          <div className="flex items-center space-x-2">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            <h3 className="font-medium">Error Loading Campaigns</h3>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            If this is a new installation, you may not have any campaigns yet. Try creating your first campaign.
          </p>
          <div className="flex flex-row gap-2 flex-wrap mt-4">
            <Button 
              variant="outline" 
              onClick={() => refetch()}
              size="sm"
            >
              Retry
            </Button>
            <Button onClick={handleCreateCampaign} size="sm">
              <Plus size={16} className="mr-2" />
              Create Campaign
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (filteredCampaigns.length === 0 && searchTerm === '' && statusFilter === 'All') {
    return (
      <div className="space-y-4 sm:space-y-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <h1 className="text-2xl sm:text-3xl font-bold">Campaigns</h1>
        </div>
        
        <Card className="p-6 sm:p-8 text-center">
          <AlertTriangle size={48} className="mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No campaigns yet</h3>
          <p className="text-muted-foreground mb-4">
            Create your first campaign to start making AI-powered cold calls.
          </p>
          <Button onClick={handleCreateCampaign} size="sm">
            <Plus size={16} className="mr-2" />
            Create Campaign
          </Button>
        </Card>
        
        <Sheet open={showCampaignForm} onOpenChange={(open) => {
          if (!open) handleCampaignFormClose();
          setShowCampaignForm(open);
        }}>
          {showCampaignForm && (
            <CampaignForm
              campaignId={editingCampaignId}
              onClose={handleCampaignFormClose}
              onSuccess={handleCampaignFormSuccess}
            />
          )}
        </Sheet>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <h1 className="text-2xl sm:text-3xl font-bold">Campaigns</h1>
        <div className="flex items-center gap-2">
          <Button onClick={handleCreateCampaign} size="sm">
            <Plus size={16} className="mr-2" />
            Create Campaign
          </Button>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="relative flex-grow w-full">
          <Search size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search campaigns..."
            value={searchTerm}
            onChange={handleSearchChange}
            className="w-full pl-10"
          />
        </div>
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="flex items-center gap-1 justify-between sm:justify-center">
              <div className="flex items-center gap-1">
                <Filter size={16} />
                <span className="truncate">Status: {statusFilter}</span>
              </div>
              <ChevronDown size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem onClick={() => setStatusFilter('All')}>
              All
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setStatusFilter('Active')}>
              Active
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setStatusFilter('Draft')}>
              Draft
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setStatusFilter('Paused')}>
              Paused
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setStatusFilter('Completed')}>
              Completed
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Campaigns Grid */}
      <div className="grid grid-cols-1 gap-4">
        {filteredCampaigns.map((campaign: Campaign) => (
          <Card key={campaign._id} className="p-4 sm:p-6">
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
              <div className="flex-grow min-w-0">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 mb-2">
                  <h3 className="text-lg font-semibold truncate">{campaign.name}</h3>
                  <Badge variant={getStatusBadgeVariant(campaign.status)}>
                    {campaign.status}
                  </Badge>
                </div>
                
                <p className="text-muted-foreground mb-3 line-clamp-2">{campaign.description}</p>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-sm">
                  <div>
                    <span className="font-medium">Goal:</span>
                    <p className="text-muted-foreground truncate">{campaign.goal}</p>
                  </div>
                  <div>
                    <span className="font-medium">Target:</span>
                    <p className="text-muted-foreground truncate">{campaign.targetAudience}</p>
                  </div>
                  <div>
                    <span className="font-medium">Language:</span>
                    <p className="text-muted-foreground truncate">{campaign.primaryLanguage}</p>
                  </div>
                  <div>
                    <span className="font-medium">Start Date:</span>
                    <p className="text-muted-foreground">{new Date(campaign.startDate).toLocaleDateString()}</p>
                  </div>
                </div>
                
                {campaign.metrics && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4 pt-4 border-t text-sm">
                    <div className="flex items-center gap-1">
                      <span className="font-medium">Total Calls:</span>
                      <HoverCard>
                        <HoverCardTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-4 w-4 p-0">
                            <Info className="h-3 w-3 text-muted-foreground" />
                            <span className="sr-only">Info</span>
                          </Button>
                        </HoverCardTrigger>
                        <HoverCardContent className="w-60">
                          <div className="space-y-2">
                            <h4 className="text-sm font-semibold">Total Calls</h4>
                            <p className="text-sm text-muted-foreground">
                              Total number of calls made for this campaign.
                            </p>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                      <p className="text-muted-foreground ml-auto">{campaign.metrics.totalCalls}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="font-medium">Successful:</span>
                      <HoverCard>
                        <HoverCardTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-4 w-4 p-0">
                            <Info className="h-3 w-3 text-muted-foreground" />
                            <span className="sr-only">Info</span>
                          </Button>
                        </HoverCardTrigger>
                        <HoverCardContent className="w-60">
                          <div className="space-y-2">
                            <h4 className="text-sm font-semibold">Successful Calls</h4>
                            <p className="text-sm text-muted-foreground">
                              Number of calls that resulted in a positive outcome.
                            </p>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                      <p className="text-muted-foreground ml-auto">{campaign.metrics.successfulCalls}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="font-medium">Avg Duration:</span>
                      <HoverCard>
                        <HoverCardTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-4 w-4 p-0">
                            <Info className="h-3 w-3 text-muted-foreground" />
                            <span className="sr-only">Info</span>
                          </Button>
                        </HoverCardTrigger>
                        <HoverCardContent className="w-60">
                          <div className="space-y-2">
                            <h4 className="text-sm font-semibold">Average Duration</h4>
                            <p className="text-sm text-muted-foreground">
                              Average call duration for this campaign.
                            </p>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                      <p className="text-muted-foreground ml-auto">{campaign.metrics.avgCallDuration}m</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="font-medium">Conversion:</span>
                      <HoverCard>
                        <HoverCardTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-4 w-4 p-0">
                            <Info className="h-3 w-3 text-muted-foreground" />
                            <span className="sr-only">Info</span>
                          </Button>
                        </HoverCardTrigger>
                        <HoverCardContent className="w-60">
                          <div className="space-y-2">
                            <h4 className="text-sm font-semibold">Conversion Rate</h4>
                            <p className="text-sm text-muted-foreground">
                              Percentage of calls that converted to positive outcomes.
                            </p>
                          </div>
                        </HoverCardContent>
                      </HoverCard>
                      <p className="text-muted-foreground ml-auto">{campaign.metrics.conversionRate}%</p>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex flex-row lg:flex-col items-center gap-2 lg:ml-4">
                {campaign.status === 'Draft' && (
                  <Button 
                    size="sm" 
                    onClick={() => handleChangeCampaignStatus(campaign._id, 'Active')}
                  >
                    <Play size={16} className="mr-2" />
                    Start
                  </Button>
                )}
                
                {campaign.status === 'Active' && (
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => handleChangeCampaignStatus(campaign._id, 'Paused')}
                  >
                    <Pause size={16} className="mr-2" />
                    Pause
                  </Button>
                )}
                
                {campaign.status === 'Paused' && (
                  <Button 
                    size="sm"
                    onClick={() => handleChangeCampaignStatus(campaign._id, 'Active')}
                  >
                    <Play size={16} className="mr-2" />
                    Resume
                  </Button>
                )}
                
                <Button 
                  size="sm" 
                  variant="outline"
                  onClick={() => handleViewCampaign(campaign)}
                >
                  <Info size={16} className="mr-2" />
                  Details
                </Button>
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm">
                      <MoreHorizontal size={16} />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => handleEditCampaign(campaign._id)}>
                      <Edit size={16} className="mr-2" />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem 
                      className="text-destructive"
                      onClick={() => handleDeleteCampaign(campaign._id, campaign.name)}
                    >
                      <Trash2 size={16} className="mr-2" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Pagination */}
      {campaignsData?.pagination && campaignsData.pagination.pages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 p-4 border rounded-xl bg-card">
          <span className="text-sm text-muted-foreground">
            Page {currentPage} of {campaignsData?.pagination?.pages}
          </span>
          
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setCurrentPage((prev: number) => Math.max(prev - 1, 1))}
              className="px-3"
            >
              Previous
            </Button>
            
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === campaignsData?.pagination?.pages}
              onClick={() => setCurrentPage((prev: number) => Math.min(prev + 1, campaignsData?.pagination?.pages || 1))}
              className="px-3"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Campaign Details Sheet */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className="w-full sm:w-[600px] sm:max-w-[600px] p-0 overflow-hidden">
          {selectedCampaign && (
            <div className="flex flex-col h-full">
              {/* Header with status badge */}
              <div className="px-6 pt-6 pb-4 border-b sticky top-0 bg-background z-10">
                <div className="flex items-center justify-between mb-2">
                  <SheetTitle className="text-xl font-bold">
                    {selectedCampaign.name}
                  </SheetTitle>
                  <div className="flex items-center gap-2">
                    <Badge variant={getStatusBadgeVariant(selectedCampaign.status)}>
                      {selectedCampaign.status}
                    </Badge>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      className="h-8 w-8 p-0 rounded-full"
                      onClick={() => setIsSheetOpen(false)}
                    >
                      <span className="sr-only">Close</span>
                      <X size={16} />
                    </Button>
                  </div>
                </div>
                <p className="text-muted-foreground text-sm">
                  {selectedCampaign.description}
                </p>
              </div>

              {/* Tabs for campaign details */}
              <div className="flex-1 overflow-auto">
                <ScrollArea className="h-[calc(100vh-12rem)]">
                  <div className="px-6 py-4">
                    <div className="grid gap-6">
                      {/* Overview Section */}
                      <div className="bg-card p-4 rounded-lg border">
                        <h3 className="text-base font-medium flex items-center gap-2 mb-3 text-card-foreground">
                          <Zap size={16} className="text-muted-foreground" />
                          Overview
                        </h3>
                        <div className="grid sm:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">Goal</p>
                            <p className="text-sm font-medium">{selectedCampaign.goal}</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">Target Audience</p>
                            <p className="text-sm font-medium">{selectedCampaign.targetAudience}</p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">Schedule</p>
                            <p className="text-sm font-medium">
                              {selectedCampaign.callTiming.daysOfWeek.join(', ')}
                              <span className="block text-xs text-muted-foreground mt-1">
                                {selectedCampaign.callTiming.startTime} - {selectedCampaign.callTiming.endTime} ({selectedCampaign.callTiming.timeZone})
                              </span>
                            </p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-xs text-muted-foreground">Primary Language</p>
                            <p className="text-sm font-medium">{selectedCampaign.primaryLanguage}</p>
                          </div>
                        </div>
                        
                        {selectedCampaign.leadSources.length > 0 && (
                          <div className="mt-4 pt-3 border-t border-border">
                            <p className="text-xs text-muted-foreground mb-2">Lead Sources</p>
                            <div className="flex flex-wrap gap-1.5">
                              {selectedCampaign.leadSources.map((source: string, idx: number) => (
                                <Badge key={idx} variant="outline" className="text-xs">{source}</Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {selectedCampaign.supportedLanguages.length > 1 && (
                          <div className="mt-4 pt-3 border-t border-border">
                            <p className="text-xs text-muted-foreground mb-2">Supported Languages</p>
                            <div className="flex flex-wrap gap-1.5">
                              {selectedCampaign.supportedLanguages
                                .filter((lang: string) => lang !== selectedCampaign.primaryLanguage)
                                .map((lang: string, idx: number) => (
                                  <Badge key={idx} variant="secondary" className="text-xs">{lang}</Badge>
                                ))}
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Metrics Section - Shown only when metrics exist */}
                      {selectedCampaign.metrics && (
                        <div className="bg-card p-4 rounded-lg border">
                          <h3 className="text-base font-medium flex items-center gap-2 mb-3 text-card-foreground">
                            <BarChart3 size={16} className="text-muted-foreground" />
                            Performance Metrics
                          </h3>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div className="p-3 bg-muted/50 rounded-md border">
                              <span className="text-xs text-muted-foreground block mb-1">Total Calls</span>
                              <span className="text-xl font-semibold text-foreground">{selectedCampaign.metrics.totalCalls}</span>
                            </div>
                            <div className="p-3 bg-muted/50 rounded-md border">
                              <span className="text-xs text-muted-foreground block mb-1">Successful</span>
                              <span className="text-xl font-semibold text-foreground">{selectedCampaign.metrics.successfulCalls}</span>
                            </div>
                            <div className="p-3 bg-muted/50 rounded-md border">
                              <span className="text-xs text-muted-foreground block mb-1">Avg Duration</span>
                              <span className="text-xl font-semibold text-foreground">{selectedCampaign.metrics.avgCallDuration}m</span>
                            </div>
                            <div className="p-3 bg-muted/50 rounded-md border">
                              <span className="text-xs text-muted-foreground block mb-1">Conversion</span>
                              <span className="text-xl font-semibold text-foreground">{selectedCampaign.metrics.conversionRate}%</span>
                            </div>
                          </div>
                        </div>
                      )}
                      
                      {/* Script Section */}
                      <div className="bg-card p-4 rounded-lg border">
                        <h3 className="text-base font-medium flex items-center gap-2 mb-3 text-card-foreground">
                          <MessageSquare size={16} className="text-muted-foreground" />
                          Script: {selectedCampaign.script?.name || 'Unnamed Script'}
                        </h3>
                        {selectedCampaign.script && (
                          <div className="mt-3 p-4 bg-muted/50 rounded-lg border text-sm whitespace-pre-wrap max-h-48 overflow-y-auto text-foreground">
                            {selectedCampaign.script.content || selectedCampaign.script.versions?.[0]?.content || 'No script content available'}
                          </div>
                        )}
                        
                        {selectedCampaign.script.versions && selectedCampaign.script.versions.length > 0 && (
                          <div className="mt-4 pt-3 border-t border-border">
                            <p className="text-xs text-muted-foreground mb-2">Script Versions</p>
                            <div className="space-y-2">
                              {selectedCampaign.script.versions.map((version: any, idx: number) => (
                                <div key={idx} className="flex items-center justify-between p-2 bg-muted/50 rounded-md border">
                                  <span className="text-sm">{version.name}</span>
                                  {version.isActive && (
                                    <Badge variant="secondary" className="text-xs">Active</Badge>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {/* Configuration Sections */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div className="bg-card p-4 rounded-lg border">
                          <h3 className="text-base font-medium flex items-center gap-2 mb-3 text-card-foreground">
                            <Zap size={16} className="text-muted-foreground" />
                            LLM Config
                          </h3>
                          <div className="space-y-2">
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Model</p>
                              <p className="text-sm font-medium">{selectedCampaign.llmConfiguration.model}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Temperature</p>
                              <p className="text-sm font-medium">{selectedCampaign.llmConfiguration.temperature}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Max Tokens</p>
                              <p className="text-sm font-medium">{selectedCampaign.llmConfiguration.maxTokens}</p>
                            </div>
                          </div>
                        </div>
                        
                        <div className="bg-card p-4 rounded-lg border">
                          <h3 className="text-base font-medium flex items-center gap-2 mb-3 text-card-foreground">
                            <Zap size={16} className="text-muted-foreground" />
                            Voice Config
                          </h3>
                          <div className="space-y-2">
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Provider</p>
                              <p className="text-sm font-medium">{selectedCampaign.voiceConfiguration.provider}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Voice ID</p>
                              <p className="text-sm font-medium">{selectedCampaign.voiceConfiguration.voiceId}</p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-xs text-muted-foreground">Speed / Pitch</p>
                              <p className="text-sm font-medium">{selectedCampaign.voiceConfiguration.speed} / {selectedCampaign.voiceConfiguration.pitch}</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </ScrollArea>
              </div>
              
              {/* Action buttons at bottom */}
              <div className="px-6 py-4 border-t bg-background sticky bottom-0">
                <div className="flex flex-wrap gap-3 justify-between">
                  <Button 
                    size="sm"
                    onClick={() => handleEditCampaign(selectedCampaign._id)}
                    className="flex-1 min-w-24"
                  >
                    <Edit size={16} className="mr-2" />
                    Edit
                  </Button>
                  
                  {selectedCampaign.status === 'Draft' && (
                    <Button 
                      size="sm"
                      onClick={() => handleChangeCampaignStatus(selectedCampaign._id, 'Active')}
                      className="flex-1 min-w-24"
                    >
                      <Play size={16} className="mr-2" />
                      Start
                    </Button>
                  )}
                  
                  {selectedCampaign.status === 'Active' && (
                    <Button 
                      size="sm"
                      variant="outline"
                      onClick={() => handleChangeCampaignStatus(selectedCampaign._id, 'Paused')}
                      className="flex-1 min-w-24"
                    >
                      <Pause size={16} className="mr-2" />
                      Pause
                    </Button>
                  )}
                  
                  {selectedCampaign.status === 'Paused' && (
                    <Button 
                      size="sm"
                      onClick={() => handleChangeCampaignStatus(selectedCampaign._id, 'Active')}
                      className="flex-1 min-w-24"
                    >
                      <Play size={16} className="mr-2" />
                      Resume
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Campaign Form */}
      <Sheet open={showCampaignForm} onOpenChange={(open) => {
        if (!open) handleCampaignFormClose();
        setShowCampaignForm(open);
      }}>
        {showCampaignForm && (
          <CampaignForm
            campaignId={editingCampaignId}
            onClose={handleCampaignFormClose}
            onSuccess={handleCampaignFormSuccess}
          />
        )}
      </Sheet>

      {/* Delete Campaign Dialog */}
      {campaignToDelete && (
        <DeleteCampaignDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          campaignId={campaignToDelete.id}
          campaignName={campaignToDelete.name}
          onSuccess={handleDeleteSuccess}
        />
      )}
    </div>
  );
};

export default Campaigns;

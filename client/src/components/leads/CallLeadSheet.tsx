import { useState, useEffect } from 'react';
import { Phone } from 'lucide-react';
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle
} from '../ui/sheet';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';

// Import directly from ui/select for now to avoid additional component complexity
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '../ui/select';

import { useToast } from '@/hooks/useToast';
import { checkTelephonyConfiguration, ConfigurationStatus } from '../../utils/configurationUtils';
import { callsApi } from '../../services/callsApi';
import api from '../../services/api';
import ErrorBoundary from '../common/ErrorBoundary';
import LoadingSpinner from '../common/LoadingSpinner';

// Define Campaign interface
interface Campaign {
  _id: string;
  name: string;
  description: string;
  status: 'Draft' | 'Active' | 'Paused' | 'Completed';
  goal: string;
  targetAudience: string;
}

interface CallLeadSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: {
    id?: string; // Optional since we might get _id instead
    _id?: string; // MongoDB ID format
    name: string;
    phoneNumber: string;
    company: string;
    languagePreference: string;
  };
  onSuccess: () => void;
}

const CallLeadSheet = ({
  open,
  onOpenChange,
  lead,
  onSuccess,
}: CallLeadSheetProps) => {
  const { toast } = useToast();
  const [selectedLanguage, setSelectedLanguage] = useState(lead.languagePreference || 'English');
  const [selectedCampaign, setSelectedCampaign] = useState<string>('');
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoadingCampaigns, setIsLoadingCampaigns] = useState(false);
  const [isCallingInProgress, setIsCallingInProgress] = useState(false);
  const [callStatus, setCallStatus] = useState<'idle' | 'connecting' | 'connected' | 'completed' | 'failed'>('idle');
  const [notes, setNotes] = useState('');
  const [configStatus, setConfigStatus] = useState<ConfigurationStatus | null>(null);
  const [, setSystemConfig] = useState<any>(null);

  // Load campaigns when component mounts with improved error handling
  useEffect(() => {
    let isMounted = true;
    let timeoutId: NodeJS.Timeout;

    const loadCampaigns = async () => {
      if (!open) return;
      
      // Add a small delay to prevent rapid successive calls
      timeoutId = setTimeout(async () => {
        if (!isMounted || !open) return;

        setIsLoadingCampaigns(true);
        try {
          console.log('Loading campaigns for call sheet...');
          const response = await api.get('/campaigns');
          
          if (!isMounted || !open) return;

          console.log('Campaigns API response:', response.data);
          
          // Normalize the response data structure
          let campaignsArray;
          if (Array.isArray(response.data)) {
            campaignsArray = response.data;
          } else if (response.data && response.data.campaigns && Array.isArray(response.data.campaigns)) {
            campaignsArray = response.data.campaigns;
          } else {
            console.warn('Unexpected campaigns data structure:', response.data);
            campaignsArray = [];
          }
          
          // Filter to only active or draft campaigns
          const activeCampaigns = campaignsArray.filter((campaign: Campaign) => 
            campaign.status === 'Active' || campaign.status === 'Draft'
          );
          
          console.log('Active campaigns loaded:', activeCampaigns.length);
          
          if (!isMounted || !open) return;
          
          setCampaigns(activeCampaigns);
          
          // Auto-select the first active campaign if available and none is selected
          if (activeCampaigns.length > 0 && !selectedCampaign) {
            setSelectedCampaign(activeCampaigns[0]._id);
            console.log('Auto-selected campaign:', activeCampaigns[0].name);
          } else if (activeCampaigns.length === 0) {
            console.log('No active campaigns found, creating default campaign...');
            await createDefaultCampaign();
          }
        } catch (error: any) {
          if (!isMounted || !open) return;

          console.error('Error loading campaigns:', error);
          toast({
            title: "Error Loading Campaigns",
            description: error.message || "Failed to load campaigns. Creating a default campaign.",
            variant: "destructive",
          });
          
          // Try to create a default campaign on error
          try {
            await createDefaultCampaign();
          } catch (createError) {
            console.error('Failed to create default campaign:', createError);
          }
        } finally {
          if (isMounted && open) {
            setIsLoadingCampaigns(false);
          }
        }
      }, 200); // 200ms delay to prevent rapid calls
    };

    const checkConfig = async () => {
      if (!open) return;
      
      try {
        const status = await checkTelephonyConfiguration();
        if (isMounted && open) {
          setConfigStatus(status);
        }
        
        // Fetch system configuration for defaultSystemPrompt
        const configResponse = await api.get('/configuration');
        if (isMounted && open) {
          setSystemConfig(configResponse.data);
        }
      } catch (error) {
        console.error('Error loading system configuration:', error);
      }
    };
    
    if (open) {
      checkConfig();
      loadCampaigns();
    }
    
    return () => {
      isMounted = false;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [open, selectedCampaign, toast]);

  // Cleanup function to reset state when component unmounts or closes
  useEffect(() => {
    if (!open) {
      const resetTimeout = setTimeout(() => {
        setCampaigns([]);
        setSelectedCampaign('');
        setCallStatus('idle');
        setNotes('');
        setSelectedLanguage(lead.languagePreference || 'English');
        setIsLoadingCampaigns(false);
        setIsCallingInProgress(false);
        setConfigStatus(null);
        setSystemConfig(null);
      }, 100);

      return () => clearTimeout(resetTimeout);
    }
  }, [open, lead.languagePreference]);

  // Create a default campaign if none exist
  const createDefaultCampaign = async () => {
    try {
      const defaultCampaign = {
        name: 'Default Campaign',
        description: 'Auto-generated campaign for lead calls',
        status: 'Active',
        goal: 'Lead outreach and qualification',
        targetAudience: 'All leads',
        leadSources: ['Manual Entry'],
        primaryLanguage: 'English',
        supportedLanguages: ['English'],
        startDate: new Date().toISOString(),
        script: {
          versions: [{
            name: 'Default Script',
            content: "",
            isActive: true
          }]
        },
        callTiming: {
          daysOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          startTime: '09:00',
          endTime: '17:00',
          timeZone: 'Asia/Kolkata'
        },
        llmConfiguration: {
          model: 'gpt-4o',
          systemPrompt: 'You are an AI assistant making a call on behalf of a company. Be professional, friendly, and helpful.',
          temperature: 0.7,
          maxTokens: 500
        },
        voiceConfiguration: {
          provider: 'elevenlabs',
          voiceId: '',
          speed: 1.0,
          pitch: 1.0
        }
      };

      const response = await api.post('/campaigns', defaultCampaign);
      const newCampaign = response.data;
      
      setCampaigns([newCampaign]);
      setSelectedCampaign(newCampaign._id);
      
      toast({
        title: "Default Campaign Created",
        description: "A default campaign has been created for your calls.",
      });
    } catch (error) {
      console.error('Error creating default campaign:', error);
      toast({
        title: "Campaign Creation Failed",
        description: "Failed to create a default campaign. Please create a campaign manually.",
        variant: "destructive",
      });
    }
  };

  // Initiate call
  const handleInitiateCall = async () => {
    // Check if telephony services are properly configured
    if (!configStatus?.telephonyConfigured) {
      toast({
        title: "Configuration Required",
        description: "Telephony services are not properly configured. Please check your Twilio settings in Configuration.",
        variant: "destructive",
      });
      return;
    }

    // Check if a campaign is selected
    if (!selectedCampaign) {
      toast({
        title: "Campaign Required",
        description: "Please select a campaign before initiating the call.",
        variant: "destructive",
      });
      return;
    }

    // Use the leadId from either property
    const leadId = lead.id || lead._id;
    
    if (!leadId) {
      toast({
        title: "Lead ID Missing",
        description: "The lead ID is missing. Please refresh and try again.",
        variant: "destructive",
      });
      return;
    }
    
    console.log('Debug verifyIds - sending data:', { leadId, campaignId: selectedCampaign });

    // First, try to create a test call to diagnose any issues
    try {
      // Import debugApi only when needed to avoid unused import warnings
      const { debugApi } = await import('../../services/debugApi');
      
      const testResult = await debugApi.testCallCreation({
        leadId,
        campaignId: selectedCampaign
      });
      
      console.log('Test call creation result:', testResult);
      
      if (!testResult.success) {
        toast({
          title: "Call Test Failed",
          description: testResult.message || "Failed to create a test call. There may be an issue with the call service.",
          variant: "destructive",
        });
        return;
      }
    } catch (error) {
      console.error('Error testing call creation:', error);
      // Continue with the actual call attempt even if test fails
    }
    
    setIsCallingInProgress(true);
    setCallStatus('connecting');
    
    try {
      // Use the real API to initiate the call
      const callData = {
        leadId: leadId,
        campaignId: selectedCampaign,
        // Add any additional parameters like language preference
        notes: notes || `Language preference: ${selectedLanguage}`
      };

      // Add debugging log to see what we're sending
      console.log('Initiating call with data:', callData, 'Lead:', lead);

      await callsApi.initiateCall(callData);
      
      // Simulate call connection after a delay (in real scenario, this would be based on actual call status)
      setTimeout(() => {
        setCallStatus('connected');
        
        // Simulate call completion after a delay (in real scenario, this would be updated via webhook or polling)
        setTimeout(() => {
          setCallStatus('completed');
          setIsCallingInProgress(false);
          
          toast({
            title: "Call Completed",
            description: "Call has been completed successfully.",
          });
        }, 5000);
      }, 3000);
    } catch (error) {
      console.error('Error initiating call:', error);
      setCallStatus('failed');
      setIsCallingInProgress(false);
      
      toast({
        title: "Call Failed",
        description: error instanceof Error ? error.message : "Failed to connect the call. Please try again.",
        variant: "destructive",
      });
    }
  };

  // End call
  const handleEndCall = () => {
    setCallStatus('completed');
    setIsCallingInProgress(false);
    
    toast({
      title: "Call Ended",
      description: "Call has been ended by user.",
    });
  };

  // Save call notes and close
  const handleSaveAndClose = async () => {
    try {
      // Save call notes if they exist
      if (notes.trim()) {
        // In a real implementation, this would save the call notes to the API
        // For now, we'll just show a success message
        toast({
          title: "Notes Saved",
          description: "Call notes have been saved successfully.",
        });
      }
      
      onSuccess();
      
      // Use the same careful unmounting approach as the Cancel button
      setCallStatus('idle');
      setNotes('');
      
      // Slight delay to allow React to clean up properly
      setTimeout(() => {
        setSelectedCampaign('');
        setCampaigns([]);
        setSelectedLanguage(lead.languagePreference || 'English');
        setIsLoadingCampaigns(false);
        onOpenChange(false);
      }, 100);
    } catch (error) {
      console.error('Error saving call notes:', error);
      toast({
        title: "Save Failed",
        description: "Failed to save call notes. Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Sheet 
      open={open} 
      onOpenChange={(newOpen) => {
        // Prevent closing if call is in progress
        if (isCallingInProgress && newOpen === false) {
          toast({
            title: "Call in Progress",
            description: "Please end the call before closing this window.",
            variant: "destructive",
          });
          return;
        }
        
        // If closing, ensure proper cleanup order
        if (newOpen === false) {
          // First reset UI states
          setCallStatus('idle');
          setNotes('');
          
          // Use a short delay to let React handle unmounting gracefully
          setTimeout(() => {
            // Close sheet first
            onOpenChange(false);
            
            // Then reset data states with another delay
            setTimeout(() => {
              setSelectedCampaign('');
              setCampaigns([]);
              setSelectedLanguage(lead.languagePreference || 'English');
              setIsLoadingCampaigns(false);
            }, 100);
          }, 100);
        } else {
          onOpenChange(newOpen);
        }
      }}
    >
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Call Lead</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Lead Info */}
          <Card className="p-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{lead.name}</h3>
                <span className="text-sm text-muted-foreground">{lead.company}</span>
              </div>
              <p className="text-sm font-medium">
                {lead.phoneNumber}
              </p>
              <p className="text-sm text-muted-foreground">
                Preferred Language: {lead.languagePreference || 'English'}
              </p>
            </div>
          </Card>

          {/* Campaign Selection */}
          <div className="space-y-2">
            <Label htmlFor="campaign">Campaign</Label>
            {isLoadingCampaigns ? (
              <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                <LoadingSpinner size="sm" text="Loading campaigns..." />
              </div>
            ) : (
              <ErrorBoundary>
                <Select 
                  value={selectedCampaign} 
                  onValueChange={setSelectedCampaign}
                  disabled={isLoadingCampaigns || campaigns.length === 0}
                  // Adding a unique key helps React handle proper unmounting of the select
                  key={`campaign-select-${open ? 'open' : 'closed'}`}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select campaign" />
                  </SelectTrigger>
                  <SelectContent>
                    {campaigns.map((campaign) => (
                      <SelectItem key={campaign._id} value={campaign._id}>
                        {campaign.name} ({campaign.status})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </ErrorBoundary>
            )}
          </div>

          {/* Language Selection */}
          <div className="space-y-2">
            <Label htmlFor="language">Call Language</Label>
            <ErrorBoundary>
              <Select 
                value={selectedLanguage} 
                onValueChange={setSelectedLanguage}
                // Adding a unique key helps React handle proper unmounting of the select
                key={`language-select-${open ? 'open' : 'closed'}`}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select language" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem key="english" value="English">English</SelectItem>
                  <SelectItem key="spanish" value="Spanish">Spanish</SelectItem>
                  <SelectItem key="french" value="French">French</SelectItem>
                  <SelectItem key="german" value="German">German</SelectItem>
                  <SelectItem key="italian" value="Italian">Italian</SelectItem>
                  <SelectItem key="portuguese" value="Portuguese">Portuguese</SelectItem>
                  <SelectItem key="arabic" value="Arabic">Arabic</SelectItem>
                  <SelectItem key="hindi" value="Hindi">Hindi</SelectItem>
                  <SelectItem key="mandarin" value="Mandarin">Mandarin</SelectItem>
                  <SelectItem key="japanese" value="Japanese">Japanese</SelectItem>
                  <SelectItem key="korean" value="Korean">Korean</SelectItem>
                  <SelectItem key="russian" value="Russian">Russian</SelectItem>
                </SelectContent>
              </Select>
            </ErrorBoundary>
          </div>

          {/* Call Status */}
          <div className="space-y-4">
            <div className="flex justify-center">
              {callStatus === 'idle' ? (
                <div className="space-y-3 text-center">
                  <Button 
                    onClick={handleInitiateCall} 
                    className="bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90 rounded-full shadow-md transition-all duration-300 transform hover:scale-105 h-12 w-12 p-0"
                    disabled={!configStatus?.telephonyConfigured || !selectedCampaign || isLoadingCampaigns}
                  >
                    <Phone className="h-5 w-5" />
                  </Button>
                  {configStatus && !configStatus.telephonyConfigured && (
                    <p className="text-sm text-muted-foreground">
                      Telephony services not configured
                    </p>
                  )}
                  {configStatus?.telephonyConfigured && !selectedCampaign && !isLoadingCampaigns && (
                    <p className="text-sm text-muted-foreground">
                      Please select a campaign to start the call
                    </p>
                  )}
                </div>
              ) : configStatus?.telephonyConfigured && callStatus === 'connecting' ? (
                <div className="text-center space-y-2">
                  <div className="animate-pulse flex items-center justify-center h-12 w-12 rounded-full bg-amber-100 text-amber-800 mx-auto">
                    <Phone className="h-6 w-6" />
                  </div>
                  <p>Connecting call...</p>
                </div>
              ) : configStatus?.telephonyConfigured && callStatus === 'connected' ? (
                <div className="space-y-3 text-center">
                  <p>Call in progress</p>
                  <div className="flex items-center justify-center gap-4">
                    <div className="flex items-center justify-center h-12 w-12 rounded-full bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200">
                      <Phone className="h-6 w-6" />
                    </div>
                    <Button 
                      onClick={handleEndCall} 
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-full shadow-md transition-all duration-300 transform hover:scale-105 h-12 w-12 p-0"
                    >
                      <Phone className="h-5 w-5 rotate-[135deg]" />
                    </Button>
                  </div>
                </div>
              ) : configStatus?.telephonyConfigured && callStatus === 'completed' ? (
                <div className="text-center space-y-2">
                  <div className="flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 text-blue-800 mx-auto">
                    <Phone className="h-6 w-6" />
                  </div>
                  <p>Call completed</p>
                </div>
              ) : configStatus?.telephonyConfigured && callStatus === 'failed' ? (
                <div className="text-center space-y-2">
                  <div className="flex items-center justify-center h-12 w-12 rounded-full bg-red-100 text-red-800 mx-auto">
                    <Phone className="h-6 w-6" />
                  </div>
                  <p>Call failed</p>
                  <Button 
                    onClick={handleInitiateCall} 
                    className="bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90 rounded-full shadow-md transition-all duration-300 transform hover:scale-105 h-12 w-12 p-0"
                  >
                    <Phone className="h-5 w-5" />
                  </Button>
                </div>
              ) : (
                <div className="text-center space-y-3">
                  <Button 
                    onClick={handleInitiateCall} 
                    className="bg-primary text-primary-foreground hover:bg-primary/90 dark:bg-primary dark:text-primary-foreground dark:hover:bg-primary/90 rounded-full shadow-md transition-all duration-300 transform hover:scale-105 h-12 w-12 p-0"
                    disabled={!configStatus?.telephonyConfigured || !selectedCampaign || isLoadingCampaigns}
                  >
                    <Phone className="h-5 w-5" />
                  </Button>
                  {configStatus && !configStatus.telephonyConfigured && (
                    <p className="text-sm text-muted-foreground">
                      Telephony services not configured
                    </p>
                  )}
                  {configStatus?.telephonyConfigured && !selectedCampaign && !isLoadingCampaigns && (
                    <p className="text-sm text-muted-foreground">
                      Please select a campaign to start the call
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Call Notes */}
          {configStatus?.telephonyConfigured && (callStatus === 'connected' || callStatus === 'completed') && (
            <div className="space-y-2">
              <Label htmlFor="notes">Call Notes</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add notes about this call..."
                rows={4}
              />
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-row gap-2 flex-wrap justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                // First reset UI-related state
                setCallStatus('idle');
                setNotes('');
                
                // Force close with a slight delay to avoid React DOM errors
                setTimeout(() => {
                  // Reset state that affects select components
                  setSelectedCampaign('');
                  setCampaigns([]);
                  setSelectedLanguage(lead.languagePreference || 'English');
                  setIsLoadingCampaigns(false);
                  
                  // Finally close the sheet
                  onOpenChange(false);
                }, 100);
              }}
              disabled={isCallingInProgress}
            >
              Cancel
            </Button>
            
            {configStatus?.telephonyConfigured && callStatus === 'completed' && (
              <Button onClick={handleSaveAndClose} size="sm">
                Save & Close
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default CallLeadSheet;

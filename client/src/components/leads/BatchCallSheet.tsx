import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PhoneCall, AlertCircle, Loader2 } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { Button } from "../ui/button";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { useToast } from "@/hooks/useToast";
import { campaignsApi } from "../../services/campaignsApi";
import { batchCallsApi } from "../../services/batchCallsApi";

interface BatchCallSheetProps {
  isOpen: boolean;
  onClose: () => void;
  selectedLeadIds: string[];
  onSuccess?: () => void;
}

const BatchCallSheet = ({
  isOpen,
  onClose,
  selectedLeadIds,
  onSuccess,
}: BatchCallSheetProps) => {
  const { toast } = useToast();
  const [selectedCampaignId, setSelectedCampaignId] = useState<string>("");
  const [isInitiating, setIsInitiating] = useState(false);

  // Reset state when sheet closes
  const handleClose = () => {
    setSelectedCampaignId("");
    setIsInitiating(false);
    onClose();
  };

  // Fetch campaigns
  const {
    data: campaignsData,
    isLoading: isLoadingCampaigns,
    error: campaignsError,
  } = useQuery({
    queryKey: ["campaigns"],
    queryFn: async () => {
      try {
        const result = await campaignsApi.getCampaigns();
        return result;
      } catch (error) {
        console.error("Error fetching campaigns:", error);
        return { campaigns: [] };
      }
    },
    enabled: isOpen,
  });

  // Handle campaign selection
  const handleCampaignChange = (value: string) => {
    if (value && value !== "none") {
      setSelectedCampaignId(value);
    }
  };

  const handleInitiateBatchCall = async () => {
    if (!selectedCampaignId) {
      toast({
        title: "Campaign Required",
        description: "Please select a campaign to use for batch calling.",
        variant: "destructive",
      });
      return;
    }

    setIsInitiating(true);

    try {
      const campaignName = campaignsData?.campaigns?.find((c: any) => (c.id || c._id) === selectedCampaignId)?.name || 'Unknown';
      
      const response = await batchCallsApi.createBatch({
        campaignId: selectedCampaignId,
        leadIds: selectedLeadIds,
        name: `Batch: ${campaignName} (${new Date().toLocaleDateString()})`,
        config: {
          maxConcurrency: 10,
          delayBetweenCalls: 1000
        }
      });

      if (response.success) {
        toast({
          title: "Batch Call Initiated",
          description: `Successfully queued ${selectedLeadIds.length} calls for the "${campaignName}" campaign.`,
        });
        onSuccess?.();
        handleClose();
      } else {
        throw new Error(response.error || 'Failed to start batch call');
      }
    } catch (error: any) {
      console.error("Error initiating batch call:", error);
      toast({
        title: "Batch Call Failed",
        description: error.message || "An error occurred while initiating batch calls. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsInitiating(false);
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={handleClose}>
      <SheetContent className="sm:max-w-[500px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5" />
            Batch Call - {selectedLeadIds.length} Leads
          </SheetTitle>
          <SheetDescription>
            Select a campaign to use for calling the selected leads. Calls will
            be queued and processed based on your concurrent call limit.
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 py-6">
          {/* Campaign Selection */}
          <div className="space-y-2">
            <Label htmlFor="campaign">Campaign *</Label>
            {isLoadingCampaigns ? (
              <div className="flex items-center gap-2 p-3 border rounded-md">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">
                  Loading campaigns...
                </span>
              </div>
            ) : (
              <Select
                value={selectedCampaignId}
                onValueChange={handleCampaignChange}
              >
                <SelectTrigger id="campaign">
                  <SelectValue placeholder="Select a campaign" />
                </SelectTrigger>
                <SelectContent>
                  {(campaignsData?.campaigns?.length ?? 0) > 0 ? (
                    campaignsData?.campaigns?.map((campaign: any) => {
                      // Use _id if id doesn't exist (MongoDB default)
                      const campaignId =
                        campaign.id || campaign._id || campaign.campaignId;

                      return (
                        <SelectItem key={campaignId} value={campaignId}>
                          {campaign.name}
                        </SelectItem>
                      );
                    })
                  ) : (
                    <SelectItem value="none" disabled>
                      {campaignsError
                        ? "Error loading campaigns"
                        : "No campaigns available"}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            )}
            <div className="space-y-1">
              {/* {selectedCampaignId && (
                <p className="text-xs text-green-600 dark:text-green-400">
                  ✓ Selected:{" "}
                  {campaignsData?.campaigns?.find(
                    (c: any) => c.id === selectedCampaignId
                  )?.name || selectedCampaignId}
                </p>
              )} */}
              <p className="text-xs text-muted-foreground">
                The campaign's voice configuration and script will be used for
                all calls.
              </p>
              {/* Debug info
              <p className="text-xs text-orange-600 dark:text-orange-400">
                Debug: selectedCampaignId = &quot;
                {selectedCampaignId || "empty"}&quot; | Campaigns loaded:{" "}
                {campaignsData?.campaigns?.length ?? 0}
              </p> */}
            </div>
          </div>

          {/* Info Box */}
          <div className="p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <div className="flex gap-3">
              <AlertCircle className="h-5 w-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="space-y-2 text-sm">
                <p className="font-medium text-blue-900 dark:text-blue-100">
                  Batch Calling Information
                </p>
                <ul className="space-y-1 text-blue-800 dark:text-blue-200">
                  <li>• Calls will be queued and processed automatically</li>
                  <li>• Maximum concurrent calls: 50 (configurable)</li>
                  <li>• Failed calls will be retried automatically</li>
                  <li>• You can monitor progress in the Calls page</li>
                </ul>
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="space-y-2 p-4 bg-muted rounded-lg">
            <h4 className="font-medium text-sm">Summary</h4>
            <div className="space-y-1 text-sm text-muted-foreground">
              <p>
                Selected Leads:{" "}
                <span className="font-medium text-foreground">
                  {selectedLeadIds.length}
                </span>
              </p>
              <p>
                Campaign:{" "}
                <span className="font-medium text-foreground">
                  {selectedCampaignId
                    ? campaignsData?.campaigns?.find(
                        (c: any) => c.id === selectedCampaignId
                      )?.name || "Unknown"
                    : "Not selected"}
                </span>
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 pt-4 border-t">
          <Button
            variant="outline"
            onClick={handleClose}
            className="flex-1"
            disabled={isInitiating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleInitiateBatchCall}
            className="flex-1"
            disabled={!selectedCampaignId || isInitiating}
            title={
              !selectedCampaignId
                ? "Please select a campaign first"
                : "Start batch calling"
            }
          >
            {isInitiating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Initiating...
              </>
            ) : (
              <>
                <PhoneCall className="h-4 w-4 mr-2" />
                Start Batch Call
              </>
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
};

export default BatchCallSheet;

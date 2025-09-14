import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { 
  Search, 
  Plus, 
  Download, 
  Upload, 
  Filter, 
  MoreHorizontal, 
  ChevronDown, 
  Trash2, 
  Edit, 
  Phone, 
  AlertTriangle
} from 'lucide-react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { useToast } from '@/hooks/useToast';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Skeleton } from "@/components/ui/skeleton";

// Import lead-related components
import LeadForm from '../components/leads/LeadForm';
import DeleteLeadDialog from '../components/leads/DeleteLeadDialog';
import CallLeadSheet from '../components/leads/CallLeadSheet';
import ErrorBoundary from '../components/common/ErrorBoundary';

// Import lead API service
import { leadsApi } from '../services/leadsApi';

// Type definitions
interface Lead {
  id: string;
  name: string;
  company: string;
  phoneNumber: string;
  source: string;
  status: string;
  createdAt: string;
  lastContacted?: string;
  languagePreference: string;
  email?: string;
}

const Leads = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('All');
  const [sourceFilter, setSourceFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  // Import Sheet
  const [isImportSheetOpen, setIsImportSheetOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  
  // Lead form state
  const [isLeadFormOpen, setIsLeadFormOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | undefined>(undefined);

  // Delete dialog state
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [leadToDelete, setLeadToDelete] = useState<{ id: string; name: string } | null>(null);

  // Call sheet state
  const [isCallSheetOpen, setIsCallSheetOpen] = useState(false);
  const [leadToCall, setLeadToCall] = useState<Lead | null>(null);

  // Fetch leads data
  const { data: leadsData, isLoading, error, refetch } = useQuery({
    queryKey: ['leads', statusFilter, sourceFilter, currentPage, itemsPerPage, searchTerm],
    queryFn: async () => {
      try {
        // Use the leads API service
        return await leadsApi.getLeads({
          page: currentPage,
          limit: itemsPerPage,
          status: statusFilter !== 'All' ? statusFilter : undefined,
          source: sourceFilter !== 'All' ? sourceFilter : undefined,
          search: searchTerm || undefined
        });
      } catch (error) {
        console.error('Error fetching leads:', error);
        // Return empty data for new installations
        return { leads: [], pagination: { page: 1, pages: 0, total: 0, limit: itemsPerPage } };
      }
    },
  });

  // Handle export leads
  const handleExportLeads = async (format: 'csv' | 'json' | 'xlsx') => {
    try {
      toast({
        title: "Exporting Leads",
        description: `Exporting leads as ${format.toUpperCase()}...`,
      });

      // Get the exported file blob
      const blob = await leadsApi.exportLeads({
        format,
        status: statusFilter !== 'All' ? statusFilter : undefined,
        source: sourceFilter !== 'All' ? sourceFilter : undefined
      });

      // Create a URL for the blob
      const url = window.URL.createObjectURL(blob);
      
      // Create a temporary link element
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `leads-export-${new Date().toISOString().slice(0, 10)}.${format}`);
      
      // Append to the document, click it, and remove it
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      // Clean up the URL
      window.URL.revokeObjectURL(url);
      
      toast({
        title: "Export Successful",
        description: `Leads exported successfully as ${format.toUpperCase()}.`,
      });
    } catch (error) {
      console.error('Error exporting leads:', error);
      toast({
        title: "Export Failed",
        description: "An error occurred while exporting leads.",
        variant: "destructive",
      });
    }
  };

  // Handle add lead
  const handleAddLeadClick = () => {
    setSelectedLeadId(undefined);
    setIsLeadFormOpen(true);
  };

  // Handle edit lead
  const handleEditLead = (leadId: string) => {
    setSelectedLeadId(leadId);
    setIsLeadFormOpen(true);
  };

  // Handle delete lead
  const handleDeleteLead = (leadId: string) => {
    // Find the lead to get its name
    const lead = leadsData?.leads.find((lead: Lead) => lead.id === leadId);
    if (lead) {
      setLeadToDelete({ id: leadId, name: lead.name });
      setIsDeleteDialogOpen(true);
    }
  };

  // Handle call lead
  const handleCallLead = (leadId: string) => {
    // Find the lead to get its details
    const lead = leadsData?.leads.find((lead: Lead) => lead.id === leadId);
    if (lead) {
      console.log('Setting lead to call:', lead);
      setLeadToCall(lead);
      setIsCallSheetOpen(true);
    }
  };

  // Handle import file change
  const handleImportFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setImportFile(file);
  };

  // Handle import submit
  const handleImportSubmit = async () => {
    if (!importFile) return;

    setIsImporting(true);

    try {
      // Use the leads API service to import leads
      const result = await leadsApi.importLeadsFromCSV(importFile);
      
      toast({
        title: "Import Successful",
        description: `${result.count || 'Multiple'} leads imported successfully.`,
      });

      // Refetch leads data
      refetch();
      
      // Close the sheet and reset state
      setIsImportSheetOpen(false);
      setImportFile(null);
    } catch (error) {
      console.error('Error importing leads:', error);
      toast({
        title: "Import Failed",
        description: "An error occurred while importing leads. Please check your file format and try again.",
        variant: "destructive",
      });
    } finally {
      setIsImporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <Skeleton className="h-8 w-48 mb-2" />
          <div className="flex gap-2">
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-10 w-32" />
          </div>
        </div>
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  {[...Array(7)].map((_, i) => (
                    <th key={i} className="p-4">
                      <Skeleton className="h-4 w-24" />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...Array(8)].map((_, rowIdx) => (
                  <tr key={rowIdx} className="border-b">
                    {[...Array(7)].map((_, colIdx) => (
                      <td key={colIdx} className="p-4">
                        <Skeleton className="h-4 w-full" />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Lead Management</h1>
        <Card className="p-8 text-center">
          <AlertTriangle className="h-12 w-12 text-destructive mx-auto" />
          <p className="mt-4 text-lg">Failed to load leads</p>
          <p className="text-muted-foreground mb-4">
            If this is a new installation, you may not have any leads yet. Try adding your first lead.
          </p>
          <div className="flex gap-2 justify-center">
            <Button
              onClick={() => refetch()}
              variant="outline"
              size="sm"
            >
              Retry
            </Button>
            <Button onClick={handleAddLeadClick} size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Add Lead
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl sm:text-3xl font-bold">Lead Management</h1>
        <div className="flex flex-row gap-2 flex-wrap">
          <Button onClick={() => setIsImportSheetOpen(true)} variant="outline" size="sm">
            <Upload className="h-4 w-4 mr-2" />
            Import
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExportLeads('csv')}>
                Export as CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportLeads('xlsx')}>
                Export as Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportLeads('json')}>
                Export as JSON
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={handleAddLeadClick} size="sm">
            <Plus className="h-4 w-4 mr-2" />
            Add Lead
          </Button>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col gap-4 sm:flex-row">
        <div className="relative flex-grow">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search leads..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        
        <div className="flex flex-row gap-2 flex-wrap">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="flex items-center gap-1">
                <Filter className="h-4 w-4" />
                <span className="truncate">Status: {statusFilter}</span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setStatusFilter('All')}>All</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('New')}>New</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('Contacted')}>Contacted</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('Qualified')}>Qualified</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('Not Interested')}>Not Interested</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('Converted')}>Converted</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setStatusFilter('Scheduled Callback')}>Scheduled Callback</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="flex items-center gap-1">
                <Filter className="h-4 w-4" />
                <span className="truncate">Source: {sourceFilter}</span>
                <ChevronDown className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuItem onClick={() => setSourceFilter('All')}>All</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSourceFilter('Website')}>Website</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSourceFilter('Referral')}>Referral</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSourceFilter('Event')}>Event</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSourceFilter('LinkedIn')}>LinkedIn</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSourceFilter('Cold Outreach')}>Cold Outreach</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Leads Table - Desktop */}
      <Card className="hidden lg:block">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b">
                <th className="p-4 text-left font-medium">Name</th>
                <th className="p-4 text-left font-medium">Phone</th>
                <th className="p-4 text-left font-medium">Source</th>
                <th className="p-4 text-left font-medium">Status</th>
                <th className="p-4 text-left font-medium">Last Contacted</th>
                <th className="p-4 text-left font-medium">Language</th>
                <th className="p-4 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {(leadsData?.leads || []).length > 0 ? (
                (leadsData?.leads || []).map((lead: Lead) => (
                  <tr key={lead.id} className="border-b hover:bg-muted/50">
                    <td className="p-4">
                      <div>
                        <p className="font-medium">{lead.name}</p>
                        <p className="text-sm text-muted-foreground">{lead.company}</p>
                      </div>
                    </td>
                    <td className="p-4">{lead.phoneNumber}</td>
                    <td className="p-4">{lead.source}</td>
                    <td className="p-4">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        lead.status === 'New' 
                          ? 'bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100' 
                          : lead.status === 'Contacted'
                          ? 'bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-100'
                          : lead.status === 'Qualified'
                          ? 'bg-amber-100 text-amber-800 dark:bg-amber-800 dark:text-amber-100'
                          : lead.status === 'Not Interested'
                          ? 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100'
                          : lead.status === 'Converted'
                          ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100'
                          : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'
                      }`}>
                        {lead.status}
                      </span>
                    </td>
                    <td className="p-4">
                      {lead.lastContacted 
                        ? new Date(lead.lastContacted).toLocaleDateString() 
                        : 'Never'}
                    </td>
                    <td className="p-4">{lead.languagePreference}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleCallLead(lead.id)}
                          title="Call"
                        >
                          <Phone className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleEditLead(lead.id)}
                          title="Edit"
                        >
                          <Edit className="h-4 w-4" />
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => handleEditLead(lead.id)}>
                              <Edit className="h-4 w-4 mr-2" />
                              Edit Lead
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleCallLead(lead.id)}>
                              <Phone className="h-4 w-4 mr-2" />
                              Call Lead
                            </DropdownMenuItem>
                            <DropdownMenuItem 
                              onClick={() => handleDeleteLead(lead.id)}
                              className="text-destructive focus:text-destructive"
                            >
                              <Trash2 className="h-4 w-4 mr-2" />
                              Delete Lead
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    No leads found. Add your first lead to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Leads Cards - Mobile/Tablet */}
      <div className="lg:hidden space-y-4">
        {(leadsData?.leads || []).length > 0 ? (
          (leadsData?.leads || []).map((lead: Lead) => (
            <Card key={lead.id} className="p-4">
              <div className="flex flex-col space-y-3">
                <div className="flex items-start justify-between">
                  <div className="min-w-0 flex-1">
                    <h3 className="font-semibold text-base truncate">{lead.name}</h3>
                    {lead.company && (
                      <p className="text-sm text-muted-foreground truncate">{lead.company}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleCallLead(lead.id)}
                      title="Call"
                    >
                      <Phone className="h-4 w-4" />
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="sm">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => handleEditLead(lead.id)}>
                          <Edit className="h-4 w-4 mr-2" />
                          Edit Lead
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleCallLead(lead.id)}>
                          <Phone className="h-4 w-4 mr-2" />
                          Call Lead
                        </DropdownMenuItem>
                        <DropdownMenuItem 
                          onClick={() => handleDeleteLead(lead.id)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="h-4 w-4 mr-2" />
                          Delete Lead
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Phone:</span>
                    <p className="font-medium truncate">{lead.phoneNumber}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Source:</span>
                    <p className="font-medium truncate">{lead.source}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Status:</span>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${
                      lead.status === 'New' 
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-800 dark:text-blue-100' 
                        : lead.status === 'Contacted'
                        ? 'bg-purple-100 text-purple-800 dark:bg-purple-800 dark:text-purple-100'
                        : lead.status === 'Qualified'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-800 dark:text-amber-100'
                        : lead.status === 'Not Interested'
                        ? 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100'
                        : lead.status === 'Converted'
                        ? 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100'
                        : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'
                    }`}>
                      {lead.status}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Language:</span>
                    <p className="font-medium truncate">{lead.languagePreference}</p>
                  </div>
                </div>
                
                <div className="pt-2 border-t">
                  <span className="text-xs text-muted-foreground">
                    Last contacted: {lead.lastContacted 
                      ? new Date(lead.lastContacted).toLocaleDateString() 
                      : 'Never'}
                  </span>
                </div>
              </div>
            </Card>
          ))
        ) : (
          <Card className="p-8 text-center">
            <p className="text-muted-foreground">
              No leads found. Add your first lead to get started.
            </p>
          </Card>
        )}
      </div>

      {/* Pagination */}
      {leadsData && leadsData.pagination && (
        <div className="flex flex-col items-center justify-center gap-4 p-4 border rounded-xl bg-card">
          <p className="text-sm text-muted-foreground text-center">
            Showing {((leadsData.pagination.page - 1) * leadsData.pagination.limit) + 1} to {Math.min(leadsData.pagination.page * leadsData.pagination.limit, leadsData.pagination.total)} of {leadsData.pagination.total} leads
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className="px-3"
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, leadsData.pagination.pages))}
              disabled={currentPage === leadsData.pagination.pages}
              className="px-3"
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {/* Import Sheet */}
      <Sheet open={isImportSheetOpen} onOpenChange={setIsImportSheetOpen}>
        <SheetContent className="w-full sm:max-w-md lg:max-w-lg p-0">
          <div className="flex flex-col h-full">
            <div className="px-4 sm:px-6 py-4 border-b">
              <SheetHeader>
                <SheetTitle>Import Leads</SheetTitle>
                <SheetDescription>
                  Upload a CSV or Excel file to import leads. Ensure the file has columns for name, phone number, email, etc.
                </SheetDescription>
              </SheetHeader>
            </div>

            <div className="flex-1 px-4 sm:px-6 py-4 sm:py-6">
              <div className="space-y-4">
                <div>
                  <Label htmlFor="file-upload" className="text-sm font-medium">
                    File <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="file-upload"
                    type="file"
                    accept=".csv, .xlsx, .xls"
                    onChange={handleImportFileChange}
                    className="mt-2"
                  />
                  {importFile && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Selected: {importFile.name}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="px-4 sm:px-6 py-4 border-t">
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsImportSheetOpen(false)}
                  disabled={isImporting}
                  size="sm"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleImportSubmit}
                  disabled={isImporting || !importFile}
                  size="sm"
                >
                  {isImporting ? 'Importing...' : 'Import'}
                </Button>
              </div>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Lead Form (Add/Edit) */}
      <LeadForm
        open={isLeadFormOpen}
        onOpenChange={setIsLeadFormOpen}
        leadId={selectedLeadId}
        title={selectedLeadId ? 'Edit Lead' : 'Add New Lead'}
        onSuccess={() => {
          // Invalidate and refetch leads
          queryClient.invalidateQueries({ queryKey: ['leads'] });
        }}
      />

      {/* Delete Lead Dialog */}
      {leadToDelete && (
        <DeleteLeadDialog
          open={isDeleteDialogOpen}
          onOpenChange={setIsDeleteDialogOpen}
          leadId={leadToDelete.id}
          leadName={leadToDelete.name}
          onSuccess={() => {
            // Invalidate and refetch leads
            queryClient.invalidateQueries({ queryKey: ['leads'] });
          }}
        />
      )}

      {/* Call Lead Sheet */}
      {leadToCall && (
        <ErrorBoundary>
          <CallLeadSheet
            open={isCallSheetOpen}
            onOpenChange={setIsCallSheetOpen}
            lead={leadToCall}
            onSuccess={() => {
              // Invalidate and refetch leads
              queryClient.invalidateQueries({ queryKey: ['leads'] });
            }}
          />
        </ErrorBoundary>
      )}
    </div>
  );
};

export default Leads;

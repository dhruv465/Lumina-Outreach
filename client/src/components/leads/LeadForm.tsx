import { useState, useEffect } from 'react';
import { Button } from '../ui/button';
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetFooter 
} from '../ui/sheet';
import { Label } from '../ui/label';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '../ui/select';
import { useToast } from '@/hooks/useToast';
import { leadsApi } from '../../services/leadsApi';

// Lead form props interface
interface LeadFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  leadId?: string;
  title?: string;
}

// Lead data interface
interface LeadFormData {
  name: string;
  company: string;
  phoneNumber: string;
  email: string;
  source: string;
  status: string;
  languagePreference: string;
  notes: string;
}

// Default form values
const defaultFormData: LeadFormData = {
  name: '',
  company: '',
  phoneNumber: '',
  email: '',
  source: 'Website',
  status: 'New',
  languagePreference: 'English',
  notes: ''
};

// Source options
const sourceOptions = [
  'Website',
  'Referral',
  'Event',
  'LinkedIn',
  'Cold Outreach',
  'Other'
];

// Status options
const statusOptions = [
  'New',
  'Contacted',
  'Qualified',
  'Not Interested',
  'Converted',
  'Scheduled Callback'
];

// Language options
const languageOptions = [
  'English',
  'Spanish',
  'French',
  'German',
  'Italian',
  'Portuguese',
  'Arabic',
  'Hindi',
  'Mandarin',
  'Japanese',
  'Korean',
  'Russian',
  'Other'
];

const LeadForm = ({ 
  open, 
  onOpenChange, 
  onSuccess, 
  leadId,
  title = 'Add New Lead'
}: LeadFormProps) => {
  const { toast } = useToast();
  const [formData, setFormData] = useState<LeadFormData>(defaultFormData);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const isEditMode = !!leadId;

  // Fetch lead data if in edit mode
  useEffect(() => {
    const fetchLead = async () => {
      if (leadId && open) {
        setIsLoading(true);
        try {
          const lead = await leadsApi.getLeadById(leadId);
          setFormData({
            name: lead.name || '',
            company: lead.company || '',
            phoneNumber: lead.phoneNumber || '',
            email: lead.email || '',
            source: lead.source || 'Website',
            status: lead.status || 'New',
            languagePreference: lead.languagePreference || 'English',
            notes: lead.notes || ''
          });
        } catch (error) {
          console.error('Error fetching lead:', error);
          toast({
            title: "Error",
            description: "Failed to fetch lead data.",
            variant: "destructive",
          });
          onOpenChange(false);
        } finally {
          setIsLoading(false);
        }
      }
    };

    fetchLead();
  }, [leadId, open, toast, onOpenChange]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setFormData(defaultFormData);
      setErrors({});
    }
  }, [open]);

  // Handle input changes
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    
    // Clear error for this field if it exists
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  // Handle select changes
  const handleSelectChange = (name: string, value: string) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
    
    // Clear error for this field if it exists
    if (errors[name]) {
      setErrors((prev) => ({ ...prev, [name]: '' }));
    }
  };

  // Validate form
  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    if (!formData.name.trim()) {
      newErrors.name = 'Name is required';
    }
    
    // Basic phone number validation
    if (!formData.phoneNumber.trim()) {
      newErrors.phoneNumber = 'Phone number is required';
    } else if (!/^[+]?[(]?[0-9]{3}[)]?[-\s.]?[0-9]{3}[-\s.]?[0-9]{4,6}$/im.test(formData.phoneNumber.trim())) {
      newErrors.phoneNumber = 'Enter a valid phone number';
    }
    
    // Basic email validation if provided
    if (formData.email && !/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Enter a valid email address';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }
    
    setIsLoading(true);
    
    try {
      if (isEditMode) {
        await leadsApi.updateLead(leadId, formData);
        toast({
          title: "Success",
          description: "Lead updated successfully.",
        });
      } else {
        await leadsApi.createLead(formData);
        toast({
          title: "Success",
          description: "Lead created successfully.",
        });
      }
      
      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error saving lead:', error);
      toast({
        title: "Error",
        description: isEditMode 
          ? "Failed to update lead. Please try again."
          : "Failed to create lead. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
        </SheetHeader>
        
        <form onSubmit={handleSubmit} className="mt-6 space-y-6">
          <div className="space-y-4">
            {/* Name field */}
            <div className="space-y-2">
              <Label htmlFor="name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="Enter full name"
                disabled={isLoading}
                className={errors.name ? "border-destructive" : ""}
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name}</p>
              )}
            </div>

            {/* Company field */}
            <div className="space-y-2">
              <Label htmlFor="company">Company</Label>
              <Input
                id="company"
                name="company"
                value={formData.company}
                onChange={handleChange}
                placeholder="Enter company name"
                disabled={isLoading}
              />
            </div>

            {/* Phone number field */}
            <div className="space-y-2">
              <Label htmlFor="phoneNumber">
                Phone Number <span className="text-destructive">*</span>
              </Label>
              <Input
                id="phoneNumber"
                name="phoneNumber"
                value={formData.phoneNumber}
                onChange={handleChange}
                placeholder="Enter phone number"
                disabled={isLoading}
                className={errors.phoneNumber ? "border-destructive" : ""}
              />
              {errors.phoneNumber && (
                <p className="text-xs text-destructive">{errors.phoneNumber}</p>
              )}
            </div>

            {/* Email field */}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                placeholder="Enter email address"
                disabled={isLoading}
                className={errors.email ? "border-destructive" : ""}
              />
              {errors.email && (
                <p className="text-xs text-destructive">{errors.email}</p>
              )}
            </div>

            {/* Source field */}
            <div className="space-y-2">
              <Label htmlFor="source">Source</Label>
              <Select 
                value={formData.source} 
                onValueChange={(value) => handleSelectChange('source', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select lead source" />
                </SelectTrigger>
                <SelectContent>
                  {sourceOptions.map((source) => (
                    <SelectItem key={source} value={source}>
                      {source}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status field */}
            <div className="space-y-2">
              <Label htmlFor="status">Status</Label>
              <Select 
                value={formData.status} 
                onValueChange={(value) => handleSelectChange('status', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select lead status" />
                </SelectTrigger>
                <SelectContent>
                  {statusOptions.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Language preference field */}
            <div className="space-y-2">
              <Label htmlFor="languagePreference">Language Preference</Label>
              <Select 
                value={formData.languagePreference} 
                onValueChange={(value) => handleSelectChange('languagePreference', value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select language preference" />
                </SelectTrigger>
                <SelectContent>
                  {languageOptions.map((language) => (
                    <SelectItem key={language} value={language}>
                      {language}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Notes field */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                name="notes"
                value={formData.notes}
                onChange={handleChange}
                placeholder="Add any additional notes here"
                disabled={isLoading}
                rows={3}
              />
            </div>
          </div>
          
          <SheetFooter className="pt-4">
            <Button
              type="submit"
              disabled={isLoading}
              size="sm"
              className="w-full"
            >
              {isLoading 
                ? isEditMode ? 'Updating...' : 'Creating...'
                : isEditMode ? 'Update Lead' : 'Create Lead'
              }
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
};

export default LeadForm;

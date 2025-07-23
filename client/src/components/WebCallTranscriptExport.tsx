import React, { useState } from 'react';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui';
import { Download } from 'lucide-react';
import { toast } from 'sonner';

interface WebCallTranscriptExportProps {
  testId: string;
  disabled?: boolean;
  className?: string;
}

export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
  TXT = 'txt',
  MARKDOWN = 'md'
}

const WebCallTranscriptExport: React.FC<WebCallTranscriptExportProps> = ({
  testId,
  disabled = false,
  className = ''
}) => {
  const [format, setFormat] = useState<ExportFormat>(ExportFormat.JSON);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    if (!testId || disabled || isExporting) return;

    try {
      setIsExporting(true);
      
      // Get API URL from environment or use default
      const apiUrl = import.meta.env.VITE_API_URL || '';
      
      // Create export URL
      const exportUrl = `${apiUrl}/api/webcall/export/${testId}?format=${format}`;
      
      // Open in new tab or download directly
      window.open(exportUrl, '_blank');
      
      toast.success('Transcript export started');
    } catch (error) {
      console.error('Export error:', error);
      toast.error('Failed to export transcript');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Select
        value={format}
        onValueChange={(value) => setFormat(value as ExportFormat)}
        disabled={disabled || isExporting}
      >
        <SelectTrigger className="w-[120px]">
          <SelectValue placeholder="Format" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ExportFormat.JSON}>JSON</SelectItem>
          <SelectItem value={ExportFormat.CSV}>CSV</SelectItem>
          <SelectItem value={ExportFormat.TXT}>Text</SelectItem>
          <SelectItem value={ExportFormat.MARKDOWN}>Markdown</SelectItem>
        </SelectContent>
      </Select>
      
      <Button
        variant="outline"
        size="sm"
        onClick={handleExport}
        disabled={disabled || isExporting}
      >
        <Download className="mr-2 h-4 w-4" />
        Export
      </Button>
    </div>
  );
};

export default WebCallTranscriptExport;
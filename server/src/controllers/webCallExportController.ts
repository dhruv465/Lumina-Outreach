import { Request, Response } from 'express';
import WebCallTest from '../models/WebCallTest';
import logger from '../utils/logger';
import { EnhancedErrorHandlingService } from '../services/enhancedErrorHandling';
import mongoose from 'mongoose';

const enhancedErrorHandling = new EnhancedErrorHandlingService();

/**
 * Export formats supported for transcript export
 */
export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
  TXT = 'txt',
  MARKDOWN = 'md'
}

/**
 * Export transcript for a web call test
 * This endpoint exports the transcript of a web call test in various formats
 */
export const exportTranscript = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { testId } = req.params;
    const { format = ExportFormat.JSON } = req.query;
    
    if (!testId) {
      return res.status(400).json({ error: 'Test ID is required' });
    }
    
    // Validate format
    if (!Object.values(ExportFormat).includes(format as ExportFormat)) {
      return res.status(400).json({ 
        error: 'Invalid format', 
        supportedFormats: Object.values(ExportFormat) 
      });
    }
    
    // Get user ID from authenticated request
    const userId = (req as any).user?._id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Get the test record
    const test = await WebCallTest.findById(testId);
    
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }
    
    // Verify the user owns this test
    if (test.userId.toString() !== userId.toString() && !(req as any).user?.isAdmin) {
      return res.status(403).json({ error: 'Not authorized to access this test' });
    }
    
    // Format the transcript based on the requested format
    switch (format) {
      case ExportFormat.JSON:
        return exportAsJson(res, test);
      case ExportFormat.CSV:
        return exportAsCsv(res, test);
      case ExportFormat.TXT:
        return exportAsTxt(res, test);
      case ExportFormat.MARKDOWN:
        return exportAsMarkdown(res, test);
      default:
        return res.status(400).json({ error: 'Unsupported format' });
    }
  } catch (error) {
    logger.error(`Error exporting transcript: ${error instanceof Error ? error.message : String(error)}`);
    return res.status(500).json({ 
      error: 'Failed to export transcript',
      details: enhancedErrorHandling.generateDetailedErrorMessage(error, '', undefined)
    });
  }
};

/**
 * Export transcript as JSON
 */
const exportAsJson = (res: Response, test: any): Response => {
  const filename = `webcall_transcript_${test._id}_${formatDate(test.startTime)}.json`;
  
  const exportData = {
    testId: test._id,
    campaignId: test.campaignId,
    startTime: test.startTime,
    endTime: test.endTime,
    duration: test.duration,
    status: test.status,
    transcript: test.transcript.map((entry: any) => ({
      speaker: entry.speaker,
      text: entry.text,
      timestamp: entry.timestamp
    })),
    metrics: test.metrics
  };
  
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  
  return res.json(exportData);
};

/**
 * Export transcript as CSV
 */
const exportAsCsv = (res: Response, test: any): Response => {
  const filename = `webcall_transcript_${test._id}_${formatDate(test.startTime)}.csv`;
  
  // Create CSV header
  let csv = 'Speaker,Timestamp,Text\n';
  
  // Add transcript entries
  test.transcript.forEach((entry: any) => {
    const timestamp = formatTimestamp(entry.timestamp);
    const text = entry.text.replace(/"/g, '""'); // Escape quotes in CSV
    csv += `${entry.speaker},"${timestamp}","${text}"\n`;
  });
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  
  return res.send(csv);
};

/**
 * Export transcript as plain text
 */
const exportAsTxt = (res: Response, test: any): Response => {
  const filename = `webcall_transcript_${test._id}_${formatDate(test.startTime)}.txt`;
  
  // Create header
  let txt = `Web Call Test Transcript\n`;
  txt += `Test ID: ${test._id}\n`;
  txt += `Date: ${formatTimestamp(test.startTime)}\n`;
  txt += `Duration: ${formatDuration(test.duration)}\n\n`;
  
  // Add transcript entries
  test.transcript.forEach((entry: any) => {
    const timestamp = formatTimestamp(entry.timestamp);
    const speaker = entry.speaker === 'agent' ? 'Agent' : 'User';
    txt += `[${timestamp}] ${speaker}: ${entry.text}\n\n`;
  });
  
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  
  return res.send(txt);
};

/**
 * Export transcript as Markdown
 */
const exportAsMarkdown = (res: Response, test: any): Response => {
  const filename = `webcall_transcript_${test._id}_${formatDate(test.startTime)}.md`;
  
  // Create header
  let md = `# Web Call Test Transcript\n\n`;
  md += `- **Test ID:** ${test._id}\n`;
  md += `- **Date:** ${formatTimestamp(test.startTime)}\n`;
  md += `- **Duration:** ${formatDuration(test.duration)}\n`;
  md += `- **Status:** ${test.status}\n\n`;
  
  // Add metrics section
  md += `## Metrics\n\n`;
  md += `- **Response Time:** ${test.metrics.responseTime.avg.toFixed(2)}ms (min: ${test.metrics.responseTime.min}ms, max: ${test.metrics.responseTime.max}ms)\n`;
  md += `- **User Speaking Time:** ${formatDuration(test.metrics.userSpeakingTime)}\n`;
  md += `- **Agent Speaking Time:** ${formatDuration(test.metrics.agentSpeakingTime)}\n`;
  md += `- **Interruptions:** ${test.metrics.interruptions}\n`;
  md += `- **Speech-to-Text Latency:** ${test.metrics.speechToTextLatency.toFixed(2)}ms\n`;
  md += `- **Text-to-Speech Latency:** ${test.metrics.textToSpeechLatency.toFixed(2)}ms\n`;
  md += `- **LLM Latency:** ${test.metrics.llmLatency.toFixed(2)}ms\n\n`;
  
  // Add transcript section
  md += `## Transcript\n\n`;
  
  test.transcript.forEach((entry: any) => {
    const timestamp = formatTimestamp(entry.timestamp);
    const speaker = entry.speaker === 'agent' ? '**Agent**' : '**User**';
    md += `### ${speaker} (${timestamp})\n\n${entry.text}\n\n`;
  });
  
  res.setHeader('Content-Type', 'text/markdown');
  res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
  
  return res.send(md);
};

/**
 * Format date for filenames
 */
const formatDate = (date: Date): string => {
  return date.toISOString().split('T')[0];
};

/**
 * Format timestamp for display
 */
const formatTimestamp = (date: Date): string => {
  return new Date(date).toLocaleString();
};

/**
 * Format duration in milliseconds to human-readable format
 */
const formatDuration = (ms: number): string => {
  if (!ms) return '0s';
  
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor((ms / (1000 * 60)) % 60);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  
  const parts = [];
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);
  
  return parts.join(' ');
};

/**
 * Get test statistics
 * This endpoint provides statistics about web call tests for a campaign
 */
export const getTestStatistics = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { campaignId } = req.params;
    
    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }
    
    // Get user ID from authenticated request
    const userId = (req as any).user?._id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Calculate campaign metrics
    const metrics = await (WebCallTest as any).calculateCampaignMetrics(campaignId);
    
    return res.status(200).json({
      success: true,
      campaignId,
      metrics
    });
  } catch (error) {
    logger.error(`Error getting test statistics: ${error instanceof Error ? error.message : String(error)}`);
    return res.status(500).json({ 
      error: 'Failed to get test statistics',
      details: enhancedErrorHandling.generateDetailedErrorMessage(error, '', undefined)
    });
  }
};

/**
 * List tests for a campaign
 * This endpoint lists all web call tests for a specific campaign
 */
export const listCampaignTests = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { campaignId } = req.params;
    const { limit = '50', skip = '0', sortBy = 'startTime', sortDirection = 'desc' } = req.query;
    
    if (!campaignId) {
      return res.status(400).json({ error: 'Campaign ID is required' });
    }
    
    // Get user ID from authenticated request
    const userId = (req as any).user?._id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Find tests for the campaign
    const tests = await (WebCallTest as any).findTests({
      campaignId,
      limit: parseInt(limit as string, 10),
      skip: parseInt(skip as string, 10),
      sortBy: sortBy as string,
      sortDirection: sortDirection as 'asc' | 'desc'
    });
    
    // Count total tests for pagination
    const totalTests = await WebCallTest.countDocuments({ campaignId: new mongoose.Types.ObjectId(campaignId) });
    
    return res.status(200).json({
      success: true,
      campaignId,
      tests,
      pagination: {
        total: totalTests,
        limit: parseInt(limit as string, 10),
        skip: parseInt(skip as string, 10)
      }
    });
  }
  catch (error) {
    logger.error(`Error listing campaign tests: ${error instanceof Error ? error.message : String(error)}`);
    return res.status(500).json({ 
      error: 'Failed to list campaign tests',
      details: enhancedErrorHandling.generateDetailedErrorMessage(error, '', undefined)
    });
  }
};

/**
 * Get test details
 * This endpoint gets detailed information about a specific web call test
 */
export const getTestDetails = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { testId } = req.params;
    
    if (!testId) {
      return res.status(400).json({ error: 'Test ID is required' });
    }
    
    // Get user ID from authenticated request
    const userId = (req as any).user?._id;
    
    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Get the test with populated references
    const test = await (WebCallTest as any).getTestWithDetails(testId);
    
    if (!test) {
      return res.status(404).json({ error: 'Test not found' });
    }
    
    // Verify the user owns this test
    if (test.userId.toString() !== userId.toString() && !(req as any).user?.isAdmin) {
      return res.status(403).json({ error: 'Not authorized to access this test' });
    }
    
    return res.status(200).json({
      success: true,
      test
    });
  } catch (error) {
    logger.error(`Error getting test details: ${error instanceof Error ? error.message : String(error)}`);
    return res.status(500).json({ 
      error: 'Failed to get test details',
      details: enhancedErrorHandling.generateDetailedErrorMessage(error, '', undefined)
    });
  }
};
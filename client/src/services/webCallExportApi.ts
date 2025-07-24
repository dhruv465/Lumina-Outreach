import api from './api';

export enum ExportFormat {
  JSON = 'json',
  CSV = 'csv',
  TXT = 'txt',
  MARKDOWN = 'md'
}

export interface WebCallTestMetrics {
  totalTests: number;
  averageDuration: number;
  averageResponseTime: number;
  averageUserSpeakingTime: number;
  averageAgentSpeakingTime: number;
  averageInterruptions: number;
  averageTurns: number;
  averageSpeechToTextLatency: number;
  averageTextToSpeechLatency: number;
  averageLlmLatency: number;
}

export interface WebCallTest {
  _id: string;
  campaignId: string;
  userId: string;
  startTime: string;
  endTime?: string;
  duration?: number;
  transcript: {
    speaker: 'agent' | 'user';
    text: string;
    timestamp: string;
    isFinal: boolean;
  }[];
  metrics: {
    responseTime: {
      avg: number;
      min: number;
      max: number;
    };
    userSpeakingTime: number;
    agentSpeakingTime: number;
    interruptions: number;
    speechToTextLatency: number;
    textToSpeechLatency: number;
    llmLatency: number;
  };
  status: 'completed' | 'error' | 'terminated';
  errorDetails?: string;
}

/**
 * Get the URL for exporting a transcript
 * @param testId The test ID
 * @param format The export format
 * @returns The export URL
 */
export const getExportUrl = (testId: string, format: ExportFormat = ExportFormat.JSON): string => {
  return `${api.defaults.baseURL}/webcall/export/${testId}?format=${format}`;
};

/**
 * Get test statistics for a campaign
 * @param campaignId The campaign ID
 * @returns Campaign test statistics
 */
export const getTestStatistics = async (campaignId: string): Promise<WebCallTestMetrics> => {
  const response = await api.get(`/webcall/statistics/${campaignId}`);
  return response.data.metrics;
};

/**
 * List tests for a campaign
 * @param campaignId The campaign ID
 * @param options Pagination and sorting options
 * @returns List of tests and pagination info
 */
export const listCampaignTests = async (
  campaignId: string,
  options: {
    limit?: number;
    skip?: number;
    sortBy?: string;
    sortDirection?: 'asc' | 'desc';
  } = {}
): Promise<{
  tests: WebCallTest[];
  pagination: {
    total: number;
    limit: number;
    skip: number;
  };
}> => {
  const { limit = 50, skip = 0, sortBy = 'startTime', sortDirection = 'desc' } = options;

  const response = await api.get(
    `/webcall/campaign/${campaignId}?limit=${limit}&skip=${skip}&sortBy=${sortBy}&sortDirection=${sortDirection}`
  );

  return {
    tests: response.data.tests,
    pagination: response.data.pagination
  };
};

/**
 * Get test details
 * @param testId The test ID
 * @returns Detailed test information
 */
export const getTestDetails = async (testId: string): Promise<WebCallTest> => {
  const response = await api.get(`/webcall/test/${testId}`);
  return response.data.test;
};
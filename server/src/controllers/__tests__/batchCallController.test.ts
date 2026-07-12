const mockCreateBatch = jest.fn();
jest.mock('../../services/batchCallService', () => ({
  batchCallService: { createBatch: mockCreateBatch },
}));

const mockCampaignSelect = jest.fn();
const mockCampaignFindById = jest.fn();
jest.mock('../../models/Campaign', () => ({
  __esModule: true,
  default: { findById: mockCampaignFindById },
}));

const mockBuildProviderConfig = jest.fn();
jest.mock('../../integrations/livekit/providerConfig', () => {
  const actual = jest.requireActual('../../integrations/livekit/providerConfig');
  return {
    ...actual,
    buildProviderConfig: (...args: any[]) => mockBuildProviderConfig(...args),
  };
});

import { batchCallController } from '../batchCallController';
import { ProviderConfigError } from '../../integrations/livekit/providerConfig';

const ownerId = '64b0c0ffee0ddeadbeef0001';

function fakeReply() {
  const reply: any = { statusCode: 200 };
  reply.status = jest.fn().mockImplementation((code: number) => {
    reply.statusCode = code;
    return reply;
  });
  reply.send = jest.fn().mockReturnValue(reply);
  return reply;
}

function request() {
  return {
    body: { campaignId: 'campaign1', leadIds: ['lead1'], name: 'Batch' },
    user: { id: ownerId, role: 'user' },
  } as any;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockCampaignFindById.mockReturnValue({ select: mockCampaignSelect });
  mockCampaignSelect.mockResolvedValue({
    createdBy: { toString: () => ownerId },
  });
  mockBuildProviderConfig.mockResolvedValue({});
  mockCreateBatch.mockResolvedValue({ _id: 'batch1' });
});

describe('BatchCallController.createBatch', () => {
  it('maps service ProviderConfigError to 400', async () => {
    mockCreateBatch.mockRejectedValue(new ProviderConfigError());
    const reply = fakeReply();

    await batchCallController.createBatch(request(), reply);

    expect(reply.statusCode).toBe(400);
    expect(reply.send).toHaveBeenCalledWith({
      message: 'Configure and verify your API keys in Configuration before calling.',
    });
  });

  it('keeps unrelated failures on the existing 500 contract', async () => {
    mockCreateBatch.mockRejectedValue(new Error('database unavailable'));
    const reply = fakeReply();

    await batchCallController.createBatch(request(), reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.send).toHaveBeenCalledWith({
      success: false,
      error: 'Internal server error',
    });
  });

  it('delegates provider validation to the service boundary', async () => {
    const reply = fakeReply();

    await batchCallController.createBatch(request(), reply);

    expect(reply.statusCode).toBe(201);
    expect(mockBuildProviderConfig).not.toHaveBeenCalled();
    expect(mockCreateBatch).toHaveBeenCalledTimes(1);
  });
});

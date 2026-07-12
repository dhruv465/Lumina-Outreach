const mockInitiateCall = jest.fn();
jest.mock('../../services/callService', () => ({
  __esModule: true,
  default: { initiateCall: mockInitiateCall },
}));

const mockCampaignSelect = jest.fn();
const mockCampaignFindById = jest.fn();
jest.mock('../../models/Campaign', () => ({
  __esModule: true,
  default: { findById: mockCampaignFindById },
}));

jest.mock('../../utils/errorHandling', () => ({
  handleError: (error: unknown) => error instanceof Error ? error.message : String(error),
}));

import { initiateCall } from '../callController';
import { ProviderConfigError } from '../../integrations/livekit/providerConfig';

const ownerId = '64b0c0ffee0ddeadbeef0001';
const intruderId = '64b0c0ffee0ddeadbeef0002';

function fakeReply() {
  const reply: any = { statusCode: 200 };
  reply.status = jest.fn().mockImplementation((code: number) => {
    reply.statusCode = code;
    return reply;
  });
  reply.send = jest.fn().mockReturnValue(reply);
  return reply;
}

function requestFor(user: any) {
  return {
    body: { leadId: 'lead1', campaignId: 'campaign1' },
    user,
  } as any;
}

beforeEach(() => {
  jest.resetAllMocks();
  mockCampaignFindById.mockReturnValue({ select: mockCampaignSelect });
  mockCampaignSelect.mockResolvedValue({
    createdBy: { toString: () => ownerId },
  });
  mockInitiateCall.mockResolvedValue({ _id: 'call1' });
});

describe('initiateCall', () => {
  it('returns 403 before downstream call work for another tenant campaign', async () => {
    const reply = fakeReply();

    await initiateCall(requestFor({ id: intruderId, role: 'user' }), reply);

    expect(reply.statusCode).toBe(403);
    expect(reply.send).toHaveBeenCalledWith({
      message: 'Access denied: you do not own this campaign',
    });
    expect(mockInitiateCall).not.toHaveBeenCalled();
  });

  it('maps ProviderConfigError to 400', async () => {
    mockInitiateCall.mockRejectedValue(new ProviderConfigError());
    const reply = fakeReply();

    await initiateCall(requestFor({ id: ownerId, role: 'user' }), reply);

    expect(reply.statusCode).toBe(400);
    expect(reply.send).toHaveBeenCalledWith({
      message: 'Configure and verify your API keys in Configuration before calling.',
    });
  });

  it('keeps unrelated failures on the existing 500 contract', async () => {
    mockInitiateCall.mockRejectedValue(new Error('database unavailable'));
    const reply = fakeReply();

    await initiateCall(requestFor({ id: ownerId, role: 'user' }), reply);

    expect(reply.statusCode).toBe(500);
    expect(reply.send).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Failed to initiate call',
    }));
  });
});

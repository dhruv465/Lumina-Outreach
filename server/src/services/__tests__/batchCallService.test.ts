jest.mock('../../models/BatchCall');
jest.mock('../../models/Campaign');
jest.mock('../../models/Lead');
jest.mock('../../utils/financialService');
jest.mock('../../integrations/livekit/dispatchService', () => ({
  initiateLiveKitCall: jest.fn().mockResolvedValue({ _id: 'call1' }),
}));

const mockBuildProviderConfig = jest.fn();
jest.mock('../../integrations/livekit/providerConfig', () => ({
  buildProviderConfig: (...args: any[]) => mockBuildProviderConfig(...args),
  ProviderConfigError: class ProviderConfigError extends Error {},
}));

import BatchCall from '../../models/BatchCall';
import Campaign from '../../models/Campaign';
import { FinancialService } from '../../utils/financialService';
import { initiateLiveKitCall } from '../../integrations/livekit/dispatchService';
import { ProviderConfigError } from '../../integrations/livekit/providerConfig';
import { batchCallService } from '../batchCallService';

const asMock = (fn: any) => fn as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  asMock(FinancialService.isCampaignBudgetAvailable).mockResolvedValue(true);
  asMock(Campaign.findById).mockResolvedValue({ telephonyProvider: 'livekit' });
  mockBuildProviderConfig.mockResolvedValue({});
  asMock(BatchCall.findByIdAndUpdate).mockResolvedValue({ stats: { queued: 0 }, status: 'processing', save: jest.fn() });
  asMock(BatchCall.updateOne).mockResolvedValue({});
});

afterEach(() => jest.restoreAllMocks());

function fakeBatch(overrides: any = {}) {
  return {
    _id: 'batch1',
    campaignId: 'camp1',
    createdBy: { toString: () => 'u1' },
    leadIds: ['L1', 'L2', 'L3'],
    processedLeadIds: [],
    config: { maxConcurrency: 10, retryCount: 1, delayBetweenCalls: 0 },
    stats: { total: 3, queued: 3, processed: 0, successful: 0, failed: 0 },
    status: 'processing',
    save: jest.fn(),
    ...overrides,
  };
}

describe('batchCallService.runBatch', () => {
  it('dispatches only pending leads (skips processedLeadIds)', async () => {
    asMock(BatchCall.findById).mockResolvedValue(fakeBatch({ processedLeadIds: ['L1'] }));
    await batchCallService.runBatch('batch1');
    expect(asMock(initiateLiveKitCall).mock.calls.map((c) => c[0].leadId).sort())
      .toEqual(['L2', 'L3']);
  });

  it('marks each dispatched lead into processedLeadIds', async () => {
    asMock(BatchCall.findById).mockResolvedValue(fakeBatch());
    await batchCallService.runBatch('batch1');
    const addToSetLeads = asMock(BatchCall.updateOne).mock.calls
      .map((c) => c[1].$addToSet?.processedLeadIds)
      .filter(Boolean).sort();
    expect(addToSetLeads).toEqual(['L1', 'L2', 'L3']);
  });

  it('passes the batch creator as the initiating user for owner fallback', async () => {
    asMock(BatchCall.findById).mockResolvedValue(fakeBatch());
    await batchCallService.runBatch('batch1');
    expect(asMock(initiateLiveKitCall).mock.calls.map((call) => call[0].initiatingUserId))
      .toEqual(['u1', 'u1', 'u1']);
  });

  it('stops dispatching when campaign budget is depleted', async () => {
    asMock(FinancialService.isCampaignBudgetAvailable).mockResolvedValue(false);
    asMock(BatchCall.findById).mockResolvedValue(fakeBatch());
    await batchCallService.runBatch('batch1');
    expect(asMock(initiateLiveKitCall)).not.toHaveBeenCalled();
  });

  it('respects the concurrency cap from LUMINA_BATCH_CONCURRENCY', async () => {
    process.env.LUMINA_BATCH_CONCURRENCY = '1';
    let inFlight = 0; let maxInFlight = 0;
    asMock(initiateLiveKitCall).mockImplementation(async () => {
      inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5)); inFlight--; return { _id: 'c' };
    });
    asMock(BatchCall.findById).mockResolvedValue(fakeBatch({ leadIds: ['L1', 'L2', 'L3', 'L4'] }));
    await batchCallService.runBatch('batch1');
    expect(maxInFlight).toBe(1);
    delete process.env.LUMINA_BATCH_CONCURRENCY;
  });
});

describe('batchCallService.createBatch', () => {
  it('creates a batch doc and returns without awaiting the run', async () => {
    const runSpy = jest.spyOn(batchCallService, 'runBatch').mockResolvedValue(undefined);
    asMock(BatchCall.create).mockResolvedValue(fakeBatch());
    asMock(BatchCall.findById).mockResolvedValue(fakeBatch());
    const batch = await batchCallService.createBatch({
      name: 'n', campaignId: 'camp1', leadIds: ['L1', 'L2', 'L3'], createdBy: 'u1',
    });
    expect(batch._id).toBe('batch1');
    expect(mockBuildProviderConfig).toHaveBeenCalledWith('u1');
    expect(asMock(BatchCall.create)).toHaveBeenCalledTimes(1);
    expect(runSpy).toHaveBeenCalledWith('batch1');
    runSpy.mockRestore();
  });

  it('rejects invalid campaign-owner config before persisting a batch', async () => {
    const runSpy = jest.spyOn(batchCallService, 'runBatch').mockResolvedValue(undefined);
    asMock(Campaign.findById).mockResolvedValue({
      createdBy: { toString: () => 'campaign-owner' },
    });
    asMock(BatchCall.create).mockResolvedValue(fakeBatch());
    mockBuildProviderConfig.mockRejectedValue(new ProviderConfigError('Configure keys'));

    await expect(batchCallService.createBatch({
      name: 'n', campaignId: 'camp1', leadIds: ['L1'], createdBy: 'initiator',
    })).rejects.toThrow(ProviderConfigError);

    expect(mockBuildProviderConfig).toHaveBeenCalledWith('campaign-owner');
    expect(asMock(BatchCall.create)).not.toHaveBeenCalled();
    expect(runSpy).not.toHaveBeenCalled();
  });
});

describe('batchCallService.resumeInterruptedBatches', () => {
  it('re-runs each processing batch and skips already-processed leads', async () => {
    asMock(BatchCall.find).mockReturnValue({ select: () => Promise.resolve([{ _id: 'batch1' }]) } as any);
    asMock(BatchCall.findById).mockResolvedValue(fakeBatch({ processedLeadIds: ['L1', 'L2'] }));
    await batchCallService.resumeInterruptedBatches();
    await new Promise((r) => setTimeout(r, 20)); // let the fire-and-forget runBatch settle
    expect(asMock(initiateLiveKitCall).mock.calls.map((c) => c[0].leadId)).toEqual(['L3']);
  });
});

describe('batchCallService finalize (durability)', () => {
  it('completes from processedLeadIds even if stats.queued drifted above 0 (crash-window safe)', async () => {
    // Durable truth: every lead is processed, but a crash left stats.queued at 1.
    // The old `stats.queued <= 0` check would strand this batch in `processing`.
    const batch = fakeBatch({
      leadIds: ['L1'],
      processedLeadIds: ['L1'],
      status: 'processing',
      stats: { total: 1, queued: 1, processed: 1, successful: 1, failed: 0 },
    });
    asMock(BatchCall.findById).mockResolvedValue(batch);
    await batchCallService.runBatch('batch1');
    expect(batch.status).toBe('completed');
    expect(batch.save).toHaveBeenCalled();
  });
});

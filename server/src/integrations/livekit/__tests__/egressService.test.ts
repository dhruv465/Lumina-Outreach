const mockFindOne = jest.fn();
jest.mock('../../../models/Configuration', () => ({
  __esModule: true,
  default: { findOne: mockFindOne },
}));

const mockStartRoomCompositeEgress = jest.fn();
jest.mock('livekit-server-sdk', () => ({
  EgressClient: jest.fn().mockImplementation(() => ({
    startRoomCompositeEgress: mockStartRoomCompositeEgress,
  })),
  EncodedFileOutput: jest.fn().mockImplementation((value) => value),
  EncodedFileType: { OGG: 'OGG' },
  GCPUpload: jest.fn().mockImplementation((value) => value),
}));

import fs from 'fs';
import { startCallRecording } from '../egressService';

describe('startCallRecording tenant scope', () => {
  const ownerA = '64b0c0ffee0ddeadbeef0001';
  const ownerB = '64b0c0ffee0ddeadbeef0002';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(fs, 'readFileSync').mockReturnValue('{"client_email":"test@example.com"}');
    process.env.LIVEKIT_RECORDING_GCS_BUCKET = 'recordings';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'test-gcp.json';
    process.env.LIVEKIT_URL = 'wss://test.livekit.cloud';
    process.env.LIVEKIT_API_KEY = 'key';
    process.env.LIVEKIT_API_SECRET = 'secret';
  });

  afterEach(() => jest.restoreAllMocks());

  it('loads recording consent only for the resolved call owner', async () => {
    mockFindOne.mockResolvedValue({ complianceSettings: { recordCalls: true } });
    mockStartRoomCompositeEgress.mockResolvedValue({});

    await startCallRecording('call-owner-a', ownerA);

    expect(mockFindOne).toHaveBeenCalledWith({ ownerId: ownerA });
    expect(mockStartRoomCompositeEgress).toHaveBeenCalledTimes(1);
  });

  it('does not let another tenant enabled setting override the owner disabled setting', async () => {
    const configs = new Map([
      [ownerA, { complianceSettings: { recordCalls: false } }],
      [ownerB, { complianceSettings: { recordCalls: true } }],
    ]);
    mockFindOne.mockImplementation(({ ownerId }: { ownerId: string }) => configs.get(ownerId));

    await startCallRecording('call-owner-a', ownerA);

    expect(mockFindOne).toHaveBeenCalledWith({ ownerId: ownerA });
    expect(mockStartRoomCompositeEgress).not.toHaveBeenCalled();
  });
});

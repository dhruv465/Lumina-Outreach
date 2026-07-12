jest.mock('../../index', () => ({
  logger: {
    debug: jest.fn(),
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

jest.mock('../../models/Configuration', () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}));

import mongoose from 'mongoose';
import Configuration from '../../models/Configuration';
import { initializeServicesAfterDB } from '../index';

describe('global LLM initialization', () => {
  it('never loads an arbitrary tenant Configuration after database startup', async () => {
    const previousReadyState = mongoose.connection.readyState;
    (mongoose.connection as any).readyState = 1;
    (Configuration.findOne as jest.Mock).mockResolvedValue({
      llmConfig: {
        providers: [
          {
            name: 'openai',
            apiKey: 'v1:tenant-ciphertext',
            status: 'verified',
          },
        ],
        defaultProvider: 'openai',
        defaultModel: 'gpt-4.1',
      },
    });

    try {
      await initializeServicesAfterDB();
      expect(Configuration.findOne).not.toHaveBeenCalled();
    } finally {
      (mongoose.connection as any).readyState = previousReadyState;
    }
  });
});

const controller = new Proxy({}, { get: () => jest.fn() });
jest.mock('../../controllers/campaignController', () => controller);

import campaignRoutes from '../campaignRoutes';

describe('campaign routes', () => {
  it('does not register obsolete server-side script generation endpoints', async () => {
    const fastify: any = {
      authenticate: jest.fn(),
      addHook: jest.fn(),
      post: jest.fn(),
      get: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    };

    await campaignRoutes(fastify, {});

    const postPaths = fastify.post.mock.calls.map(([path]: [string]) => path);
    expect(postPaths).not.toContain('/:id/generate-script');
    expect(postPaths).not.toContain('/:id/generate-advanced-script');
  });
});

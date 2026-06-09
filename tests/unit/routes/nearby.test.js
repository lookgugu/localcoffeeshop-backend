/**
 * Unit tests for nearby route wiring.
 */

const { mountNearby } = require('../../../src/routes/nearby');

function makeRouter() {
  const routes = {};
  return {
    routes,
    get: jest.fn((path, handler) => { routes[path] = handler; }),
  };
}

function makeReqRes(query = {}) {
  const body = {};
  return {
    req: { query },
    res: {
      statusCode: 200,
      status(code) { this.statusCode = code; return this; },
      json(payload) { body.payload = payload; return this; },
    },
    body,
    next: jest.fn(),
  };
}

describe('mountNearby', () => {
  it('mounts GET /nearby and forwards valid requests through the cached use case', async () => {
    const router = makeRouter();
    const nearbyShopsUseCase = jest.fn();
    const cached = jest.fn((fetcher) => async (req, res) => {
      const result = await fetcher(req);
      res.json({ success: true, data: result.data, metadata: result.metadata });
    });
    nearbyShopsUseCase.mockResolvedValue({ data: [], metadata: { count: 0 } });

    mountNearby(router, { nearbyShopsUseCase, cached });
    const { req, res, next, body } = makeReqRes({ lat: '42', lon: '-71', limit: '5' });
    await router.routes['/nearby'](req, res, next);

    expect(router.get).toHaveBeenCalledWith('/nearby', expect.any(Function));
    expect(cached).toHaveBeenCalledWith(expect.any(Function), { ttlSeconds: 300, cacheControlMaxAge: 300 });
    expect(nearbyShopsUseCase).toHaveBeenCalledWith({ lat: '42', lon: '-71', lng: undefined, limit: '5' });
    expect(body.payload).toEqual({ success: true, data: [], metadata: { count: 0 } });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 400 for invalid coordinates before hitting cache', async () => {
    const router = makeRouter();
    const cachedHandler = jest.fn();
    const cached = jest.fn(() => cachedHandler);

    mountNearby(router, { nearbyShopsUseCase: jest.fn(), cached });
    const { req, res, body, next } = makeReqRes({ lat: '999', lon: '-71' });
    await router.routes['/nearby'](req, res, next);

    expect(res.statusCode).toBe(400);
    expect(body.payload.success).toBe(false);
    expect(body.payload.error.message).toMatch(/latitude/i);
    expect(cachedHandler).not.toHaveBeenCalled();
  });
});

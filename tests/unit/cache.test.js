/**
 * Unit Tests for QueryCache
 *
 * Tests the in-memory cache with TTL, LRU eviction, single-flight, and event hooks.
 */

const { QueryCache } = require('../../src/lib/cache');

describe('QueryCache', () => {
  describe('through() — basic read-through', () => {
    it('invokes load on first call and returns its value', async () => {
      const cache = new QueryCache();
      const load = jest.fn().mockResolvedValue('value1');

      const result = await cache.through('key1', 60, load);

      expect(result).toBe('value1');
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('serves subsequent calls from cache without re-invoking load', async () => {
      const cache = new QueryCache();
      const load = jest.fn().mockResolvedValue('cached');

      const first = await cache.through('key1', 60, load);
      const second = await cache.through('key1', 60, load);

      expect(first).toBe('cached');
      expect(second).toBe('cached');
      expect(load).toHaveBeenCalledTimes(1);
    });

    it('caches different keys independently', async () => {
      const cache = new QueryCache();
      const loadA = jest.fn().mockResolvedValue('A');
      const loadB = jest.fn().mockResolvedValue('B');

      expect(await cache.through('a', 60, loadA)).toBe('A');
      expect(await cache.through('b', 60, loadB)).toBe('B');
      expect(await cache.through('a', 60, loadA)).toBe('A');

      expect(loadA).toHaveBeenCalledTimes(1);
      expect(loadB).toHaveBeenCalledTimes(1);
    });

    it('stores non-string values correctly', async () => {
      const cache = new QueryCache();
      const obj = { foo: 'bar', nested: { n: 1 } };
      const arr = [1, 2, 3];

      expect(await cache.through('obj', 60, () => Promise.resolve(obj))).toEqual(obj);
      expect(await cache.through('arr', 60, () => Promise.resolve(arr))).toEqual(arr);
      expect(await cache.through('num', 60, () => Promise.resolve(42))).toBe(42);
      expect(await cache.through('null', 60, () => Promise.resolve(null))).toBeNull();
    });
  });

  describe('through() — TTL expiry', () => {
    it('re-invokes load after the entry expires', async () => {
      const cache = new QueryCache();
      let counter = 0;
      const load = jest.fn().mockImplementation(() => Promise.resolve(++counter));

      // 0.05s TTL = 50ms
      const first = await cache.through('k', 0.05, load);
      expect(first).toBe(1);

      await new Promise((r) => setTimeout(r, 80));

      const second = await cache.through('k', 0.05, load);
      expect(second).toBe(2);
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('keeps the value cached before TTL expires', async () => {
      const cache = new QueryCache();
      const load = jest.fn().mockResolvedValue('fresh');

      await cache.through('k', 10, load); // 10s TTL
      await new Promise((r) => setTimeout(r, 30));
      const result = await cache.through('k', 10, load);

      expect(result).toBe('fresh');
      expect(load).toHaveBeenCalledTimes(1);
    });
  });

  describe('through() — ttlSeconds <= 0 bypass', () => {
    it('with ttlSeconds = 0 invokes load every call and stores nothing', async () => {
      const cache = new QueryCache();
      const load = jest.fn().mockResolvedValue('bypass');

      const a = await cache.through('k', 0, load);
      const b = await cache.through('k', 0, load);

      expect(a).toBe('bypass');
      expect(b).toBe('bypass');
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('with negative ttlSeconds bypasses too', async () => {
      const cache = new QueryCache();
      const load = jest.fn().mockResolvedValue('x');

      await cache.through('k', -5, load);
      await cache.through('k', -5, load);

      expect(load).toHaveBeenCalledTimes(2);
    });

    it('does not fire onEvent when bypassing', async () => {
      const onEvent = jest.fn();
      const cache = new QueryCache({ onEvent });

      await cache.through('k', 0, () => Promise.resolve('v'));

      expect(onEvent).not.toHaveBeenCalled();
    });
  });

  describe('through() — LRU eviction', () => {
    it('evicts the oldest entry when maxEntries is exceeded', async () => {
      const cache = new QueryCache({ maxEntries: 3 });
      const loadFor = (v) => jest.fn().mockResolvedValue(v);

      const l1 = loadFor('1');
      const l2 = loadFor('2');
      const l3 = loadFor('3');
      const l4 = loadFor('4');

      await cache.through('a', 60, l1);
      await cache.through('b', 60, l2);
      await cache.through('c', 60, l3);
      await cache.through('d', 60, l4); // evicts 'a'

      // 'b', 'c', 'd' still cached — no re-load
      await cache.through('b', 60, l2);
      await cache.through('c', 60, l3);
      await cache.through('d', 60, l4);
      expect(l2).toHaveBeenCalledTimes(1);
      expect(l3).toHaveBeenCalledTimes(1);
      expect(l4).toHaveBeenCalledTimes(1);

      // 'a' was evicted — fetching it re-invokes its loader
      await cache.through('a', 60, l1);
      expect(l1).toHaveBeenCalledTimes(2);
    });

    it('treats a hit as access, keeping the entry from being evicted', async () => {
      const cache = new QueryCache({ maxEntries: 3 });
      const l = (v) => jest.fn().mockResolvedValue(v);
      const la = l('A');
      const lb = l('B');
      const lc = l('C');
      const ld = l('D');

      await cache.through('a', 60, la);
      await cache.through('b', 60, lb);
      await cache.through('c', 60, lc);

      // Access 'a' — moves it to most-recently-used
      await cache.through('a', 60, la);

      // Now insert 'd' — should evict 'b' (oldest after the touch)
      await cache.through('d', 60, ld);

      // 'a' still cached
      await cache.through('a', 60, la);
      expect(la).toHaveBeenCalledTimes(1);

      // 'b' was evicted — loader re-invoked
      await cache.through('b', 60, lb);
      expect(lb).toHaveBeenCalledTimes(2);
    });
  });

  describe('through() — single-flight', () => {
    it('two concurrent calls with the same key invoke load only once', async () => {
      const cache = new QueryCache();
      let resolveLoad;
      const load = jest.fn().mockImplementation(
        () => new Promise((r) => { resolveLoad = r; })
      );

      const p1 = cache.through('k', 60, load);
      const p2 = cache.through('k', 60, load);

      // Both share the in-flight promise
      expect(load).toHaveBeenCalledTimes(1);

      resolveLoad('shared');
      const [a, b] = await Promise.all([p1, p2]);
      expect(a).toBe('shared');
      expect(b).toBe('shared');
    });

    it('clears in-flight tracking after settle so later calls re-load if expired', async () => {
      const cache = new QueryCache();
      const load = jest.fn().mockResolvedValue('v');

      await cache.through('k', 0.05, load);
      await new Promise((r) => setTimeout(r, 80));
      await cache.through('k', 0.05, load);

      expect(load).toHaveBeenCalledTimes(2);
    });
  });

  describe('through() — onEvent', () => {
    it('fires onEvent({kind:"miss", key}) on first call', async () => {
      const onEvent = jest.fn();
      const cache = new QueryCache({ onEvent });

      await cache.through('mykey', 60, () => Promise.resolve('v'));

      expect(onEvent).toHaveBeenCalledWith({ kind: 'miss', key: 'mykey' });
    });

    it('fires onEvent({kind:"hit", key}) on subsequent call', async () => {
      const onEvent = jest.fn();
      const cache = new QueryCache({ onEvent });

      await cache.through('k', 60, () => Promise.resolve('v'));
      onEvent.mockClear();
      await cache.through('k', 60, () => Promise.resolve('v'));

      expect(onEvent).toHaveBeenCalledWith({ kind: 'hit', key: 'k' });
    });

    it('does not require onEvent (works without it)', async () => {
      const cache = new QueryCache();
      const result = await cache.through('k', 60, () => Promise.resolve('ok'));
      expect(result).toBe('ok');
    });
  });

  describe('through() — load() rejection', () => {
    it('propagates the rejection', async () => {
      const cache = new QueryCache();
      const err = new Error('boom');

      await expect(
        cache.through('k', 60, () => Promise.reject(err))
      ).rejects.toThrow('boom');
    });

    it('does not cache a rejected load — next call re-invokes', async () => {
      const cache = new QueryCache();
      let attempts = 0;
      const load = jest.fn().mockImplementation(() => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error('first fail'));
        return Promise.resolve('second success');
      });

      await expect(cache.through('k', 60, load)).rejects.toThrow('first fail');
      const result = await cache.through('k', 60, load);

      expect(result).toBe('second success');
      expect(load).toHaveBeenCalledTimes(2);
    });

    it('clears in-flight tracking on rejection so concurrent retries work', async () => {
      const cache = new QueryCache();
      let attempts = 0;
      const load = () => {
        attempts += 1;
        if (attempts === 1) return Promise.reject(new Error('fail'));
        return Promise.resolve('ok');
      };

      await expect(cache.through('k', 60, load)).rejects.toThrow('fail');
      // After rejection, the in-flight map should be clean; a new call kicks off a fresh load
      const result = await cache.through('k', 60, load);
      expect(result).toBe('ok');
    });
  });
});

/**
 * Query Cache Module
 *
 * In-memory cache with TTL, LRU eviction, single-flight, and event hooks.
 * Exposes a single `through(key, ttlSeconds, load)` method — the cache is
 * the only path to the loader, so callers cannot accidentally bypass it.
 */

/**
 * @typedef {{ kind: 'hit' | 'miss', key: string }} CacheEvent
 */

class QueryCache {
    /**
     * @param {Object} [options]
     * @param {number} [options.maxEntries=1000] LRU capacity
     * @param {(event: CacheEvent) => void} [options.onEvent] Hook for hit/miss notification
     */
    constructor({ maxEntries = 1000, onEvent } = {}) {
        this.maxEntries = maxEntries;
        this.onEvent = typeof onEvent === 'function' ? onEvent : null;

        // Map iteration order is insertion order; we delete+reinsert on access
        // to give us O(1) LRU bookkeeping without a separate list.
        this._entries = new Map();

        // Tracks promises currently in flight so concurrent callers share one load().
        this._inFlight = new Map();
    }

    /**
     * Read-through cache access.
     *
     * - Cache hit (key present, unexpired): fires `onEvent({kind:'hit', key})` and returns cached value.
     * - Cache miss: fires `onEvent({kind:'miss', key})`, invokes `load()`, stores result with `ttlSeconds`, returns it.
     * - Single-flight: concurrent calls with the same key share one in-flight load().
     * - `ttlSeconds <= 0` bypasses entirely: invokes load(), returns result, stores nothing, no event.
     * - `load()` rejection: nothing is cached; the rejection propagates.
     *
     * @param {string} key Cache key
     * @param {number} ttlSeconds Time-to-live in seconds (<= 0 to bypass)
     * @param {() => Promise<any>} load Loader invoked on miss
     * @returns {Promise<any>}
     */
    async through(key, ttlSeconds, load) {
        if (ttlSeconds <= 0) {
            return load();
        }

        const entry = this._entries.get(key);
        if (entry && entry.expiresAt > Date.now()) {
            // LRU: move to most-recently-used position
            this._entries.delete(key);
            this._entries.set(key, entry);
            if (this.onEvent) this.onEvent({ kind: 'hit', key });
            return entry.value;
        }

        // Drop expired entry if present
        if (entry) this._entries.delete(key);

        if (this.onEvent) this.onEvent({ kind: 'miss', key });

        // Single-flight: if another caller is already loading this key, await theirs.
        const pending = this._inFlight.get(key);
        if (pending) return pending;

        const loadPromise = (async () => {
            const value = await load();
            this._set(key, value, ttlSeconds);
            return value;
        })();

        this._inFlight.set(key, loadPromise);
        try {
            return await loadPromise;
        } finally {
            this._inFlight.delete(key);
        }
    }

    _set(key, value, ttlSeconds) {
        // Evict oldest (insertion-order = LRU) entries until we have room.
        if (!this._entries.has(key) && this._entries.size >= this.maxEntries) {
            const oldestKey = this._entries.keys().next().value;
            if (oldestKey !== undefined) this._entries.delete(oldestKey);
        }
        this._entries.set(key, {
            value,
            expiresAt: Date.now() + ttlSeconds * 1000,
        });
    }
}

module.exports = { QueryCache };

/**
 * Bounded in-memory sliding-window counter (per process).
 *
 * `reserve(key)` checks AND records one event synchronously, so concurrent
 * requests cannot all pass a check made before an await. It returns a
 * release function (undo the reservation, e.g. the provider definitely
 * rejected the send) or null when the window is full.
 * At most `maxKeys` keys are tracked; the oldest key is evicted first, so a
 * flood of distinct keys cannot grow memory without bound. Single-instance
 * only (see docs/waitlist.md).
 */

function makeWindowCounter({ max, windowMs, maxKeys = 10000, now = Date.now }) {
    const hits = new Map(); // key -> timestamps (ascending)

    function recent(key) {
        const cutoff = now() - windowMs;
        const list = (hits.get(key) || []).filter((t) => t > cutoff);
        if (list.length) hits.set(key, list);
        else hits.delete(key);
        return list;
    }

    function reserve(key) {
        const list = recent(key);
        if (list.length >= max) return null;
        const t = now();
        list.push(t);
        hits.delete(key); // re-insert so Map order tracks recency
        hits.set(key, list);
        while (hits.size > maxKeys) hits.delete(hits.keys().next().value);
        let released = false;
        return function release() {
            if (released) return;
            released = true;
            const current = hits.get(key);
            const i = current ? current.indexOf(t) : -1;
            if (i !== -1) current.splice(i, 1);
        };
    }

    return { reserve, size: () => hits.size };
}

module.exports = { makeWindowCounter };

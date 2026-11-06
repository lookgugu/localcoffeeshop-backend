/**
 * Strictly parse a bounded integer env var. Unset/empty → fallback;
 * anything else must be plain base-10 digits within [min, max] or this
 * throws, so a misconfigured limit fails the boot instead of silently
 * becoming a default, a negative or a parseInt prefix ('10abc' → 10).
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {string} name
 * @param {{min: number, max: number, fallback: number}} bounds
 * @returns {number}
 */
function boundedInt(env, name, { min, max, fallback }) {
    const raw = env[name] === undefined || env[name] === null ? '' : String(env[name]).trim();
    if (raw === '') return fallback;
    const value = /^[0-9]{1,15}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isSafeInteger(value) || value < min || value > max) {
        throw new Error(`${name} must be an integer between ${min} and ${max} (got "${raw}")`);
    }
    return value;
}

module.exports = { boundedInt };

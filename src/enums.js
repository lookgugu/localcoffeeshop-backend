/**
 * Shared enums: State + Price.
 *
 * UMD-style: this same file is committed verbatim in both the backend
 * (CommonJS) and the frontend (browser global `window.CoffeeShopEnums`).
 * A GitHub Action on each repo diffs the two files to catch drift.
 *
 * Design:
 *   - State: helper-first namespace over a frozen private map. Callers
 *     never see the raw map; only the functions are exported.
 *   - Price: typed enum with attached fields. Static singleton instances
 *     (Price.INEXPENSIVE, .MODERATE, .EXPENSIVE, .UNKNOWN) are frozen and
 *     compared by reference equality.
 */
(function (root, factory) {
  const mod = factory();
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = mod;
  } else if (typeof window !== 'undefined') {
    window.CoffeeShopEnums = mod;
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ==========================================================================
  // STATE
  // ==========================================================================

  const STATE_NAMES = Object.freeze({
    AK: 'Alaska', AL: 'Alabama', AR: 'Arkansas', AZ: 'Arizona',
    CA: 'California', CO: 'Colorado', CT: 'Connecticut', DC: 'Washington D.C.',
    DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii',
    IA: 'Iowa', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana',
    KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', MA: 'Massachusetts',
    MD: 'Maryland', ME: 'Maine', MI: 'Michigan', MN: 'Minnesota',
    MO: 'Missouri', MS: 'Mississippi', MT: 'Montana', NC: 'North Carolina',
    ND: 'North Dakota', NE: 'Nebraska', NH: 'New Hampshire', NJ: 'New Jersey',
    NM: 'New Mexico', NV: 'Nevada', NY: 'New York', OH: 'Ohio',
    OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania', PR: 'Puerto Rico',
    RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
    TX: 'Texas', UT: 'Utah', VA: 'Virginia', VT: 'Vermont',
    WA: 'Washington', WI: 'Wisconsin', WV: 'West Virginia', WY: 'Wyoming'
  });

  // Reverse index built once at module init (name.toLowerCase() -> code).
  const NAME_TO_CODE = Object.freeze(
    Object.fromEntries(
      Object.entries(STATE_NAMES).map(function (entry) {
        return [entry[1].toLowerCase(), entry[0]];
      })
    )
  );

  // Pre-computed sorted arrays.
  const _CODES_SORTED = Object.freeze(Object.keys(STATE_NAMES).sort());
  const _STATES_SORTED_BY_NAME = Object.freeze(
    Object.entries(STATE_NAMES)
      .map(function (entry) { return Object.freeze({ code: entry[0], name: entry[1] }); })
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
  );

  function stateName(code) {
    if (typeof code !== 'string') return code;
    return STATE_NAMES[code.toUpperCase()] || code;
  }

  function stateCodeFromName(name) {
    if (typeof name !== 'string') return null;
    return NAME_TO_CODE[name.trim().toLowerCase()] || null;
  }

  function isStateCode(value) {
    if (typeof value !== 'string') return false;
    return Object.prototype.hasOwnProperty.call(STATE_NAMES, value.toUpperCase());
  }

  function allStateCodes() { return _CODES_SORTED; }
  function allStates() { return _STATES_SORTED_BY_NAME; }

  // ==========================================================================
  // PRICE
  // ==========================================================================

  const Price = (function () {
    const INEXPENSIVE = Object.freeze({
      key: 'PRICE_LEVEL_INEXPENSIVE', numeric: 1, label: 'Inexpensive', cssClass: 'inexpensive'
    });
    const MODERATE = Object.freeze({
      key: 'PRICE_LEVEL_MODERATE', numeric: 2, label: 'Moderate', cssClass: 'moderate'
    });
    const EXPENSIVE = Object.freeze({
      key: 'PRICE_LEVEL_EXPENSIVE', numeric: 3, label: 'Expensive', cssClass: 'expensive'
    });
    const UNKNOWN = Object.freeze({
      key: null, numeric: 0, label: 'N/A', cssClass: ''
    });

    const _ALL = Object.freeze([INEXPENSIVE, MODERATE, EXPENSIVE]);
    const _BY_KEY = Object.freeze({
      [INEXPENSIVE.key]: INEXPENSIVE,
      [MODERATE.key]: MODERATE,
      [EXPENSIVE.key]: EXPENSIVE
    });
    const _BY_NUMERIC = Object.freeze({ 1: INEXPENSIVE, 2: MODERATE, 3: EXPENSIVE });

    function all() { return _ALL; }

    function fromKey(key) {
      if (typeof key !== 'string') return UNKNOWN;
      return _BY_KEY[key] || UNKNOWN;
    }

    function fromNumeric(n) {
      const num = Number(n);
      if (!Number.isFinite(num)) return UNKNOWN;
      return _BY_NUMERIC[num] || UNKNOWN;
    }

    function averageFromNumeric(n) {
      const num = Number(n);
      if (!Number.isFinite(num) || num <= 0) return UNKNOWN;
      if (num < 1.5) return INEXPENSIVE;
      if (num < 2.5) return MODERATE;
      return EXPENSIVE;
    }

    function average(prices) {
      if (!Array.isArray(prices) || prices.length === 0) return UNKNOWN;
      let total = 0;
      let count = 0;
      for (let i = 0; i < prices.length; i++) {
        const p = prices[i];
        if (p && typeof p.numeric === 'number' && p.numeric > 0) {
          total += p.numeric;
          count++;
        }
      }
      if (count === 0) return UNKNOWN;
      return averageFromNumeric(total / count);
    }

    return Object.freeze({
      INEXPENSIVE: INEXPENSIVE,
      MODERATE: MODERATE,
      EXPENSIVE: EXPENSIVE,
      UNKNOWN: UNKNOWN,
      all: all,
      fromKey: fromKey,
      fromNumeric: fromNumeric,
      average: average,
      averageFromNumeric: averageFromNumeric
    });
  })();

  // ==========================================================================
  // EXPORTS
  // ==========================================================================

  return Object.freeze({
    stateName: stateName,
    stateCodeFromName: stateCodeFromName,
    isStateCode: isStateCode,
    allStateCodes: allStateCodes,
    allStates: allStates,
    Price: Price
  });
});

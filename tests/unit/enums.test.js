/**
 * Unit Tests for shared enums (State helpers + Price typed enum).
 */

const { stateName, stateCodeFromName, isStateCode, allStateCodes, allStates, Price } = require('../../src/enums');

describe('State helpers', () => {
  describe('stateName(code)', () => {
    it('returns full name for known uppercase code', () => {
      expect(stateName('CA')).toBe('California');
    });

    it('accepts lowercase input by uppercasing internally', () => {
      expect(stateName('ca')).toBe('California');
    });

    it('returns input unchanged for unknown code (preserves legacy semantics)', () => {
      expect(stateName('XX')).toBe('XX');
    });

    it('passes non-string input through unchanged', () => {
      expect(stateName(null)).toBe(null);
      expect(stateName(undefined)).toBe(undefined);
    });
  });

  describe('stateCodeFromName(name)', () => {
    it('returns code for exact name', () => {
      expect(stateCodeFromName('California')).toBe('CA');
    });

    it('is case-insensitive', () => {
      expect(stateCodeFromName('california')).toBe('CA');
      expect(stateCodeFromName('CALIFORNIA')).toBe('CA');
    });

    it('trims whitespace', () => {
      expect(stateCodeFromName('  California  ')).toBe('CA');
    });

    it('returns null for unknown name', () => {
      expect(stateCodeFromName('Nowhere')).toBeNull();
    });

    it('returns null for non-string input', () => {
      expect(stateCodeFromName(null)).toBeNull();
      expect(stateCodeFromName(undefined)).toBeNull();
      expect(stateCodeFromName(42)).toBeNull();
    });

    it('handles multi-word state names', () => {
      expect(stateCodeFromName('New York')).toBe('NY');
      expect(stateCodeFromName('north carolina')).toBe('NC');
    });
  });

  describe('isStateCode(value)', () => {
    it('returns true for valid uppercase code', () => {
      expect(isStateCode('CA')).toBe(true);
    });

    it('returns true for valid lowercase code', () => {
      expect(isStateCode('ca')).toBe(true);
    });

    it('returns false for unknown two-letter string', () => {
      expect(isStateCode('XX')).toBe(false);
    });

    it('returns false for non-string input', () => {
      expect(isStateCode(null)).toBe(false);
      expect(isStateCode(undefined)).toBe(false);
      expect(isStateCode(42)).toBe(false);
    });
  });

  describe('allStateCodes()', () => {
    it('returns 52 codes (50 states + DC + PR)', () => {
      expect(allStateCodes()).toHaveLength(52);
    });

    it('returns codes sorted alphabetically', () => {
      const codes = allStateCodes();
      const sorted = [...codes].sort();
      expect(codes).toEqual(sorted);
    });

    it('returns a frozen array', () => {
      expect(Object.isFrozen(allStateCodes())).toBe(true);
    });

    it('returns the same reference on each call (cached)', () => {
      expect(allStateCodes()).toBe(allStateCodes());
    });
  });

  describe('allStates()', () => {
    it('returns 52 {code, name} pairs', () => {
      const states = allStates();
      expect(states).toHaveLength(52);
      expect(states[0]).toHaveProperty('code');
      expect(states[0]).toHaveProperty('name');
    });

    it('returns pairs sorted by name', () => {
      const states = allStates();
      const names = states.map(s => s.name);
      const sorted = [...names].sort((a, b) => a.localeCompare(b));
      expect(names).toEqual(sorted);
    });

    it('returns a frozen array of frozen objects', () => {
      const states = allStates();
      expect(Object.isFrozen(states)).toBe(true);
      expect(Object.isFrozen(states[0])).toBe(true);
    });
  });
});

describe('Price', () => {
  describe('static instances', () => {
    it('exposes INEXPENSIVE with expected fields', () => {
      expect(Price.INEXPENSIVE).toEqual({
        key: 'PRICE_LEVEL_INEXPENSIVE', numeric: 1, label: 'Inexpensive', cssClass: 'inexpensive'
      });
    });

    it('exposes MODERATE with expected fields', () => {
      expect(Price.MODERATE).toEqual({
        key: 'PRICE_LEVEL_MODERATE', numeric: 2, label: 'Moderate', cssClass: 'moderate'
      });
    });

    it('exposes EXPENSIVE with expected fields', () => {
      expect(Price.EXPENSIVE).toEqual({
        key: 'PRICE_LEVEL_EXPENSIVE', numeric: 3, label: 'Expensive', cssClass: 'expensive'
      });
    });

    it('exposes UNKNOWN sentinel', () => {
      expect(Price.UNKNOWN).toEqual({
        key: null, numeric: 0, label: 'N/A', cssClass: ''
      });
    });

    it('freezes every instance', () => {
      expect(Object.isFrozen(Price.INEXPENSIVE)).toBe(true);
      expect(Object.isFrozen(Price.MODERATE)).toBe(true);
      expect(Object.isFrozen(Price.EXPENSIVE)).toBe(true);
      expect(Object.isFrozen(Price.UNKNOWN)).toBe(true);
    });
  });

  describe('fromKey(key)', () => {
    it('returns singleton instance by reference equality', () => {
      expect(Price.fromKey('PRICE_LEVEL_MODERATE')).toBe(Price.MODERATE);
      expect(Price.fromKey('PRICE_LEVEL_INEXPENSIVE')).toBe(Price.INEXPENSIVE);
      expect(Price.fromKey('PRICE_LEVEL_EXPENSIVE')).toBe(Price.EXPENSIVE);
    });

    it('returns UNKNOWN for bogus key', () => {
      expect(Price.fromKey('bogus')).toBe(Price.UNKNOWN);
    });

    it('returns UNKNOWN for non-string input', () => {
      expect(Price.fromKey(null)).toBe(Price.UNKNOWN);
      expect(Price.fromKey(undefined)).toBe(Price.UNKNOWN);
      expect(Price.fromKey(42)).toBe(Price.UNKNOWN);
    });
  });

  describe('fromNumeric(n)', () => {
    it('returns singleton instance by reference equality', () => {
      expect(Price.fromNumeric(1)).toBe(Price.INEXPENSIVE);
      expect(Price.fromNumeric(2)).toBe(Price.MODERATE);
      expect(Price.fromNumeric(3)).toBe(Price.EXPENSIVE);
    });

    it('returns UNKNOWN for 0', () => {
      expect(Price.fromNumeric(0)).toBe(Price.UNKNOWN);
    });

    it('returns UNKNOWN for out-of-range numbers', () => {
      expect(Price.fromNumeric(4)).toBe(Price.UNKNOWN);
      expect(Price.fromNumeric(-1)).toBe(Price.UNKNOWN);
    });

    it('returns UNKNOWN for non-numeric input', () => {
      expect(Price.fromNumeric('abc')).toBe(Price.UNKNOWN);
      expect(Price.fromNumeric(null)).toBe(Price.UNKNOWN);
    });
  });

  describe('average(prices)', () => {
    it('returns EXPENSIVE for [MODERATE, EXPENSIVE] (avg 2.5 → EXPENSIVE under <2.5 rule)', () => {
      // Boundary: rule is avg<1.5 → INEXPENSIVE, avg<2.5 → MODERATE, else EXPENSIVE.
      // 2.5 is NOT <2.5, so it falls into EXPENSIVE.
      expect(Price.average([Price.MODERATE, Price.EXPENSIVE])).toBe(Price.EXPENSIVE);
    });

    it('returns MODERATE for [INEXPENSIVE, EXPENSIVE] (avg 2.0)', () => {
      expect(Price.average([Price.INEXPENSIVE, Price.EXPENSIVE])).toBe(Price.MODERATE);
    });

    it('returns INEXPENSIVE for all-INEXPENSIVE input', () => {
      expect(Price.average([Price.INEXPENSIVE, Price.INEXPENSIVE])).toBe(Price.INEXPENSIVE);
    });

    it('returns UNKNOWN for empty array', () => {
      expect(Price.average([])).toBe(Price.UNKNOWN);
    });

    it('returns UNKNOWN for all-UNKNOWN input', () => {
      expect(Price.average([Price.UNKNOWN, Price.UNKNOWN])).toBe(Price.UNKNOWN);
    });

    it('ignores UNKNOWN entries when averaging', () => {
      expect(Price.average([Price.MODERATE, Price.UNKNOWN])).toBe(Price.MODERATE);
    });

    it('returns UNKNOWN for non-array input', () => {
      expect(Price.average(null)).toBe(Price.UNKNOWN);
      expect(Price.average('foo')).toBe(Price.UNKNOWN);
    });
  });

  describe('averageFromNumeric(n)', () => {
    it('maps <1.5 → INEXPENSIVE', () => {
      expect(Price.averageFromNumeric(1.0)).toBe(Price.INEXPENSIVE);
      expect(Price.averageFromNumeric(1.49)).toBe(Price.INEXPENSIVE);
    });

    it('maps [1.5, 2.5) → MODERATE', () => {
      expect(Price.averageFromNumeric(1.5)).toBe(Price.MODERATE);
      expect(Price.averageFromNumeric(2.49)).toBe(Price.MODERATE);
    });

    it('maps >=2.5 → EXPENSIVE', () => {
      expect(Price.averageFromNumeric(2.5)).toBe(Price.EXPENSIVE);
      expect(Price.averageFromNumeric(3.0)).toBe(Price.EXPENSIVE);
    });

    it('returns UNKNOWN for 0 or negative', () => {
      expect(Price.averageFromNumeric(0)).toBe(Price.UNKNOWN);
      expect(Price.averageFromNumeric(-1)).toBe(Price.UNKNOWN);
    });
  });

  describe('all()', () => {
    it('returns 3 instances ordered by numeric', () => {
      const all = Price.all();
      expect(all).toHaveLength(3);
      expect(all[0]).toBe(Price.INEXPENSIVE);
      expect(all[1]).toBe(Price.MODERATE);
      expect(all[2]).toBe(Price.EXPENSIVE);
    });

    it('excludes UNKNOWN', () => {
      expect(Price.all()).not.toContain(Price.UNKNOWN);
    });

    it('returns a frozen array', () => {
      expect(Object.isFrozen(Price.all())).toBe(true);
    });
  });
});

import { describe, expect, it } from 'vitest';
import {
  parseNumber,
  roundToTwoDecimals,
  clamp,
  roundAndClamp,
  toFixedScore,
} from '../src/lib/math';

describe('parseNumber', () => {
  it('parses valid integers', () => {
    expect(parseNumber('42')).toBe(42);
    expect(parseNumber('0')).toBe(0);
    expect(parseNumber('-5')).toBe(-5);
  });

  it('parses valid decimals', () => {
    expect(parseNumber('3.14')).toBe(3.14);
    expect(parseNumber('0.005')).toBe(0.005);
  });

  it('trims whitespace', () => {
    expect(parseNumber('  7  ')).toBe(7);
    expect(parseNumber('\t10\n')).toBe(10);
  });

  it('returns null for empty/undefined/null', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('   ')).toBeNull();
    expect(parseNumber(undefined)).toBeNull();
    expect(parseNumber(null)).toBeNull();
  });

  it('returns null for non-numeric strings', () => {
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('12abc')).toBeNull();
    expect(parseNumber('NaN')).toBeNull();
  });

  it('returns null for Infinity', () => {
    expect(parseNumber('Infinity')).toBeNull();
    expect(parseNumber('-Infinity')).toBeNull();
  });

  it('handles scientific notation', () => {
    expect(parseNumber('1e2')).toBe(100);
  });
});

describe('roundToTwoDecimals', () => {
  it('rounds standard values', () => {
    expect(roundToTwoDecimals(1.234)).toBe(1.23);
    expect(roundToTwoDecimals(1.235)).toBe(1.24);
    expect(roundToTwoDecimals(1.005)).toBe(1.01);
  });

  it('handles integers', () => {
    expect(roundToTwoDecimals(5)).toBe(5);
  });

  it('handles negative numbers', () => {
    expect(roundToTwoDecimals(-1.234)).toBe(-1.23);
    expect(roundToTwoDecimals(-1.236)).toBe(-1.24);
  });

  it('handles zero', () => {
    expect(roundToTwoDecimals(0)).toBe(0);
  });
});

describe('clamp', () => {
  it('clamps below min', () => {
    expect(clamp(-5, 0, 100)).toBe(0);
  });

  it('clamps above max', () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it('passes through values in range', () => {
    expect(clamp(50, 0, 100)).toBe(50);
  });

  it('handles value at boundary', () => {
    expect(clamp(0, 0, 100)).toBe(0);
    expect(clamp(100, 0, 100)).toBe(100);
  });
});

describe('roundAndClamp', () => {
  it('rounds then clamps', () => {
    expect(roundAndClamp(25.456, 0, 25)).toBe(25);
    expect(roundAndClamp(25.004, 0, 25)).toBe(25);
  });

  it('clamps negative to zero', () => {
    expect(roundAndClamp(-0.5, 0, 25)).toBe(0);
  });
});

describe('toFixedScore', () => {
  it('formats with two decimal places', () => {
    expect(toFixedScore(5)).toBe('5.00');
    expect(toFixedScore(5.1)).toBe('5.10');
    expect(toFixedScore(5.126)).toBe('5.13');
    expect(toFixedScore(0)).toBe('0.00');
  });

  it('handles large scores', () => {
    expect(toFixedScore(100)).toBe('100.00');
    expect(toFixedScore(99.995)).toBe('100.00');
  });
});

/* ---------- containsManualGradeTag ---------- */

import { containsManualGradeTag } from '../src/lib/text';

describe('containsManualGradeTag', () => {
  const TAG = '[TA Graded]';

  it('detects [TA Graded] tag', () => {
    expect(containsManualGradeTag('[TA Graded]', TAG)).toBe(true);
  });

  it('is case insensitive', () => {
    expect(containsManualGradeTag('[ta graded]', TAG)).toBe(true);
    expect(containsManualGradeTag('[TA GRADED]', TAG)).toBe(true);
    expect(containsManualGradeTag('[Ta Graded]', TAG)).toBe(true);
  });

  it('finds tag embedded in other text', () => {
    expect(containsManualGradeTag('Some feedback [TA Graded] more notes', TAG)).toBe(true);
  });

  it('returns false for no tag', () => {
    expect(containsManualGradeTag('Regular feedback', TAG)).toBe(false);
    expect(containsManualGradeTag('', TAG)).toBe(false);
    expect(containsManualGradeTag(null, TAG)).toBe(false);
    expect(containsManualGradeTag(undefined, TAG)).toBe(false);
  });

  it('returns false for partial matches', () => {
    expect(containsManualGradeTag('TA Graded', TAG)).toBe(false);  // no brackets
    expect(containsManualGradeTag('[TA Grade]', TAG)).toBe(false);  // wrong word
  });

  it('works with custom tags', () => {
    expect(containsManualGradeTag('[Prof Graded] notes', '[Prof Graded]')).toBe(true);
    expect(containsManualGradeTag('[prof graded] notes', '[Prof Graded]')).toBe(true);
    expect(containsManualGradeTag('[TA Graded]', '[Prof Graded]')).toBe(false);
  });

  it('returns false when tag is empty', () => {
    expect(containsManualGradeTag('[TA Graded]', '')).toBe(false);
  });
});

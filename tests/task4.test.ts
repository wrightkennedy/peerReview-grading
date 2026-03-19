import { describe, expect, it } from 'vitest';
import { computeBellCurveStats, calculateBellCurveShift, processTask4 } from '../src/processors/task4';
import type { CsvRow, CsvTable, Task4Config } from '../src/types';
import { parseCsvText } from '../src/lib/csvCore';

/* ---------- helpers ---------- */

const CSV_META = {
  delimiter: ',',
  newline: '\n' as const,
  hasBom: false,
  quoteChar: '"',
};

function makeGradebook(students: { username: string; score: string; feedback?: string }[]): CsvTable {
  const ASSIGN = 'Grade [Total Pts]';
  const FEEDBACK = 'Feedback to Learner';
  return {
    headers: ['Last Name', 'First Name', 'Username', 'Student ID', ASSIGN, FEEDBACK],
    rows: students.map((s, i) => ({
      'Last Name': 'Student',
      'First Name': `S${i}`,
      Username: s.username,
      'Student ID': `S00${i + 1}`,
      [ASSIGN]: s.score,
      [FEEDBACK]: s.feedback ?? '',
    })),
    formatMeta: CSV_META,
    sourceName: 'gradebook.csv',
  };
}

function baseConfig(overrides: Partial<Task4Config> = {}): Task4Config {
  return {
    assignmentField: 'Grade [Total Pts]',
    feedbackField: 'Feedback to Learner',
    feedbackWriteMode: 'append',
    totalPointsPossible: 25,
    curveMode: 'fixed_points',
    curvePoints: 0,
    curvePercent: 0,
    bellCurveTargetMean: 0,
    skipZeros: true,
    skipNoSubmission: true,
    allowExceedMax: false,
    includeCurveFeedback: true,
    feedbackDisplay: 'points',
    ...overrides,
  };
}

function extractScores(result: ReturnType<typeof processTask4>, field: string): string[] {
  const mainCsv = result.files.find(
    (f) => f.fileName.endsWith('.csv') && !f.fileName.includes('Issues'),
  );
  if (!mainCsv) throw new Error('No main CSV in output');
  const table = parseCsvText(mainCsv.content, 'output.csv');
  return table.rows.map((row) => row[field] ?? '');
}

/* ---------- fixed points ---------- */

describe('Task 4: fixed points curve', () => {
  const ASSIGN = 'Grade [Total Pts]';

  it('adds fixed points to all eligible students', () => {
    const gb = makeGradebook([
      { username: 'alice', score: '20' },
      { username: 'bob', score: '18' },
    ]);
    const config = baseConfig({ curvePoints: 2 });
    const result = processTask4(gb, config);

    expect(result.errors).toEqual([]);
    expect(result.preview.updatedRows).toBe(2);
    const scores = extractScores(result, ASSIGN);
    expect(scores).toEqual(['22.00', '20.00']);
  });

  it('clamps to max when exceed not allowed', () => {
    const gb = makeGradebook([{ username: 'alice', score: '24' }]);
    const config = baseConfig({ curvePoints: 3 });
    const result = processTask4(gb, config);

    expect(extractScores(result, ASSIGN)).toEqual(['25.00']);
  });

  it('allows exceeding max when permitted', () => {
    const gb = makeGradebook([{ username: 'alice', score: '24' }]);
    const config = baseConfig({ curvePoints: 3, allowExceedMax: true });
    const result = processTask4(gb, config);

    expect(extractScores(result, ASSIGN)).toEqual(['27.00']);
  });

  it('skips zeros by default', () => {
    const gb = makeGradebook([
      { username: 'alice', score: '20' },
      { username: 'bob', score: '0' },
    ]);
    const config = baseConfig({ curvePoints: 2 });
    const result = processTask4(gb, config);

    expect(result.preview.updatedRows).toBe(1);
    expect(result.preview.skippedRows).toBe(1);
    const scores = extractScores(result, ASSIGN);
    expect(scores[0]).toBe('22.00');
    expect(scores[1]).toBe('0');
  });

  it('curves zeros when skip zeros is off', () => {
    const gb = makeGradebook([{ username: 'bob', score: '0' }]);
    const config = baseConfig({ curvePoints: 2, skipZeros: false });
    const result = processTask4(gb, config);

    expect(result.preview.updatedRows).toBe(1);
    expect(extractScores(result, ASSIGN)).toEqual(['2.00']);
  });

  it('skips Needs Grading records by default', () => {
    const gb = makeGradebook([
      { username: 'alice', score: '20' },
      { username: 'bob', score: 'Needs Grading' },
    ]);
    const config = baseConfig({ curvePoints: 2 });
    const result = processTask4(gb, config);

    expect(result.preview.updatedRows).toBe(1);
    const scores = extractScores(result, ASSIGN);
    expect(scores[0]).toBe('22.00');
    expect(scores[1]).toBe('Needs Grading');
  });

  it('skips empty score records by default', () => {
    const gb = makeGradebook([
      { username: 'alice', score: '20' },
      { username: 'bob', score: '' },
    ]);
    const config = baseConfig({ curvePoints: 2 });
    const result = processTask4(gb, config);

    expect(result.preview.updatedRows).toBe(1);
    expect(result.preview.skippedRows).toBe(1);
  });
});

/* ---------- percentage mode ---------- */

describe('Task 4: percentage curve', () => {
  const ASSIGN = 'Grade [Total Pts]';

  it('calculates curve from percentage of total points', () => {
    const gb = makeGradebook([{ username: 'alice', score: '20' }]);
    const config = baseConfig({
      curveMode: 'percentage',
      curvePercent: 10,
      totalPointsPossible: 25,
    });
    const result = processTask4(gb, config);

    // 10% of 25 = 2.5 pts
    expect(extractScores(result, ASSIGN)).toEqual(['22.50']);
  });
});

/* ---------- bell curve mode ---------- */

describe('Task 4: bell curve', () => {
  it('computes correct statistics', () => {
    const gb = makeGradebook([
      { username: 'alice', score: '20' },
      { username: 'bob', score: '18' },
      { username: 'charlie', score: '22' },
      { username: 'diana', score: '16' },
    ]);
    const config = baseConfig();
    const stats = computeBellCurveStats(gb.rows, config);

    expect(stats.count).toBe(4);
    expect(stats.mean).toBe(19);
    expect(stats.median).toBe(19);
    expect(stats.min).toBe(16);
    expect(stats.max).toBe(22);
    expect(stats.stdDev).toBeGreaterThan(0);
  });

  it('always excludes zeros and Needs Grading from statistics', () => {
    const gb = makeGradebook([
      { username: 'alice', score: '20' },
      { username: 'bob', score: '0' },
      { username: 'charlie', score: '22' },
      { username: 'diana', score: 'Needs Grading' },
    ]);
    const config = baseConfig({ skipZeros: false, skipNoSubmission: false });
    const stats = computeBellCurveStats(gb.rows, config);

    expect(stats.count).toBe(2);
    expect(stats.mean).toBe(21);
  });

  it('calculates positive shift when target is above mean', () => {
    const stats = { count: 4, mean: 19, median: 19, stdDev: 2.24, min: 16, max: 22 };
    const shift = calculateBellCurveShift(stats, 22);
    expect(shift).toBe(3);
  });

  it('returns zero shift when target is below mean (guardrail)', () => {
    const stats = { count: 4, mean: 19, median: 19, stdDev: 2.24, min: 16, max: 22 };
    const shift = calculateBellCurveShift(stats, 15);
    expect(shift).toBe(0);
  });

  it('returns zero shift when target equals mean', () => {
    const stats = { count: 4, mean: 19, median: 19, stdDev: 2.24, min: 16, max: 22 };
    const shift = calculateBellCurveShift(stats, 19);
    expect(shift).toBe(0);
  });

  it('applies bell curve shift to grades', () => {
    const gb = makeGradebook([
      { username: 'alice', score: '20' },
      { username: 'bob', score: '18' },
      { username: 'charlie', score: '22' },
      { username: 'diana', score: '16' },
    ]);
    const config = baseConfig({
      curveMode: 'bell_curve',
      bellCurveTargetMean: 22,
    });
    const result = processTask4(gb, config);

    // mean=19, target=22, shift=3
    const ASSIGN = 'Grade [Total Pts]';
    const scores = extractScores(result, ASSIGN);
    expect(scores).toEqual(['23.00', '21.00', '25.00', '19.00']);
  });

  it('handles empty gradebook', () => {
    const gb = makeGradebook([]);
    const config = baseConfig({ curveMode: 'bell_curve', bellCurveTargetMean: 22 });
    const stats = computeBellCurveStats(gb.rows, config);
    expect(stats.count).toBe(0);
    const shift = calculateBellCurveShift(stats, 22);
    expect(shift).toBe(0);
  });
});

/* ---------- feedback ---------- */

describe('Task 4: feedback', () => {
  const FEEDBACK = 'Feedback to Learner';

  it('appends curve feedback in points format', () => {
    const gb = makeGradebook([{ username: 'alice', score: '20', feedback: 'Good work' }]);
    const config = baseConfig({ curvePoints: 2, feedbackDisplay: 'points' });
    const result = processTask4(gb, config);

    const mainCsv = result.files.find((f) => f.fileName.endsWith('.csv'));
    const table = parseCsvText(mainCsv!.content, 'out.csv');
    expect(table.rows[0][FEEDBACK]).toContain('Good work');
    expect(table.rows[0][FEEDBACK]).toContain('+2.00 points');
  });

  it('shows percentage format', () => {
    const gb = makeGradebook([{ username: 'alice', score: '20' }]);
    const config = baseConfig({ curvePoints: 2, feedbackDisplay: 'percentage' });
    const result = processTask4(gb, config);

    const mainCsv = result.files.find((f) => f.fileName.endsWith('.csv'));
    const table = parseCsvText(mainCsv!.content, 'out.csv');
    expect(table.rows[0][FEEDBACK]).toContain('+8.0%');
  });

  it('shows both format', () => {
    const gb = makeGradebook([{ username: 'alice', score: '20' }]);
    const config = baseConfig({ curvePoints: 2, feedbackDisplay: 'both' });
    const result = processTask4(gb, config);

    const mainCsv = result.files.find((f) => f.fileName.endsWith('.csv'));
    const table = parseCsvText(mainCsv!.content, 'out.csv');
    const feedback = table.rows[0][FEEDBACK];
    expect(feedback).toContain('+2.00 points');
    expect(feedback).toContain('+8.0%');
  });

  it('does not add feedback when disabled', () => {
    const gb = makeGradebook([{ username: 'alice', score: '20' }]);
    const config = baseConfig({ curvePoints: 2, includeCurveFeedback: false });
    const result = processTask4(gb, config);

    const mainCsv = result.files.find((f) => f.fileName.endsWith('.csv'));
    const table = parseCsvText(mainCsv!.content, 'out.csv');
    expect(table.rows[0][FEEDBACK]).toBe('');
  });
});

/* ---------- validation ---------- */

describe('Task 4: validation', () => {
  it('rejects missing assignment field', () => {
    const gb = makeGradebook([{ username: 'alice', score: '20' }]);
    const config = baseConfig({ assignmentField: 'NonExistentField' });
    const result = processTask4(gb, config);

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('NonExistentField');
  });

  it('rejects zero total points possible', () => {
    const gb = makeGradebook([{ username: 'alice', score: '20' }]);
    const config = baseConfig({ totalPointsPossible: 0 });
    const result = processTask4(gb, config);

    expect(result.errors.length).toBeGreaterThan(0);
  });
});

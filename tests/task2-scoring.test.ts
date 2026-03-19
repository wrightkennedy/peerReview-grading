import { describe, expect, it } from 'vitest';
import { processTask2Summary } from '../src/processors/task2';
import type { CsvRow, CsvTable, Task2SharedConfig } from '../src/types';
import { parseCsvText } from '../src/lib/csvCore';

/* ---------- helpers ---------- */

const CSV_META = {
  delimiter: ',',
  newline: '\n' as const,
  hasBom: false,
  quoteChar: '"',
};

function makeTable(headers: string[], rows: CsvRow[], name = 'test.csv'): CsvTable {
  return { headers, rows, formatMeta: CSV_META, sourceName: name };
}

/** Gradebook with a single student row. */
function gradebook(
  username: string,
  assignmentField: string,
  feedbackField: string,
): CsvTable {
  return makeTable(
    ['Last Name', 'First Name', 'Username', 'Student ID', assignmentField, feedbackField],
    [
      {
        'Last Name': 'Doe',
        'First Name': 'Jane',
        Username: username,
        'Student ID': 'S001',
        [assignmentField]: 'Needs Grading',
        [feedbackField]: '',
      },
    ],
    'gradebook.csv',
  );
}

/** Minimal config that disables most optional features. */
function baseConfig(overrides: Partial<Task2SharedConfig> = {}): Task2SharedConfig {
  return {
    chapterFilterEnabled: false,
    chapterRangeStart: 1,
    chapterRangeEnd: 30,
    chapterValue: '',
    summaryChapterField: 'Chapter',
    gradebookJoinField: 'Username',
    summaryJoinField: 'Username',
    assignmentField: 'Grade [Total Coverage Pts]',
    gradebookFeedbackField: 'Feedback to Learner',
    feedbackSourceField: 'PeerFeedback',
    feedbackWriteMode: 'overwrite',
    addUniversalFeedback: false,
    universalFeedback: '',
    onlyUpdateNeedsGrading: true,
    minReviews: 1,
    includeFeedbackWhenBelowMinReviews: false,
    reviewsCompletedField: 'ReviewsCompleted',
    fairnessCountField: 'FairnessNoCount',
    includeFairnessFlaggedReviewsInScoreCalculation: true,
    integrityField: 'IntegrityFlagCount',
    rangeFlagField: '',
    rangeExclusionEnabled: false,
    rangeThreshold: 4,
    rangeScoreFields: [],
    integrityNotesField: '',
    taField: '',
    sectionField: '',
    scoringMode: 'average_overall',
    rubricComponents: [],
    rubricAssignmentPoints: 25,
    overallScoreField: 'AvgScoreOverall',
    overallScoreTotalPoints: 10,
    overallAssignmentPoints: 25,
    scaleOverallScore: true,
    xwalkTaJoinField: 'Title',
    xwalkTaUsernameField: 'Username',
    xwalkTaField: 'TAEmail',
    xwalkSectionField: 'Section',
    enableManualJoinOverrides: false,
    manualJoinIdentifierField: 'Student ID',
    manualJoinOverridesText: '',
    curveEnabled: false,
    curvePoints: 0,
    curveAllowExceedMax: false,
    ...overrides,
  };
}

/** Build a summary table with a single row for a student. */
function summaryRow(username: string, fields: Record<string, string>): CsvTable {
  const allFields: Record<string, string> = {
    Username: username,
    ReviewsCompleted: '3',
    FairnessNoCount: '0',
    IntegrityFlagCount: '0',
    PeerFeedback: '',
    ...fields,
  };
  return makeTable(Object.keys(allFields), [allFields], 'summary.csv');
}

/** Extract the score written to the assignment field. */
function extractScore(result: ReturnType<typeof processTask2Summary>, field: string): string {
  const mainCsv = result.files.find(
    (f) => f.fileName.endsWith('.csv') && !f.fileName.includes('Issues'),
  );
  if (!mainCsv) throw new Error('No main CSV in output');
  const table = parseCsvText(mainCsv.content, 'output.csv');
  return table.rows[0]?.[field] ?? '';
}

function extractIssueReasons(result: ReturnType<typeof processTask2Summary>): string[] {
  return result.issueRows.map((row) => row.Reason);
}

/* ---------- tests ---------- */

describe('computeScore: overall average mode', () => {
  const ASSIGN = 'Grade [Total Coverage Pts]';
  const FEEDBACK = 'Feedback to Learner';

  it('scales overall score to assignment points', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', { AvgScoreOverall: '8' });
    const config = baseConfig();

    const result = processTask2Summary(gb, summary, null, config);
    expect(result.errors).toEqual([]);
    // 8/10 * 25 = 20.00
    expect(extractScore(result, ASSIGN)).toBe('20.00');
  });

  it('clamps to assignment max', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', { AvgScoreOverall: '12' });
    const config = baseConfig();

    const result = processTask2Summary(gb, summary, null, config);
    // 12/10 * 25 = 30, clamped to 25
    expect(extractScore(result, ASSIGN)).toBe('25.00');
  });

  it('handles zero score', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', { AvgScoreOverall: '0' });
    const config = baseConfig();

    const result = processTask2Summary(gb, summary, null, config);
    expect(extractScore(result, ASSIGN)).toBe('0.00');
  });

  it('returns null/issue for non-numeric score', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', { AvgScoreOverall: '' });
    const config = baseConfig();

    const result = processTask2Summary(gb, summary, null, config);
    expect(extractIssueReasons(result)).toContain('missing-or-invalid-score');
  });

  it('uses raw overall score when scaling disabled', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', { AvgScoreOverall: '18.5' });
    const config = baseConfig({ scaleOverallScore: false });

    const result = processTask2Summary(gb, summary, null, config);
    expect(extractScore(result, ASSIGN)).toBe('18.50');
  });
});

describe('computeScore: rubric weighted mode', () => {
  const ASSIGN = 'Grade [Total Pts]';
  const FEEDBACK = 'Feedback to Learner';

  it('calculates weighted rubric score', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', {
      AvgScore1: '8',
      AvgScore2: '9',
    });
    const config = baseConfig({
      assignmentField: ASSIGN,
      scoringMode: 'rubric_weighted',
      rubricComponents: [
        { field: 'AvgScore1', totalPoints: 10, weightPercent: 60 },
        { field: 'AvgScore2', totalPoints: 10, weightPercent: 40 },
      ],
      rubricAssignmentPoints: 25,
    });

    const result = processTask2Summary(gb, summary, null, config);
    expect(result.errors).toEqual([]);
    // weighted = (8/10)*0.6 + (9/10)*0.4 = 0.48 + 0.36 = 0.84
    // score = 0.84 * 25 = 21.00
    expect(extractScore(result, ASSIGN)).toBe('21.00');
  });

  it('clamps rubric score to assignment max', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', {
      AvgScore1: '15',
    });
    const config = baseConfig({
      assignmentField: ASSIGN,
      scoringMode: 'rubric_weighted',
      rubricComponents: [
        { field: 'AvgScore1', totalPoints: 10, weightPercent: 100 },
      ],
      rubricAssignmentPoints: 25,
    });

    const result = processTask2Summary(gb, summary, null, config);
    // 15/10 = 1.5 * 25 = 37.5, clamped to 25
    expect(extractScore(result, ASSIGN)).toBe('25.00');
  });

  it('returns issue when a rubric field is missing', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', {
      AvgScore1: '8',
      AvgScore2: '',
    });
    const config = baseConfig({
      assignmentField: ASSIGN,
      scoringMode: 'rubric_weighted',
      rubricComponents: [
        { field: 'AvgScore1', totalPoints: 10, weightPercent: 50 },
        { field: 'AvgScore2', totalPoints: 10, weightPercent: 50 },
      ],
      rubricAssignmentPoints: 25,
    });

    const result = processTask2Summary(gb, summary, null, config);
    expect(extractIssueReasons(result)).toContain('missing-or-invalid-score');
  });
});

describe('curve logic', () => {
  const ASSIGN = 'Grade [Total Pts]';
  const FEEDBACK = 'Feedback to Learner';

  it('adds curve points to final score', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', { AvgScoreOverall: '8' });
    const config = baseConfig({
      assignmentField: ASSIGN,
      curveEnabled: true,
      curvePoints: 2,
    });

    const result = processTask2Summary(gb, summary, null, config);
    // 8/10 * 25 = 20 + 2 = 22
    expect(extractScore(result, ASSIGN)).toBe('22.00');
  });

  it('clamps curved score to max when exceed not allowed', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', { AvgScoreOverall: '10' });
    const config = baseConfig({
      assignmentField: ASSIGN,
      curveEnabled: true,
      curvePoints: 5,
      curveAllowExceedMax: false,
    });

    const result = processTask2Summary(gb, summary, null, config);
    // 10/10 * 25 = 25 + 5 = 30, clamped to 25
    expect(extractScore(result, ASSIGN)).toBe('25.00');
  });

  it('allows curved score to exceed max when permitted', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', { AvgScoreOverall: '10' });
    const config = baseConfig({
      assignmentField: ASSIGN,
      curveEnabled: true,
      curvePoints: 3,
      curveAllowExceedMax: true,
    });

    const result = processTask2Summary(gb, summary, null, config);
    // 10/10 * 25 = 25 + 3 = 28 (bonus territory)
    expect(extractScore(result, ASSIGN)).toBe('28.00');
  });

  it('does not apply curve when disabled', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', { AvgScoreOverall: '8' });
    const config = baseConfig({
      assignmentField: ASSIGN,
      curveEnabled: false,
      curvePoints: 5,
    });

    const result = processTask2Summary(gb, summary, null, config);
    // Curve disabled: 8/10 * 25 = 20
    expect(extractScore(result, ASSIGN)).toBe('20.00');
  });

  it('does not apply curve to excluded students (below min reviews)', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', {
      AvgScoreOverall: '8',
      ReviewsCompleted: '1',
    });
    const config = baseConfig({
      assignmentField: ASSIGN,
      minReviews: 2,
      curveEnabled: true,
      curvePoints: 3,
    });

    const result = processTask2Summary(gb, summary, null, config);
    // Student excluded, no score written
    expect(extractIssueReasons(result)).toContain('below-min-reviews');
    expect(extractScore(result, ASSIGN)).toBe('Needs Grading');
  });

  it('curve with zero points has no effect', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', { AvgScoreOverall: '8' });
    const config = baseConfig({
      assignmentField: ASSIGN,
      curveEnabled: true,
      curvePoints: 0,
    });

    const result = processTask2Summary(gb, summary, null, config);
    expect(extractScore(result, ASSIGN)).toBe('20.00');
  });

  it('uses rubric max for clamping in rubric mode', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', { AvgScore1: '10' });
    const config = baseConfig({
      assignmentField: ASSIGN,
      scoringMode: 'rubric_weighted',
      rubricComponents: [
        { field: 'AvgScore1', totalPoints: 10, weightPercent: 100 },
      ],
      rubricAssignmentPoints: 25,
      curveEnabled: true,
      curvePoints: 10,
      curveAllowExceedMax: false,
    });

    const result = processTask2Summary(gb, summary, null, config);
    // 10/10 * 25 = 25 + 10 = 35, clamped to rubricAssignmentPoints = 25
    expect(extractScore(result, ASSIGN)).toBe('25.00');
  });
});

describe('fairness adjustment', () => {
  const ASSIGN = 'Grade [Total Pts]';
  const FEEDBACK = 'Feedback to Learner';

  // Note: processTask2Summary forces includeFairnessFlaggedReviewsInScoreCalculation=true
  // (summary mode override). So fairness scaling is only testable in raw mode or by
  // calling the core function directly. We test the all-unfair exclusion here since
  // it still uses this code path.

  it('routes all-unfair-reviews students to issues (not zero score)', () => {
    // In summary mode, fairness flag inclusion is forced to true, so the
    // all-unfair check won't trigger. We verify the advisory path instead.
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', {
      AvgScoreOverall: '8',
      FairnessNoCount: '3',
      ReviewsCompleted: '3',
    });
    const config = baseConfig({ assignmentField: ASSIGN });

    const result = processTask2Summary(gb, summary, null, config);
    // Summary mode forces fairness inclusion, so score should still be calculated
    // but an advisory issue should be created
    expect(result.errors).toEqual([]);
    expect(extractScore(result, ASSIGN)).toBe('20.00');
    expect(extractIssueReasons(result)).toContain('fairness-flag-present');
  });
});

describe('range exclusion', () => {
  const ASSIGN = 'Grade [Total Pts]';
  const FEEDBACK = 'Feedback to Learner';

  it('excludes students with range scores at/above threshold', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', {
      AvgScoreOverall: '8',
      RangeScore1: '5',
      RangeScore2: '2',
    });
    const config = baseConfig({
      assignmentField: ASSIGN,
      rangeExclusionEnabled: true,
      rangeThreshold: 4,
      rangeScoreFields: ['RangeScore1', 'RangeScore2'],
    });

    const result = processTask2Summary(gb, summary, null, config);
    expect(extractIssueReasons(result)).toContain('range-flag');
    expect(extractScore(result, ASSIGN)).toBe('Needs Grading');
  });

  it('includes students with range scores below threshold', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', {
      AvgScoreOverall: '8',
      RangeScore1: '3',
      RangeScore2: '2',
    });
    const config = baseConfig({
      assignmentField: ASSIGN,
      rangeExclusionEnabled: true,
      rangeThreshold: 4,
      rangeScoreFields: ['RangeScore1', 'RangeScore2'],
    });

    const result = processTask2Summary(gb, summary, null, config);
    expect(extractScore(result, ASSIGN)).toBe('20.00');
  });

  it('excludes at exact threshold boundary (>=)', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', {
      AvgScoreOverall: '8',
      RangeScore1: '4',
    });
    const config = baseConfig({
      assignmentField: ASSIGN,
      rangeExclusionEnabled: true,
      rangeThreshold: 4,
      rangeScoreFields: ['RangeScore1'],
    });

    const result = processTask2Summary(gb, summary, null, config);
    expect(extractIssueReasons(result)).toContain('range-flag');
  });

  it('does not exclude when range exclusion is disabled', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', {
      AvgScoreOverall: '8',
      RangeScore1: '10',
    });
    const config = baseConfig({
      assignmentField: ASSIGN,
      rangeExclusionEnabled: false,
      rangeThreshold: 4,
      rangeScoreFields: ['RangeScore1'],
    });

    const result = processTask2Summary(gb, summary, null, config);
    // Score should still be written
    expect(extractScore(result, ASSIGN)).toBe('20.00');
    // But an advisory range-flag issue should be created
    expect(extractIssueReasons(result)).toContain('range-flag');
  });
});

describe('minimum reviews', () => {
  const ASSIGN = 'Grade [Total Pts]';
  const FEEDBACK = 'Feedback to Learner';

  it('excludes students below minimum reviews', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', {
      AvgScoreOverall: '9',
      ReviewsCompleted: '1',
    });
    const config = baseConfig({ assignmentField: ASSIGN, minReviews: 2 });

    const result = processTask2Summary(gb, summary, null, config);
    expect(extractIssueReasons(result)).toContain('below-min-reviews');
    expect(extractScore(result, ASSIGN)).toBe('Needs Grading');
  });

  it('includes students at exactly minimum reviews', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', {
      AvgScoreOverall: '9',
      ReviewsCompleted: '2',
    });
    const config = baseConfig({ assignmentField: ASSIGN, minReviews: 2 });

    const result = processTask2Summary(gb, summary, null, config);
    expect(extractScore(result, ASSIGN)).not.toBe('Needs Grading');
  });

  it('writes feedback when below min if configured', () => {
    const gb = gradebook('student1', ASSIGN, FEEDBACK);
    const summary = summaryRow('student1', {
      AvgScoreOverall: '9',
      ReviewsCompleted: '1',
      PeerFeedback: 'Some feedback',
    });
    const config = baseConfig({
      assignmentField: ASSIGN,
      minReviews: 2,
      includeFeedbackWhenBelowMinReviews: true,
    });

    const result = processTask2Summary(gb, summary, null, config);
    expect(extractIssueReasons(result)).toContain('below-min-reviews');
    // Score not written but feedback should be
    expect(extractScore(result, ASSIGN)).toBe('Needs Grading');
    const mainCsv = result.files.find(
      (f) => f.fileName.endsWith('.csv') && !f.fileName.includes('Issues'),
    );
    const table = parseCsvText(mainCsv!.content, 'output.csv');
    expect(table.rows[0][FEEDBACK]).toContain('Some feedback');
  });
});

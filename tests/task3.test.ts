import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { processTask3, processTask3Raw } from '../src/processors/task3';
import { defaultTask3Config, defaultTask3RawConfig } from '../src/lib/defaults';
import { parseCsvText } from '../src/lib/csvCore';
import { loadSampleCsv } from './helpers';
import type { CsvTable } from '../src/types';

describe('Task 3 processor', () => {
  it('computes participation scores and creates fairness issue rows', () => {
    const gradebook = loadSampleCsv(
      'gc_HIST112-000-SPRING-2026_columns_2026-02-20-17-44-34 Peer Review.csv',
    );
    const assignments = loadSampleCsv('PeerReviewAssignments.csv');
    const xwalk = loadSampleCsv('xwalkTA.csv');

    const config = defaultTask3Config(gradebook, assignments);
    config.dueDateIsoEastern = DateTime.fromISO('2026-02-14T23:59:59', {
      zone: 'America/New_York',
    }).toISO({ suppressMilliseconds: true })!;

    const result = processTask3(gradebook, assignments, xwalk, config);

    expect(result.errors).toEqual([]);
    expect(result.preview.updatedRows).toBeGreaterThan(0);
    expect(result.files.some((file) => file.fileName.includes('Participation'))).toBe(true);
    expect(result.preview.issueRows).toBeGreaterThan(0);
  });

  it('excludes rows without Student ID and removes class-time reviews from credit', () => {
    const gradebook: CsvTable = {
      sourceName: 'gradebook.csv',
      headers: ['Student ID', 'Username', 'ch19 [Total Pts: 15 Score]', 'Feedback to Learner'],
      rows: [
        {
          'Student ID': '12345',
          Username: 'student1',
          'ch19 [Total Pts: 15 Score]': 'Needs Grading',
          'Feedback to Learner': '',
        },
        {
          'Student ID': '',
          Username: 'preview_user',
          'ch19 [Total Pts: 15 Score]': 'Needs Grading',
          'Feedback to Learner': '',
        },
      ],
      formatMeta: { delimiter: ',', newline: '\n', hasBom: false, quoteChar: '"' },
    };

    const assignments: CsvTable = {
      sourceName: 'assignments.csv',
      headers: ['ReviewerUsername', 'Chapter', 'Status', 'CompletedAt', 'Fairness'],
      rows: [
        {
          ReviewerUsername: 'student1',
          Chapter: 'ch19',
          Status: 'Completed',
          CompletedAt: '02/17/2026 08:40',
          Fairness: 'Yes',
        },
        {
          ReviewerUsername: 'student1',
          Chapter: 'ch19',
          Status: 'Completed',
          CompletedAt: '02/17/2026 10:10',
          Fairness: 'Yes',
        },
        {
          ReviewerUsername: 'student1',
          Chapter: 'ch19',
          Status: 'Completed',
          CompletedAt: '02/17/2026 11:10',
          Fairness: 'No',
        },
      ],
      formatMeta: { delimiter: ',', newline: '\n', hasBom: false, quoteChar: '"' },
    };

    const config = defaultTask3Config(gradebook, assignments);
    config.chapterFilterEnabled = false;
    config.dueDateIsoEastern = DateTime.fromISO('2026-02-20T23:59:59', {
      zone: 'America/New_York',
    }).toISO({ suppressMilliseconds: true })!;
    config.classScheduleEnabled = true;
    config.classDaysOfWeek = [2, 4];
    config.classStartTimeEastern = '08:30';
    config.classEndTimeEastern = '09:20';

    const result = processTask3(gradebook, assignments, null, config);

    expect(result.errors).toEqual([]);
    expect(result.preview.totalRows).toBe(1);
    expect(result.preview.updatedRows).toBe(1);
    expect(result.issueRows.some((row) => row.Reason === 'completed-during-class-time')).toBe(true);

    const updatedStudent = result.files
      .find((file) => file.fileName.endsWith('.csv') && file.fileName.includes('Participation'))
      ?.content ?? '';
    expect(updatedStudent.includes('5.00')).toBe(true);
    expect(updatedStudent.includes('You earned credit for 1 out of 3 reviews assigned to you.')).toBe(
      true,
    );
    expect(updatedStudent.includes('No credit earned for 1 review(s) you marked unfair.')).toBe(
      true,
    );
    expect(
      updatedStudent.includes('No credit earned for 1 review(s) completed during class time.'),
    ).toBe(true);
  });

  it('adds late penalty note in learner feedback when late credit is reduced', () => {
    const gradebook: CsvTable = {
      sourceName: 'gradebook.csv',
      headers: ['Student ID', 'Username', 'ch19 [Total Pts: 15 Score]', 'Feedback to Learner'],
      rows: [
        {
          'Student ID': '77777',
          Username: 'late_student',
          'ch19 [Total Pts: 15 Score]': 'Needs Grading',
          'Feedback to Learner': '',
        },
      ],
      formatMeta: { delimiter: ',', newline: '\n', hasBom: false, quoteChar: '"' },
    };

    const assignments: CsvTable = {
      sourceName: 'assignments.csv',
      headers: ['ReviewerUsername', 'Chapter', 'Status', 'CompletedAt', 'Fairness'],
      rows: [
        {
          ReviewerUsername: 'late_student',
          Chapter: 'ch19',
          Status: 'Completed',
          CompletedAt: '02/21/2026 10:10',
          Fairness: 'Yes',
        },
      ],
      formatMeta: { delimiter: ',', newline: '\n', hasBom: false, quoteChar: '"' },
    };

    const config = defaultTask3Config(gradebook, assignments);
    config.chapterFilterEnabled = false;
    config.classScheduleEnabled = false;
    config.assignmentPoints = 15;
    config.latePenaltyPercent = 10;
    config.dueDateIsoEastern = DateTime.fromISO('2026-02-20T23:59:59', {
      zone: 'America/New_York',
    }).toISO({ suppressMilliseconds: true })!;

    const result = processTask3(gradebook, assignments, null, config);
    expect(result.errors).toEqual([]);
    const outputText =
      result.files.find(
        (file) => file.fileName.includes('PeerReviewParticipation') && file.fileName.endsWith('.csv'),
      )?.content ?? '';
    expect(outputText.includes('Late penalty applied to 1 review(s) (10% reduction on those reviews).')).toBe(true);
  });

  it('supports Task 3 raw mode using raw completion/fairness via token crosswalk', () => {
    const gradebook: CsvTable = {
      sourceName: 'gradebook.csv',
      headers: ['Student ID', 'Username', 'ch19 [Total Pts: 15 Score]', 'Feedback to Learner'],
      rows: [
        {
          'Student ID': '88888',
          Username: 'raw_student',
          'ch19 [Total Pts: 15 Score]': 'Needs Grading',
          'Feedback to Learner': '',
        },
      ],
      formatMeta: { delimiter: ',', newline: '\n', hasBom: false, quoteChar: '"' },
    };

    const assignments: CsvTable = {
      sourceName: 'assignments.csv',
      headers: ['Token', 'ReviewerUsername', 'Chapter'],
      rows: [
        { Token: 'tok-1', ReviewerUsername: 'raw_student', Chapter: 'ch19' },
        { Token: 'tok-2', ReviewerUsername: 'raw_student', Chapter: 'ch19' },
      ],
      formatMeta: { delimiter: ',', newline: '\n', hasBom: false, quoteChar: '"' },
    };

    const raw: CsvTable = {
      sourceName: 'raw.csv',
      headers: [
        'ReviewToken',
        'Completion time',
        'Did you review the entire outline and provide a fair and reasonable assessment?',
      ],
      rows: [
        {
          ReviewToken: 'tok-1',
          'Completion time': '02/21/2026 09:10',
          'Did you review the entire outline and provide a fair and reasonable assessment?': 'Yes',
        },
        {
          ReviewToken: 'tok-2',
          'Completion time': '02/21/2026 09:11',
          'Did you review the entire outline and provide a fair and reasonable assessment?': 'No',
        },
      ],
      formatMeta: { delimiter: ',', newline: '\n', hasBom: false, quoteChar: '"' },
    };

    const config = defaultTask3Config(gradebook, assignments);
    config.chapterFilterEnabled = true;
    config.chapterValue = 'ch19';
    config.classScheduleEnabled = false;
    config.dueDateIsoEastern = DateTime.fromISO('2026-02-20T23:59:59', {
      zone: 'America/New_York',
    }).toISO({ suppressMilliseconds: true })!;
    const rawConfig = defaultTask3RawConfig(raw, assignments);

    const result = processTask3Raw(gradebook, raw, assignments, null, config, rawConfig);
    expect(result.errors).toEqual([]);
    expect(result.preview.updatedRows).toBe(1);
    expect(result.issueRows.some((row) => row.Reason === 'fairness-no-reviews')).toBe(true);
  });

  it('can assign 0 with feedback when no reviews are assigned', () => {
    const gradebook: CsvTable = {
      sourceName: 'gradebook.csv',
      headers: ['Student ID', 'Username', 'ch19 [Total Pts: 15 Score]', 'Feedback to Learner'],
      rows: [
        {
          'Student ID': '99999',
          Username: 'no_assignments_student',
          'ch19 [Total Pts: 15 Score]': 'Needs Grading',
          'Feedback to Learner': '',
        },
      ],
      formatMeta: { delimiter: ',', newline: '\n', hasBom: false, quoteChar: '"' },
    };

    const assignments: CsvTable = {
      sourceName: 'assignments.csv',
      headers: ['ReviewerUsername', 'Chapter', 'Status', 'CompletedAt', 'Fairness'],
      rows: [],
      formatMeta: { delimiter: ',', newline: '\n', hasBom: false, quoteChar: '"' },
    };

    const config = defaultTask3Config(gradebook, assignments);
    config.assignZeroWhenNoAssignedReviews = true;
    config.chapterFilterEnabled = false;
    config.classScheduleEnabled = false;

    const result = processTask3(gradebook, assignments, null, config);
    expect(result.errors).toEqual([]);
    expect(result.preview.updatedRows).toBe(1);
    expect(result.issueRows.some((row) => row.Reason === 'no-assigned-reviews')).toBe(true);

    const outputText =
      result.files.find(
        (file) =>
          file.fileName.includes('PeerReviewParticipation') && file.fileName.endsWith('.csv'),
      )?.content ?? '';
    const outputParsed = parseCsvText(outputText, 'output.csv');
    expect(outputParsed.rows[0]['ch19 [Total Pts: 15 Score]']).toBe('0');
    expect(
      outputText.includes(
        'No reviews assigned due to missing chapter notes. If you feel this is a mistake, please contact your TA.',
      ),
    ).toBe(true);
  });
});

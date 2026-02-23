import { describe, expect, it } from 'vitest';
import { processTask2Summary } from '../src/processors/task2';
import { defaultTask2SharedConfig } from '../src/lib/defaults';
import { parseCsvText } from '../src/lib/csvCore';
import { loadSampleCsv } from './helpers';

describe('Task 2 summary processor', () => {
  it('produces main output and issue files', () => {
    const gradebook = loadSampleCsv(
      'gc_HIST112-000-SPRING-2026_columns_2026-02-20-17-44-02 Reading Notes.csv',
    );
    const summary = loadSampleCsv('PeerReviewSubmissions.csv');
    const xwalk = loadSampleCsv('xwalkTA.csv');

    const config = defaultTask2SharedConfig(gradebook, summary);
    config.addUniversalFeedback = true;
    config.universalFeedback = 'Weekly peer review summary';

    const result = processTask2Summary(gradebook, summary, xwalk, config);

    expect(result.errors).toEqual([]);
    expect(result.preview.updatedRows).toBeGreaterThan(0);
    expect(result.files.some((file) => file.fileName.includes('Issues'))).toBe(true);

    const main = result.files.find(
      (file) => file.fileName.includes('PeerReviewSummary') && file.fileName.endsWith('.csv'),
    );
    expect(main).toBeDefined();

    const output = parseCsvText(main!.content, 'output.csv');
    expect(output.headers).toEqual(gradebook.headers);
    expect(output.rows.length).toBe(gradebook.rows.length);

    const issues = result.files.find(
      (file) =>
        file.fileName.includes('PeerReviewSummary_Issues') &&
        !file.fileName.includes('_Issues_') &&
        file.fileName.endsWith('.csv'),
    );
    expect(issues).toBeDefined();
    const issueTable = parseCsvText(issues!.content, 'issues.csv');
    expect(issueTable.headers).toContain('RangeScore1');
    expect(issueTable.headers).toContain('RangeScore2');
    expect(issueTable.headers).toContain('RangeScore3');
    expect(issueTable.headers).toContain('RangeScore4');
  });
});

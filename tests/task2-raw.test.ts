import { describe, expect, it } from 'vitest';
import { processTask2Raw } from '../src/processors/task2';
import { defaultTask2RawConfig, defaultTask2SharedConfig } from '../src/lib/defaults';
import { loadSampleCsv } from './helpers';

describe('Task 2 raw processor', () => {
  it('aggregates raw form records through token join path', () => {
    const gradebook = loadSampleCsv(
      'gc_HIST112-000-SPRING-2026_columns_2026-02-20-17-44-02 Reading Notes.csv',
    );
    const raw = loadSampleCsv('Chapter Notes Peer Review (HIST 112, Spring 2026)(Sheet1).csv');
    const assignments = loadSampleCsv('PeerReviewAssignments.csv');
    const ownerMap = loadSampleCsv('PeerReviewSubmissions.csv');
    const xwalk = loadSampleCsv('xwalkTA.csv');

    const sharedConfig = defaultTask2SharedConfig(gradebook, ownerMap);
    const rawConfig = defaultTask2RawConfig(raw, assignments);

    const result = processTask2Raw(
      gradebook,
      raw,
      assignments,
      ownerMap,
      xwalk,
      sharedConfig,
      rawConfig,
    );

    expect(result.errors).toEqual([]);
    expect(result.preview.updatedRows).toBeGreaterThan(0);
    expect(result.files.some((file) => file.fileName.includes('_Raw'))).toBe(true);
  });
});

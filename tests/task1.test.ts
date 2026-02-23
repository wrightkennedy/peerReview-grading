import { describe, expect, it } from 'vitest';
import { processTask1 } from '../src/processors/task1';
import { defaultTask1Config } from '../src/lib/defaults';
import { parseCsvText } from '../src/lib/csvCore';
import { loadSampleCsv } from './helpers';

describe('Task 1 processor', () => {
  it('updates Needs Grading rows with no attendance to score 0', () => {
    const gradebook = loadSampleCsv(
      'gc_HIST112-000-SPRING-2026_columns_2026-02-20-11-09-52 - Attendance + Discussion Post.csv',
    );
    const attendance = loadSampleCsv('attendance_2026-02-19.csv');

    const config = defaultTask1Config(gradebook, attendance);
    const result = processTask1(gradebook, attendance, config);

    expect(result.errors).toEqual([]);
    expect(result.preview.updatedRows).toBeGreaterThan(0);
    expect(result.files.length).toBe(2);

    const mainFile = result.files.find((file) => file.fileName.endsWith('.csv'));
    expect(mainFile).toBeDefined();

    const parsedOutput = parseCsvText(mainFile!.content, 'output.csv');
    expect(parsedOutput.headers).toEqual(gradebook.headers);
    expect(parsedOutput.rows.length).toBe(gradebook.rows.length);
  });
});

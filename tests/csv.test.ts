import { describe, expect, it } from 'vitest';
import { parseCsvText, serializeCsv } from '../src/lib/csvCore';
import { loadSampleCsv } from './helpers';

describe('CSV parsing and serialization', () => {
  it('preserves header order and row count after serialize/parse roundtrip', () => {
    const input = loadSampleCsv(
      'gc_HIST112-000-SPRING-2026_columns_2026-02-20-17-44-02 Reading Notes.csv',
    );

    const text = serializeCsv(input.headers, input.rows, input.formatMeta);
    const roundTrip = parseCsvText(text, input.sourceName);

    expect(roundTrip.headers).toEqual(input.headers);
    expect(roundTrip.rows.length).toBe(input.rows.length);
    expect(roundTrip.rows[0].Username).toBe(input.rows[0].Username);
  });

  it('detects delimiter/newline metadata', () => {
    const attendance = loadSampleCsv('attendance_2026-02-19.csv');
    expect(attendance.formatMeta.delimiter).toBe(',');
    expect(['\n', '\r\n']).toContain(attendance.formatMeta.newline);
  });
});

import type {
  CsvFormatMeta,
  CsvRow,
  CsvTable,
  FeedbackWriteMode,
  PreviewChange,
  PreviewSummary,
} from '../types';
import {
  buildFeedback,
  hasText,
  normalizePaperLink,
  normalizeForCompare,
  sanitizeFileStem,
} from '../lib/text';

export const ISSUE_HEADERS = [
  'Username',
  'GradebookIdentifier',
  'Reason',
  'Details',
  'Notes',
  'PaperKey',
  'PaperLink',
  'ReviewsCompleted',
  'RangeFlag',
  'RangeScore1',
  'RangeScore2',
  'RangeScore3',
  'RangeScore4',
  'IntegrityFlagCount',
  'IntegrityNotes',
  'PeerFeedback',
  'TAEmail',
  'Section',
];

export function cloneRows(rows: CsvRow[]): CsvRow[] {
  return rows.map((row) => ({ ...row }));
}

export function createIssueRow(data: {
  username: string;
  gradebookIdentifier?: string;
  reason: string;
  details: string;
  notes?: string;
  paperKey?: string;
  paperLink?: string;
  reviewsCompleted?: string;
  rangeFlag?: string;
  rangeScore1?: string;
  rangeScore2?: string;
  rangeScore3?: string;
  rangeScore4?: string;
  integrityFlagCount?: string;
  integrityNotes?: string;
  peerFeedback?: string;
  taEmail?: string;
  section?: string;
}): CsvRow {
  return {
    Username: data.username,
    GradebookIdentifier: data.gradebookIdentifier ?? '',
    Reason: data.reason,
    Details: data.details,
    Notes: data.notes ?? '',
    PaperKey: data.paperKey ?? '',
    PaperLink: normalizePaperLink(data.paperLink),
    ReviewsCompleted: data.reviewsCompleted ?? '',
    RangeFlag: data.rangeFlag ?? '',
    RangeScore1: data.rangeScore1 ?? '',
    RangeScore2: data.rangeScore2 ?? '',
    RangeScore3: data.rangeScore3 ?? '',
    RangeScore4: data.rangeScore4 ?? '',
    IntegrityFlagCount: data.integrityFlagCount ?? '',
    IntegrityNotes: data.integrityNotes ?? '',
    PeerFeedback: data.peerFeedback ?? '',
    TAEmail: data.taEmail ?? '',
    Section: data.section ?? '',
  };
}

export function emptyPreview(totalRows: number): PreviewSummary {
  return {
    totalRows,
    updatedRows: 0,
    skippedRows: 0,
    issueRows: 0,
    issuesByReason: {},
    sampleChanges: [],
  };
}

export function trackChange(
  list: PreviewChange[],
  change: PreviewChange,
  sampleLimit = 12,
): void {
  if (list.length >= sampleLimit) {
    return;
  }
  list.push(change);
}

export function writeFeedbackField(
  currentValue: string,
  newValue: string,
  mode: FeedbackWriteMode,
): string {
  return buildFeedback(currentValue, newValue, mode);
}

export function makeTable(
  sourceName: string,
  headers: string[],
  rows: CsvRow[],
  formatMeta: CsvFormatMeta,
): CsvTable {
  return {
    sourceName,
    headers,
    rows,
    formatMeta,
  };
}

export function makeIssueTable(
  sourceName: string,
  rows: CsvRow[],
  formatMeta: CsvFormatMeta,
): CsvTable {
  return makeTable(sourceName, ISSUE_HEADERS, rows, {
    ...formatMeta,
    delimiter: ',',
  });
}

export function issueTableByTa(
  sourceName: string,
  rows: CsvRow[],
  formatMeta: CsvFormatMeta,
): Map<string, CsvTable> {
  const grouped = new Map<string, CsvRow[]>();

  for (const row of rows) {
    const ta = row.TAEmail?.trim() || 'Unassigned';
    const bucket = grouped.get(ta);
    if (bucket) {
      bucket.push(row);
    } else {
      grouped.set(ta, [row]);
    }
  }

  const result = new Map<string, CsvTable>();
  for (const [ta, taRows] of grouped.entries()) {
    const safeTa = ta.replace(/[^a-zA-Z0-9._-]+/g, '_');
    result.set(
      ta,
      makeIssueTable(`${sourceName}_Issues_${safeTa}.csv`, taRows, formatMeta),
    );
  }

  return result;
}

export function keyForRow(row: CsvRow): string {
  return row.Username || row['Student ID'] || row['Last Name'] || 'row';
}

export function createMainOutputName(
  sourceName: string,
  suffix: string,
): string {
  return `${sanitizeFileStem(sourceName)}${suffix}.csv`;
}

export function createAuditName(sourceName: string, suffix: string): string {
  return `${sanitizeFileStem(sourceName)}${suffix}_Audit.json`;
}

export function hasStudentId(row: CsvRow): boolean {
  return hasText(row['Student ID']);
}

export function gradebookRowsWithStudentId(rows: CsvRow[]): CsvRow[] {
  return rows.filter((row) => hasStudentId(row));
}

export function boolToText(value: boolean): string {
  return value ? 'true' : 'false';
}

export function normalizeReason(reason: string): string {
  const normalized = normalizeForCompare(reason);
  return normalized || 'unknown';
}

export function parseManualJoinOverrides(text: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  for (const line of lines) {
    const parts = line.includes('\t') ? line.split('\t') : line.split(',');
    if (parts.length < 2) {
      continue;
    }
    const source = normalizeForCompare(parts[0]);
    const target = parts.slice(1).join(',').trim();
    if (!source || !target) {
      continue;
    }
    map.set(source, target);
  }

  return map;
}

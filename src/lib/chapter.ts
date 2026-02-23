import { normalizeForCompare } from './text';

export function findFirstTotalPointsField(headers: string[]): string {
  return headers.find((header) => header.includes('Total Pts')) ?? '';
}

export function extractChapterToken(value: string): string {
  const match = value.match(/\bch(\d{2})\b/i);
  if (!match) {
    return '';
  }
  return `ch${match[1]}`.toLowerCase();
}

export function isChapterInRange(
  chapterToken: string,
  start: number,
  end: number,
): boolean {
  const numeric = Number(chapterToken.replace(/^ch/i, ''));
  if (!Number.isFinite(numeric)) {
    return false;
  }
  return numeric >= start && numeric <= end;
}

export function detectChapterFromAssignmentField(
  assignmentFieldName: string,
  start: number,
  end: number,
): string {
  const chapter = extractChapterToken(assignmentFieldName);
  if (!chapter) {
    return '';
  }
  return isChapterInRange(chapter, start, end) ? chapter : '';
}

export function matchesChapter(value: string | undefined, chapterToken: string): boolean {
  if (!chapterToken) {
    return true;
  }

  return normalizeForCompare(value) === normalizeForCompare(chapterToken);
}

export function deriveChapterFromPaperKey(paperKey: string | undefined): string {
  const raw = paperKey ?? '';
  const match = raw.match(/^(ch\d{2})_/i);
  if (!match) {
    return '';
  }
  return match[1].toLowerCase();
}

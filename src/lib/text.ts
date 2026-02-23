export function normalizeForCompare(value: string | undefined | null): string {
  return (value ?? '').trim().toLowerCase();
}

export function equalsNormalized(
  value: string | undefined | null,
  expected: string,
): boolean {
  return normalizeForCompare(value) === normalizeForCompare(expected);
}

export function isTruthyText(value: string | undefined | null): boolean {
  const normalized = normalizeForCompare(value);
  return normalized === 'true' || normalized === 'yes' || normalized === '1';
}

export function isNeedsGrading(value: string | undefined | null): boolean {
  return equalsNormalized(value, 'Needs Grading');
}

export function isPresent(value: string | undefined | null): boolean {
  return equalsNormalized(value, 'Present');
}

export function hasText(value: string | undefined | null): boolean {
  return (value ?? '').trim().length > 0;
}

export function safeCsvCell(value: string | undefined): string {
  return value ?? '';
}

export function buildFeedback(
  existingText: string,
  newText: string,
  mode: 'append' | 'overwrite',
): string {
  if (mode === 'overwrite') {
    return newText;
  }

  const existing = existingText.trim();
  const incoming = newText.trim();
  if (!existing) {
    return incoming;
  }
  if (!incoming) {
    return existing;
  }
  return `${existing}<br><br>${incoming}`;
}

export function sanitizeFileStem(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/, '');
  return withoutExtension.replace(/[^a-zA-Z0-9._-]+/g, '_');
}

export function normalizeKey(value: string | undefined | null): string {
  return normalizeForCompare(value);
}

export function shortDisplay(value: string, maxLength = 96): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 3)}...`;
}

export function normalizePaperLink(value: string | undefined | null): string {
  const raw = (value ?? '').trim();
  if (!raw) {
    return '';
  }

  const parts = raw.split('|').map((part) => part.trim());
  const normalized = parts.map((part) => {
    if (part.startsWith('/')) {
      return `https://emailsc.sharepoint.com${part}`;
    }
    return part;
  });

  return normalized.join(' | ');
}

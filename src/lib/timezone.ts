import { DateTime } from 'luxon';
import type { CompletedAtTimezoneMode } from '../types';

const EASTERN_ZONE = 'America/New_York';

const FORMATS_WITH_SECONDS = [
  'MM/dd/yyyy HH:mm:ss',
  'M/d/yyyy H:mm:ss',
  'MM/dd/yyyy hh:mm:ss a',
  'M/d/yyyy h:mm:ss a',
];

const FORMATS_NO_SECONDS = [
  'MM/dd/yyyy HH:mm',
  'M/d/yyyy H:mm',
  'MM/dd/yyyy hh:mm a',
  'M/d/yyyy h:mm a',
];

function parseWithFormats(value: string, zone: string): DateTime | null {
  for (const format of [...FORMATS_WITH_SECONDS, ...FORMATS_NO_SECONDS]) {
    const parsed = DateTime.fromFormat(value, format, { zone });
    if (parsed.isValid) {
      return parsed;
    }
  }
  return null;
}

function normalizeOffset(offset: string): string {
  if (!offset) {
    return '+00:00';
  }
  const trimmed = offset.trim();
  const isoOffset = trimmed.match(/^[+-]\d{2}:\d{2}$/);
  if (isoOffset) {
    return trimmed;
  }
  const compact = trimmed.match(/^[+-]\d{4}$/);
  if (compact) {
    return `${trimmed.slice(0, 3)}:${trimmed.slice(3)}`;
  }
  return '+00:00';
}

function parseAsIsoIfExplicitTimezone(value: string): DateTime | null {
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(value.trim());
  if (!hasTimezone) {
    return null;
  }

  const parsed = DateTime.fromISO(value, { setZone: true });
  if (parsed.isValid) {
    return parsed;
  }

  return null;
}

export function parseCompletedAt(
  value: string,
  mode: CompletedAtTimezoneMode,
  customOffset: string,
): DateTime | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (mode === 'auto') {
    const explicitIso = parseAsIsoIfExplicitTimezone(trimmed);
    if (explicitIso) {
      return explicitIso;
    }

    return parseWithFormats(trimmed, EASTERN_ZONE);
  }

  if (mode === 'utc') {
    return parseWithFormats(trimmed, 'UTC');
  }

  if (mode === 'america_new_york') {
    return parseWithFormats(trimmed, EASTERN_ZONE);
  }

  const offset = normalizeOffset(customOffset);
  return parseWithFormats(trimmed, `UTC${offset}`);
}

export function getEasternNow(): DateTime {
  return DateTime.now().setZone(EASTERN_ZONE);
}

export function getPreviousFridayDueIsoEastern(referenceIso?: string): string {
  let cursor = referenceIso
    ? DateTime.fromISO(referenceIso, { zone: EASTERN_ZONE })
    : getEasternNow();

  if (!cursor.isValid) {
    cursor = getEasternNow();
  }

  // Luxon weekday: Monday=1 ... Friday=5 ... Sunday=7
  let daysBack = cursor.weekday - 5;
  if (daysBack <= 0) {
    daysBack += 7;
  }

  const previousFriday = cursor.minus({ days: daysBack }).set({
    hour: 23,
    minute: 59,
    second: 59,
    millisecond: 0,
  });

  return previousFriday.toISO({ suppressMilliseconds: true }) ?? previousFriday.toString();
}

export function formatDueForFeedback(iso: string): string {
  const parsed = DateTime.fromISO(iso, { zone: EASTERN_ZONE });
  if (!parsed.isValid) {
    return iso;
  }
  return parsed.toFormat('MM/dd/yyyy HH:mm:ss ZZZZ');
}

export function toEastern(when: DateTime): DateTime {
  return when.setZone(EASTERN_ZONE);
}

import type { CsvRow } from '../types';
import { normalizeKey } from './text';

export interface UniqueIndexResult {
  map: Map<string, CsvRow>;
  duplicates: Set<string>;
}

export function buildUniqueIndex(rows: CsvRow[], keyField: string): UniqueIndexResult {
  const map = new Map<string, CsvRow>();
  const duplicates = new Set<string>();

  for (const row of rows) {
    const rawKey = row[keyField];
    const normalized = normalizeKey(rawKey);
    if (!normalized) {
      continue;
    }

    if (map.has(normalized)) {
      duplicates.add(normalized);
      continue;
    }

    map.set(normalized, row);
  }

  return { map, duplicates };
}

export function buildGroupedIndex(rows: CsvRow[], keyField: string): Map<string, CsvRow[]> {
  const map = new Map<string, CsvRow[]>();

  for (const row of rows) {
    const key = normalizeKey(row[keyField]);
    if (!key) {
      continue;
    }

    const bucket = map.get(key);
    if (bucket) {
      bucket.push(row);
      continue;
    }

    map.set(key, [row]);
  }

  return map;
}

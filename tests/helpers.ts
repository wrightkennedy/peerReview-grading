import fs from 'node:fs';
import path from 'node:path';
import { parseCsvText } from '../src/lib/csvCore';
import type { CsvTable } from '../src/types';

export function loadSampleCsv(fileName: string): CsvTable {
  const absolute = path.resolve(process.cwd(), 'tests', 'fixtures', fileName);
  const text = fs.readFileSync(absolute, 'utf8');
  return parseCsvText(text, fileName);
}

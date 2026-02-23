import Papa from 'papaparse';
import type { CsvFormatMeta, CsvRow, CsvTable } from '../types';

export function detectNewline(text: string): '\n' | '\r\n' {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

export function hasBom(text: string): boolean {
  return text.charCodeAt(0) === 0xfeff;
}

export function parseCsvText(text: string, sourceName: string): CsvTable {
  const result = Papa.parse<CsvRow>(text, {
    header: true,
    skipEmptyLines: false,
    dynamicTyping: false,
    delimitersToGuess: [',', '\t', ';', '|'],
  });

  if (result.errors.length > 0) {
    const fatal = result.errors.find((error) => error.type === 'Delimiter');
    if (fatal) {
      throw new Error(`Unable to parse ${sourceName}: ${fatal.message}`);
    }
  }

  const headers = result.meta.fields ?? [];
  const rows = result.data.map((row) => {
    const normalizedRow: CsvRow = {};
    for (const header of headers) {
      normalizedRow[header] = String(row[header] ?? '');
    }
    return normalizedRow;
  });

  const formatMeta: CsvFormatMeta = {
    delimiter: result.meta.delimiter || ',',
    newline: detectNewline(text),
    hasBom: hasBom(text),
    quoteChar: '"',
  };

  return {
    headers,
    rows,
    formatMeta,
    sourceName,
  };
}

export function serializeCsv(
  headers: string[],
  rows: CsvRow[],
  formatMeta: CsvFormatMeta,
): string {
  const csvBody = Papa.unparse(
    {
      fields: headers,
      data: rows.map((row) => headers.map((header) => row[header] ?? '')),
    },
    {
      delimiter: formatMeta.delimiter,
      newline: formatMeta.newline,
      quoteChar: formatMeta.quoteChar,
    },
  );

  if (formatMeta.hasBom) {
    return `\ufeff${csvBody}`;
  }

  return csvBody;
}

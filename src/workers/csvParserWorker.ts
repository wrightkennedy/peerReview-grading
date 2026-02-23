/// <reference lib="webworker" />

import type { CsvTable } from '../types';
import { parseCsvText } from '../lib/csvCore';

interface ParseMessage {
  id: number;
  sourceName: string;
  text: string;
}

interface ParseSuccess {
  id: number;
  ok: true;
  table: CsvTable;
}

interface ParseFailure {
  id: number;
  ok: false;
  error: string;
}

self.onmessage = (event: MessageEvent<ParseMessage>) => {
  const { id, sourceName, text } = event.data;

  try {
    const table = parseCsvText(text, sourceName);
    const response: ParseSuccess = {
      id,
      ok: true,
      table,
    };
    self.postMessage(response);
  } catch (error) {
    const response: ParseFailure = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown CSV parse error',
    };
    self.postMessage(response);
  }
};

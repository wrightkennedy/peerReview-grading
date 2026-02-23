import type { CsvTable } from '../types';

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

type ParseResponse = ParseSuccess | ParseFailure;

let worker: Worker | null = null;
let messageCounter = 0;

const pending = new Map<
  number,
  {
    resolve: (table: CsvTable) => void;
    reject: (error: Error) => void;
  }
>();

function getWorker(): Worker {
  if (worker) {
    return worker;
  }

  worker = new Worker(new URL('../workers/csvParserWorker.ts', import.meta.url), {
    type: 'module',
  });

  worker.onmessage = (event: MessageEvent<ParseResponse>) => {
    const response = event.data;
    const handlers = pending.get(response.id);
    if (!handlers) {
      return;
    }

    pending.delete(response.id);

    if (response.ok) {
      handlers.resolve(response.table);
      return;
    }

    handlers.reject(new Error(response.error));
  };

  return worker;
}

export async function parseCsvTextWithWorker(
  sourceName: string,
  text: string,
): Promise<CsvTable> {
  const w = getWorker();
  const id = ++messageCounter;

  return new Promise<CsvTable>((resolve, reject) => {
    pending.set(id, { resolve, reject });

    const message: ParseMessage = {
      id,
      sourceName,
      text,
    };

    w.postMessage(message);
  });
}

export async function parseCsvFile(file: File): Promise<CsvTable> {
  const text = await file.text();
  return parseCsvTextWithWorker(file.name, text);
}

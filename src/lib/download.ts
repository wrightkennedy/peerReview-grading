import { serializeCsv } from './csvCore';
import type { CsvTable, GeneratedFile } from '../types';
import JSZip from 'jszip';

export function makeCsvFile(fileName: string, table: CsvTable): GeneratedFile {
  return {
    fileName,
    mimeType: 'text/csv;charset=utf-8',
    content: serializeCsv(table.headers, table.rows, table.formatMeta),
  };
}

export function makeJsonFile(fileName: string, value: string): GeneratedFile {
  return {
    fileName,
    mimeType: 'application/json;charset=utf-8',
    content: value,
  };
}

export function downloadFile(file: GeneratedFile): void {
  const blob = new Blob([file.content], { type: file.mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

export function downloadAll(files: GeneratedFile[]): void {
  files.forEach((file, index) => {
    window.setTimeout(() => {
      downloadFile(file);
    }, index * 140);
  });
}

function zipTimestamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

export async function downloadAllAsZip(files: GeneratedFile[]): Promise<void> {
  const zip = new JSZip();
  for (const file of files) {
    zip.file(file.fileName, file.content);
  }

  const blob = await zip.generateAsync({
    type: 'blob',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `blackboard_outputs_${zipTimestamp()}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

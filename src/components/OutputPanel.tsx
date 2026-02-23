import { downloadAllAsZip, downloadFile } from '../lib/download';
import type { GeneratedFile } from '../types';

interface OutputPanelProps {
  files: GeneratedFile[];
}

function getDownloadCategory(fileName: string): 'main' | 'issues' | 'per-ta' | 'audit' {
  if (fileName.endsWith('.json') || fileName.includes('_Audit')) {
    return 'audit';
  }
  if (fileName.includes('_Issues_')) {
    return 'per-ta';
  }
  if (fileName.includes('_Issues')) {
    return 'issues';
  }
  return 'main';
}

export function OutputPanel({ files }: OutputPanelProps) {
  if (files.length === 0) {
    return <p className="muted">Run preview to generate files.</p>;
  }

  return (
    <section className="output-panel">
      <h3>Export</h3>
      <button
        type="button"
        className="download-zip"
        onClick={async () => {
          await downloadAllAsZip(files);
        }}
      >
        Download All Outputs (ZIP)
      </button>
      <ul>
        {files.map((file) => (
          <li key={file.fileName}>
            <button
              type="button"
              className={`download-${getDownloadCategory(file.fileName)}`}
              onClick={() => downloadFile(file)}
            >
              Download {file.fileName}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

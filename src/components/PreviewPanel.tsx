import type { PreviewSummary } from '../types';

interface PreviewPanelProps {
  preview: PreviewSummary;
}

export function PreviewPanel({ preview }: PreviewPanelProps) {
  return (
    <section className="preview-panel">
      <h3>Preview</h3>
      <div className="preview-metrics">
        <span>Total rows: {preview.totalRows}</span>
        <span>Updated: {preview.updatedRows}</span>
        <span>Skipped: {preview.skippedRows}</span>
        <span>Issue rows: {preview.issueRows}</span>
      </div>

      {Object.keys(preview.issuesByReason).length > 0 ? (
        <div className="issue-reasons">
          <h4>Issue / Skip Reasons</h4>
          <ul>
            {Object.entries(preview.issuesByReason)
              .sort((a, b) => b[1] - a[1])
              .map(([reason, count]) => (
                <li key={reason}>
                  <code>{reason}</code>: {count}
                </li>
              ))}
          </ul>
        </div>
      ) : null}

      {preview.sampleChanges.length > 0 ? (
        <div className="sample-changes">
          <h4>Sample Changes</h4>
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Field</th>
                <th>Before</th>
                <th>After</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {preview.sampleChanges.map((change) => (
                <tr key={`${change.key}-${change.field}-${change.before}-${change.after}`}>
                  <td>{change.key}</td>
                  <td>{change.field}</td>
                  <td>{change.before}</td>
                  <td>{change.after}</td>
                  <td>{change.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

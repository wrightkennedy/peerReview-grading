import { useEffect, useRef } from 'react';
import type { ChangeEvent } from 'react';
import type { CsvTable } from '../types';

interface FileUploadProps {
  label: string;
  required?: boolean;
  table: CsvTable | null;
  onFileSelected: (file: File) => Promise<void>;
  onClear?: () => void;
  helpText?: string;
  pickerTitle?: string;
}

export function FileUpload({
  label,
  required = false,
  table,
  onFileSelected,
  onClear,
  helpText,
  pickerTitle,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!table && inputRef.current) {
      inputRef.current.value = '';
    }
  }, [table]);

  const onChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    await onFileSelected(file);
  };

  return (
    <label className="file-upload">
      <span className="label-row">
        {label}
        {required ? <em className="required">required</em> : null}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        onChange={onChange}
        title={pickerTitle ?? label}
        aria-label={pickerTitle ?? label}
      />
      {table && onClear ? (
        <button
          type="button"
          className="clear-file"
          onClick={() => {
            onClear();
            if (inputRef.current) {
              inputRef.current.value = '';
            }
          }}
        >
          Remove selected file
        </button>
      ) : null}
      {helpText ? <small>{helpText}</small> : null}
      {table ? (
        <div className="file-meta">
          <strong>{table.sourceName}</strong>
          <span>{table.rows.length} rows</span>
          <span>{table.headers.length} columns</span>
        </div>
      ) : null}
    </label>
  );
}

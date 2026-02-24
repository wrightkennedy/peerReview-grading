import { useEffect, useMemo, useState } from 'react';
import { DateTime } from 'luxon';
import './App.css';
import type {
  CompletedAtTimezoneMode,
  CsvTable,
  ProcessorResult,
  Task1Config,
  Task2RawConfig,
  Task2SharedConfig,
  Task3Config,
  Task3RawConfig,
  TaskType,
} from './types';
import { parseCsvFile } from './lib/csvWorkerClient';
import {
  defaultTask1Config,
  defaultTask2RawConfig,
  defaultTask2SharedConfig,
  defaultTask3Config,
  defaultTask3RawConfig,
} from './lib/defaults';
import { processTask1 } from './processors/task1';
import { processTask2Raw, processTask2Summary } from './processors/task2';
import { processTask3, processTask3Raw } from './processors/task3';
import { FileUpload } from './components/FileUpload';
import { FieldSelect } from './components/FieldSelect';
import { PreviewPanel } from './components/PreviewPanel';
import { OutputPanel } from './components/OutputPanel';

type Task2Mode = 'summary' | 'raw';
type Task3Mode = 'assignments' | 'raw';

function isMissingTable(table: CsvTable | null): table is null {
  return table === null;
}

function parseNumberInput(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatIsoForDateTimeLocal(iso: string): string {
  const parsed = DateTime.fromISO(iso, { zone: 'America/New_York' });
  if (!parsed.isValid) {
    return '';
  }
  return parsed.toFormat("yyyy-LL-dd'T'HH:mm");
}

function parseDateTimeLocalToEasternIso(value: string): string | null {
  const parsed = DateTime.fromFormat(value, "yyyy-LL-dd'T'HH:mm", {
    zone: 'America/New_York',
  });
  if (!parsed.isValid) {
    return null;
  }
  return parsed.toISO({ suppressMilliseconds: true });
}

function hasHeader(table: CsvTable | null, headerName: string): boolean {
  return Boolean(table && table.headers.includes(headerName));
}

function hasAnyTotalPtsHeader(table: CsvTable | null): boolean {
  return Boolean(table && table.headers.some((header) => header.includes('Total Pts')));
}

function getReasonTokens(reason: string): string[] {
  return reason
    .split('|')
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function hasIssueReason(reason: string, expected: string): boolean {
  return getReasonTokens(reason).includes(expected);
}

function toUniqueSortedValues(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  ).sort((a, b) => a.localeCompare(b));
}

function buildManualOverridesText(overrides: Record<string, string>): string {
  return Object.entries(overrides)
    .filter(([, joinKey]) => joinKey.trim().length > 0)
    .map(([identifier, joinKey]) => `${identifier},${joinKey}`)
    .join('\n');
}

const WEEKDAY_OPTIONS = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 7, label: 'Sun' },
];

const TASK2_RAW_SUMMARY_HEADERS = [
  'Username',
  'Chapter',
  'PaperKey',
  'PaperLink',
  'AvgScore1',
  'AvgScore2',
  'AvgScore3',
  'AvgScore4',
  'RangeScore1',
  'RangeScore2',
  'RangeScore3',
  'RangeScore4',
  'AvgScoreOverall',
  'RangeFlag',
  'ReviewsCompleted',
  'FairnessNoCount',
  'IntegrityFlagCount',
  'PeerFeedback',
  'IntegrityNotes',
  'TAEmail',
  'Section',
];

interface MissingJoinIssue {
  identifier: string;
  username: string;
  details: string;
}

function App() {
  const [activeTask, setActiveTask] = useState<TaskType>('attendance_verification');
  const [globalErrors, setGlobalErrors] = useState<string[]>([]);

  // Task 1 state
  const [task1Gradebook, setTask1Gradebook] = useState<CsvTable | null>(null);
  const [task1Attendance, setTask1Attendance] = useState<CsvTable | null>(null);
  const [task1Config, setTask1Config] = useState<Task1Config>(
    defaultTask1Config(null, null),
  );
  const [task1Result, setTask1Result] = useState<ProcessorResult | null>(null);
  const [task1FieldMappingOpen, setTask1FieldMappingOpen] = useState(false);
  const [task1ParametersOpen, setTask1ParametersOpen] = useState(true);

  // Task 2 state
  const [task2Mode, setTask2Mode] = useState<Task2Mode>('summary');
  const [task2Gradebook, setTask2Gradebook] = useState<CsvTable | null>(null);
  const [task2Summary, setTask2Summary] = useState<CsvTable | null>(null);
  const [task2Raw, setTask2Raw] = useState<CsvTable | null>(null);
  const [task2Assignments, setTask2Assignments] = useState<CsvTable | null>(null);
  const [task2OwnerMap, setTask2OwnerMap] = useState<CsvTable | null>(null);
  const [task2XwalkTa, setTask2XwalkTa] = useState<CsvTable | null>(null);
  const [task2Config, setTask2Config] = useState<Task2SharedConfig>(
    defaultTask2SharedConfig(null, null),
  );
  const [task2RawConfig, setTask2RawConfig] = useState<Task2RawConfig>(
    defaultTask2RawConfig(null, null),
  );
  const [task2Result, setTask2Result] = useState<ProcessorResult | null>(null);
  const [task2FieldMappingOpen, setTask2FieldMappingOpen] = useState(false);
  const [task2RubricOpen, setTask2RubricOpen] = useState(false);
  const [task2ParametersOpen, setTask2ParametersOpen] = useState(true);
  const [task2ManualOverrideSelections, setTask2ManualOverrideSelections] = useState<
    Record<string, string>
  >({});

  // Task 3 state
  const [task3Mode, setTask3Mode] = useState<Task3Mode>('assignments');
  const [task3Gradebook, setTask3Gradebook] = useState<CsvTable | null>(null);
  const [task3Assignments, setTask3Assignments] = useState<CsvTable | null>(null);
  const [task3Raw, setTask3Raw] = useState<CsvTable | null>(null);
  const [task3XwalkTa, setTask3XwalkTa] = useState<CsvTable | null>(null);
  const [task3Config, setTask3Config] = useState<Task3Config>(
    defaultTask3Config(null, null),
  );
  const [task3RawConfig, setTask3RawConfig] = useState<Task3RawConfig>(
    defaultTask3RawConfig(null, null),
  );
  const [task3Result, setTask3Result] = useState<ProcessorResult | null>(null);
  const [task3FieldMappingOpen, setTask3FieldMappingOpen] = useState(false);
  const [task3ParametersOpen, setTask3ParametersOpen] = useState(true);
  const [task3ManualOverrideSelections, setTask3ManualOverrideSelections] = useState<
    Record<string, string>
  >({});

  const availableTask1GradebookHeaders = task1Gradebook?.headers ?? [];
  const availableTask1AttendanceHeaders = task1Attendance?.headers ?? [];

  const task2SummaryLike = task2Mode === 'summary' ? task2Summary : task2OwnerMap;
  const task2SummaryHeaders =
    task2Mode === 'raw' ? TASK2_RAW_SUMMARY_HEADERS : task2SummaryLike?.headers ?? [];
  const task2GradebookHeaders = task2Gradebook?.headers ?? [];
  const task2RawHeaders = task2Raw?.headers ?? [];
  const task2AssignmentsHeaders = task2Assignments?.headers ?? [];

  const task3GradebookHeaders = task3Gradebook?.headers ?? [];
  const task3AssignmentsHeaders = task3Assignments?.headers ?? [];
  const task3RawHeaders = task3Raw?.headers ?? [];

  const task1DefaultsMissing =
    Boolean(task1Gradebook && task1Attendance) &&
    (!hasHeader(task1Gradebook, 'Username') ||
      !hasHeader(task1Attendance, 'username') ||
      !hasHeader(task1Attendance, 'status') ||
      !hasHeader(task1Gradebook, 'Feedback to Learner') ||
      !hasAnyTotalPtsHeader(task1Gradebook));

  const task2FilesReady =
    task2Mode === 'summary'
      ? Boolean(task2Gradebook && task2Summary)
      : Boolean(task2Gradebook && task2Raw && task2Assignments && task2OwnerMap);

  const task2DefaultsMissing =
    task2FilesReady &&
    (!hasHeader(task2Gradebook, 'Username') ||
      !hasHeader(task2Gradebook, 'Feedback to Learner') ||
      !hasAnyTotalPtsHeader(task2Gradebook) ||
      !hasHeader(task2SummaryLike, 'Username') ||
      !hasHeader(task2SummaryLike, 'Chapter') ||
      !hasHeader(task2SummaryLike, 'ReviewsCompleted') ||
      !hasHeader(task2SummaryLike, 'FairnessNoCount') ||
      !hasHeader(task2SummaryLike, 'IntegrityFlagCount') ||
      !hasHeader(task2SummaryLike, 'RangeFlag') ||
      !hasHeader(task2SummaryLike, 'RangeScore1') ||
      !hasHeader(task2SummaryLike, 'RangeScore2') ||
      !hasHeader(task2SummaryLike, 'RangeScore3') ||
      !hasHeader(task2SummaryLike, 'RangeScore4') ||
      !hasHeader(task2SummaryLike, 'PeerFeedback'));

  const task3FilesReady =
    task3Mode === 'assignments'
      ? Boolean(task3Gradebook && task3Assignments)
      : Boolean(task3Gradebook && task3Assignments && task3Raw);

  const task3DefaultsMissing =
    task3FilesReady &&
    (!hasHeader(task3Gradebook, 'Username') ||
      !hasHeader(task3Gradebook, 'Feedback to Learner') ||
      !hasAnyTotalPtsHeader(task3Gradebook) ||
      !hasHeader(task3Assignments, 'ReviewerUsername') ||
      !hasHeader(task3Assignments, 'Chapter') ||
      (task3Mode === 'assignments' &&
        (!hasHeader(task3Assignments, 'Status') ||
          !hasHeader(task3Assignments, 'CompletedAt') ||
          !hasHeader(task3Assignments, 'Fairness'))) ||
      (task3Mode === 'raw' &&
        (!hasHeader(task3Raw, 'ReviewToken') ||
          !hasHeader(task3Raw, 'Completion time') ||
          !hasHeader(task3Assignments, 'Token') ||
          !hasHeader(task3Assignments, 'PaperKey'))));

  const task2MissingJoinIssues = useMemo<MissingJoinIssue[]>(() => {
    if (!task2Result) {
      return [];
    }
    return task2Result.issueRows
      .filter((issueRow) => hasIssueReason(issueRow.Reason ?? '', 'missing-gradebook-join-key'))
      .map((issueRow) => ({
        identifier:
          issueRow.GradebookIdentifier?.trim() ||
          issueRow.Username?.trim() ||
          issueRow.Details?.trim(),
        username: issueRow.Username ?? '',
        details: issueRow.Details ?? '',
      }))
      .filter((issue) => issue.identifier.length > 0);
  }, [task2Result]);

  const task3MissingJoinIssues = useMemo<MissingJoinIssue[]>(() => {
    if (!task3Result) {
      return [];
    }
    return task3Result.issueRows
      .filter((issueRow) => hasIssueReason(issueRow.Reason ?? '', 'missing-gradebook-join-key'))
      .map((issueRow) => ({
        identifier:
          issueRow.GradebookIdentifier?.trim() ||
          issueRow.Username?.trim() ||
          issueRow.Details?.trim(),
        username: issueRow.Username ?? '',
        details: issueRow.Details ?? '',
      }))
      .filter((issue) => issue.identifier.length > 0);
  }, [task3Result]);

  const task2JoinCandidates = useMemo(() => {
    const sourceTable = task2Mode === 'summary' ? task2Summary : task2OwnerMap;
    if (!sourceTable) {
      return [];
    }
    return toUniqueSortedValues(
      sourceTable.rows.map((row) => row[task2Config.summaryJoinField] ?? ''),
    );
  }, [task2Mode, task2Summary, task2OwnerMap, task2Config.summaryJoinField]);

  const task3JoinCandidates = useMemo(() => {
    if (!task3Assignments) {
      return [];
    }
    const reviewerField =
      task3Mode === 'raw'
        ? task3RawConfig.assignmentsReviewerField
        : task3Config.assignmentsJoinField;
    return toUniqueSortedValues(
      task3Assignments.rows.map((row) => row[reviewerField] ?? ''),
    );
  }, [task3Assignments, task3Config.assignmentsJoinField, task3Mode, task3RawConfig.assignmentsReviewerField]);

  useEffect(() => {
    setTask1Config(defaultTask1Config(task1Gradebook, task1Attendance));
    setTask1Result(null);
  }, [task1Gradebook, task1Attendance]);

  useEffect(() => {
    setTask2Config(defaultTask2SharedConfig(task2Gradebook, task2SummaryLike));
    setTask2Result(null);
  }, [task2Gradebook, task2SummaryLike, task2Mode]);

  useEffect(() => {
    setTask2RawConfig(defaultTask2RawConfig(task2Raw, task2Assignments));
    setTask2Result(null);
  }, [task2Raw, task2Assignments]);

  useEffect(() => {
    setTask3Config(defaultTask3Config(task3Gradebook, task3Assignments));
    setTask3Result(null);
  }, [task3Gradebook, task3Assignments, task3Mode]);

  useEffect(() => {
    setTask3RawConfig(defaultTask3RawConfig(task3Raw, task3Assignments));
    setTask3Result(null);
  }, [task3Raw, task3Assignments]);

  useEffect(() => {
    if (!task1Gradebook || !task1Attendance) {
      setTask1FieldMappingOpen(false);
      return;
    }
    setTask1FieldMappingOpen(task1DefaultsMissing);
  }, [task1Gradebook, task1Attendance, task1DefaultsMissing]);

  useEffect(() => {
    if (!task2FilesReady) {
      setTask2FieldMappingOpen(false);
      return;
    }
    setTask2FieldMappingOpen(Boolean(task2DefaultsMissing));
  }, [task2FilesReady, task2DefaultsMissing]);

  useEffect(() => {
    if (!task3FilesReady) {
      setTask3FieldMappingOpen(false);
      return;
    }
    setTask3FieldMappingOpen(task3DefaultsMissing);
  }, [task3FilesReady, task3DefaultsMissing]);

  useEffect(() => {
    setTask2ManualOverrideSelections((previous) => {
      const next: Record<string, string> = { ...previous };
      let changed = false;
      for (const issue of task2MissingJoinIssues) {
        if (next[issue.identifier] === undefined) {
          next[issue.identifier] = '';
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [task2MissingJoinIssues]);

  useEffect(() => {
    setTask3ManualOverrideSelections((previous) => {
      const next: Record<string, string> = { ...previous };
      let changed = false;
      for (const issue of task3MissingJoinIssues) {
        if (next[issue.identifier] === undefined) {
          next[issue.identifier] = '';
          changed = true;
        }
      }
      return changed ? next : previous;
    });
  }, [task3MissingJoinIssues]);

  const task3DueLocal = useMemo(
    () => formatIsoForDateTimeLocal(task3Config.dueDateIsoEastern),
    [task3Config.dueDateIsoEastern],
  );

  async function onUpload(
    file: File,
    setter: (value: CsvTable | null) => void,
  ): Promise<void> {
    try {
      setGlobalErrors([]);
      const table = await parseCsvFile(file);
      setter(table);
    } catch (error) {
      setter(null);
      const message = error instanceof Error ? error.message : 'Unknown CSV parse error';
      setGlobalErrors([`Failed to parse ${file.name}: ${message}`]);
    }
  }

  function resetTask1(): void {
    if (!window.confirm('Reset all Task 1 uploads, mappings, and parameters?')) {
      return;
    }
    setTask1Gradebook(null);
    setTask1Attendance(null);
    setTask1Config(defaultTask1Config(null, null));
    setTask1Result(null);
    setTask1FieldMappingOpen(false);
    setTask1ParametersOpen(true);
  }

  function resetTask2(): void {
    if (!window.confirm('Reset all Task 2 uploads, mappings, and parameters?')) {
      return;
    }
    setTask2Mode('summary');
    setTask2Gradebook(null);
    setTask2Summary(null);
    setTask2Raw(null);
    setTask2Assignments(null);
    setTask2OwnerMap(null);
    setTask2XwalkTa(null);
    setTask2Config(defaultTask2SharedConfig(null, null));
    setTask2RawConfig(defaultTask2RawConfig(null, null));
    setTask2Result(null);
    setTask2FieldMappingOpen(false);
    setTask2RubricOpen(false);
    setTask2ParametersOpen(true);
    setTask2ManualOverrideSelections({});
  }

  function resetTask3(): void {
    if (!window.confirm('Reset all Task 3 uploads, mappings, and parameters?')) {
      return;
    }
    setTask3Mode('assignments');
    setTask3Gradebook(null);
    setTask3Assignments(null);
    setTask3Raw(null);
    setTask3XwalkTa(null);
    setTask3Config(defaultTask3Config(null, null));
    setTask3RawConfig(defaultTask3RawConfig(null, null));
    setTask3Result(null);
    setTask3FieldMappingOpen(false);
    setTask3ParametersOpen(true);
    setTask3ManualOverrideSelections({});
  }

  function runTask1(): void {
    setGlobalErrors([]);
    if (isMissingTable(task1Gradebook) || isMissingTable(task1Attendance)) {
      setGlobalErrors(['Task 1 requires both Gradebook CSV and Attendance CSV.']);
      return;
    }

    const result = processTask1(task1Gradebook, task1Attendance, task1Config);
    setTask1Result(result);
  }

  function runTask2(): void {
    setGlobalErrors([]);
    if (isMissingTable(task2Gradebook)) {
      setGlobalErrors(['Task 2 requires a Gradebook CSV.']);
      return;
    }

    if (task2Mode === 'summary') {
      if (isMissingTable(task2Summary)) {
        setGlobalErrors(['Task 2 summary mode requires summarized peer review CSV.']);
        return;
      }
      const result = processTask2Summary(task2Gradebook, task2Summary, task2XwalkTa, task2Config);
      setTask2Result(result);
      return;
    }

    if (isMissingTable(task2Raw) || isMissingTable(task2Assignments) || isMissingTable(task2OwnerMap)) {
      setGlobalErrors([
        'Task 2 raw mode requires raw reviews CSV, PeerReviewAssignments.csv, and owner map CSV (PeerReviewSubmissions.csv).',
      ]);
      return;
    }

    const result = processTask2Raw(
      task2Gradebook,
      task2Raw,
      task2Assignments,
      task2OwnerMap,
      task2XwalkTa,
      task2Config,
      task2RawConfig,
    );
    setTask2Result(result);
  }

  function runTask3(): void {
    setGlobalErrors([]);
    if (isMissingTable(task3Gradebook) || isMissingTable(task3Assignments)) {
      setGlobalErrors(['Task 3 requires Gradebook CSV and PeerReviewAssignments.csv.']);
      return;
    }

    if (task3Mode === 'raw' && isMissingTable(task3Raw)) {
      setGlobalErrors([
        'Task 3 raw mode requires Raw MS Forms Reviews CSV and PeerReviewAssignments.csv.',
      ]);
      return;
    }

    const result =
      task3Mode === 'assignments'
        ? processTask3(task3Gradebook, task3Assignments, task3XwalkTa, task3Config)
        : processTask3Raw(
            task3Gradebook,
            task3Raw!,
            task3Assignments,
            task3XwalkTa,
            task3Config,
            task3RawConfig,
          );
    setTask3Result(result);
  }

  function updateTask2ManualSelection(identifier: string, joinKey: string): void {
    setTask2ManualOverrideSelections((previous) => {
      const next = { ...previous, [identifier]: joinKey };
      setTask2Config((config) => ({
        ...config,
        manualJoinOverridesText: buildManualOverridesText(next),
      }));
      return next;
    });
  }

  function updateTask3ManualSelection(identifier: string, joinKey: string): void {
    setTask3ManualOverrideSelections((previous) => {
      const next = { ...previous, [identifier]: joinKey };
      setTask3Config((config) => ({
        ...config,
        manualJoinOverridesText: buildManualOverridesText(next),
      }));
      return next;
    });
  }

  function toggleTask3ClassDay(day: number): void {
    setTask3Config((previous) => {
      const hasDay = previous.classDaysOfWeek.includes(day);
      const nextDays = hasDay
        ? previous.classDaysOfWeek.filter((item) => item !== day)
        : [...previous.classDaysOfWeek, day];
      return {
        ...previous,
        classDaysOfWeek: nextDays.sort((a, b) => a - b),
      };
    });
  }

  const taskResult =
    activeTask === 'attendance_verification'
      ? task1Result
      : activeTask === 'peer_review_summary'
        ? task2Result
        : task3Result;

  const interfaceWarnings = useMemo(() => {
    const warnings: string[] = [];
    if (activeTask === 'attendance_verification' && task1Gradebook) {
      if (!hasHeader(task1Gradebook, 'Feedback to Learner')) {
        warnings.push(
          'Task 1: Gradebook CSV is missing "Feedback to Learner". Select a valid feedback field in Step 2 or re-export the Blackboard gradebook with feedback columns.',
        );
      }
    }
    if (activeTask === 'peer_review_summary' && task2Gradebook) {
      if (!hasHeader(task2Gradebook, 'Feedback to Learner')) {
        warnings.push(
          'Task 2: Gradebook CSV is missing "Feedback to Learner". Select a valid feedback field in Step 2 or re-export the Blackboard gradebook with feedback columns.',
        );
      }
    }
    if (activeTask === 'peer_review_participation' && task3Gradebook) {
      if (!hasHeader(task3Gradebook, 'Feedback to Learner')) {
        warnings.push(
          'Task 3: Gradebook CSV is missing "Feedback to Learner". Select a valid feedback field in Step 2 or re-export the Blackboard gradebook with feedback columns.',
        );
      }
    }
    return warnings;
  }, [activeTask, task1Gradebook, task2Gradebook, task3Gradebook]);

  return (
    <div className="app-shell">
      <header>
        <h1>Blackboard Grade Processing Tool</h1>
        <p>
          Local-first processing for Teaching Assistants. CSV files remain in browser memory on
          this device.
        </p>
      </header>

      <nav className="task-nav" aria-label="Assignment Type Selector">
        <button
          type="button"
          className={activeTask === 'attendance_verification' ? 'active' : ''}
          onClick={() => setActiveTask('attendance_verification')}
        >
          Attendance Verification for In-class Assignment
        </button>
        <button
          type="button"
          className={activeTask === 'peer_review_summary' ? 'active' : ''}
          onClick={() => setActiveTask('peer_review_summary')}
        >
          Summary of Peer Review Assessment
        </button>
        <button
          type="button"
          className={activeTask === 'peer_review_participation' ? 'active' : ''}
          onClick={() => setActiveTask('peer_review_participation')}
        >
          Peer Review Participation
        </button>
      </nav>

      {globalErrors.length > 0 ? (
        <section className="errors">
          <h2>Input Errors</h2>
          <ul>
            {globalErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {interfaceWarnings.length > 0 ? (
        <section className="warnings">
          <h2>Interface Warnings</h2>
          <ul>
            {interfaceWarnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {activeTask === 'attendance_verification' ? (
        <section className="task-card">
          <h2>Task 1: Attendance Verification for In-class Assignment</h2>
          <div className="task-controls">
            <button type="button" className="reset-task" onClick={resetTask1}>
              Reset Task 1
            </button>
          </div>

          <div className="wizard-step">
            <h3>Step 1: Uploads</h3>
            <div className="grid-two">
              <FileUpload
                key="task1-gradebook"
                label="BB Gradebook CSV (Attendance/Discussion Post)"
                required
                table={task1Gradebook}
                onFileSelected={(file) => onUpload(file, setTask1Gradebook)}
                onClear={() => setTask1Gradebook(null)}
                pickerTitle="BB Gradebook CSV (e.g., 'gc_HIST112-000-SPRING...csv')"
              />
              <FileUpload
                key="task1-attendance"
                label="Attendance CSV (attendance_2026-02-19.csv)"
                required
                table={task1Attendance}
                onFileSelected={(file) => onUpload(file, setTask1Attendance)}
                onClear={() => setTask1Attendance(null)}
                pickerTitle="Attendance CSV (e.g., 'attendance_2026-02-19.csv')"
              />
            </div>
          </div>

          <details
            className="wizard-step collapsible-step"
            open={task1FieldMappingOpen}
            onToggle={(event) =>
              setTask1FieldMappingOpen((event.target as HTMLDetailsElement).open)
            }
          >
            <summary>
              <span className="step-title">Step 2: Field Mapping</span>
              {!task1FieldMappingOpen ? ' (collapsed by default)' : ''}
            </summary>
            <div className="wizard-step-body grid-two">
              <FieldSelect
                label="Gradebook Join Field"
                options={availableTask1GradebookHeaders}
                value={task1Config.gradebookJoinField}
                onChange={(value) => setTask1Config((prev) => ({ ...prev, gradebookJoinField: value }))}
                required
              />
              <FieldSelect
                label="Attendance Join Field"
                options={availableTask1AttendanceHeaders}
                value={task1Config.attendanceJoinField}
                onChange={(value) => setTask1Config((prev) => ({ ...prev, attendanceJoinField: value }))}
                required
              />
              <FieldSelect
                label="Attendance Status Field"
                options={availableTask1AttendanceHeaders}
                value={task1Config.attendanceStatusField}
                onChange={(value) => setTask1Config((prev) => ({ ...prev, attendanceStatusField: value }))}
                required
              />
              <FieldSelect
                label="Assignment Field"
                options={availableTask1GradebookHeaders}
                value={task1Config.assignmentField}
                onChange={(value) => setTask1Config((prev) => ({ ...prev, assignmentField: value }))}
                required
              />
              <FieldSelect
                label="Feedback Field"
                options={availableTask1GradebookHeaders}
                value={task1Config.feedbackField}
                onChange={(value) => setTask1Config((prev) => ({ ...prev, feedbackField: value }))}
                required
              />
            </div>
          </details>

          <details
            className="wizard-step collapsible-step"
            open={task1ParametersOpen}
            onToggle={(event) =>
              setTask1ParametersOpen((event.target as HTMLDetailsElement).open)
            }
          >
            <summary>
              <span className="step-title">Step 3: Parameters</span>
            </summary>
            <div className="wizard-step-body">
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={task1Config.gradeByAttendancePresence}
                  onChange={(event) =>
                    setTask1Config((prev) => ({
                      ...prev,
                      gradeByAttendancePresence: event.target.checked,
                    }))
                  }
                />
                Grade all rows by attendance presence (found in attendance CSV = full points, not
                found = 0)
              </label>
              <label className="field-select">
                <span>Attendance full points</span>
                <input
                  type="number"
                  value={task1Config.attendancePoints}
                  onChange={(event) =>
                    setTask1Config((prev) => ({
                      ...prev,
                      attendancePoints: parseNumberInput(event.target.value, prev.attendancePoints),
                    }))
                  }
                />
              </label>
              <label className="field-select">
                <span>Feedback Write Mode</span>
                <select
                  value={task1Config.feedbackWriteMode}
                  onChange={(event) =>
                    setTask1Config((prev) => ({
                      ...prev,
                      feedbackWriteMode: event.target.value as Task1Config['feedbackWriteMode'],
                    }))
                  }
                >
                  <option value="append">Append</option>
                  <option value="overwrite">Overwrite</option>
                </select>
              </label>
              <label className="field-select">
                <span>Feedback Template (HTML allowed)</span>
                <textarea
                  rows={4}
                  value={task1Config.feedbackTemplate}
                  onChange={(event) =>
                    setTask1Config((prev) => ({ ...prev, feedbackTemplate: event.target.value }))
                  }
                />
              </label>
            </div>
          </details>

          <div className="wizard-step actions">
            <h3>Step 4: Preview + Export</h3>
            <button type="button" onClick={runTask1}>
              Run Preview
            </button>
          </div>
        </section>
      ) : null}

      {activeTask === 'peer_review_summary' ? (
        <section className="task-card">
          <h2>Task 2: Summary of Peer Review Assessment</h2>
          <div className="task-controls">
            <button type="button" className="reset-task" onClick={resetTask2}>
              Reset Task 2
            </button>
          </div>

          <div className="wizard-step">
            <h3>Step 1: Uploads</h3>
            <div className="grid-two">
              <FileUpload
                key="task2-gradebook"
                label="BB Gradebook CSV (Readings Notes)"
                required
                table={task2Gradebook}
                onFileSelected={(file) => onUpload(file, setTask2Gradebook)}
                onClear={() => setTask2Gradebook(null)}
                pickerTitle="BB Gradebook CSV (e.g., 'gc_HIST112-000-SPRING...csv')"
              />
              <label className="field-select">
                <span>Input Mode</span>
                <select
                  value={task2Mode}
                  onChange={(event) => {
                    setTask2Mode(event.target.value as Task2Mode);
                    setTask2Result(null);
                    setTask2FieldMappingOpen(false);
                  }}
                >
                  <option value="summary">Summarized Peer Review CSV</option>
                  <option value="raw">Raw MS Forms + Assignments + Owner Map</option>
                </select>
              </label>
            </div>

            {task2Mode === 'summary' ? (
              <div className="grid-two">
                <FileUpload
                  key="task2-summary"
                  label="Summarized Peer Review CSV (PeerReviewSubmissions.csv)"
                  required
                  table={task2Summary}
                  onFileSelected={(file) => onUpload(file, setTask2Summary)}
                  onClear={() => setTask2Summary(null)}
                  pickerTitle="Summarized Peer Review CSV (e.g., 'PeerReviewSubmissions.csv')"
                />
                <FileUpload
                  key="task2-summary-xwalk"
                  label="TA Crosswalk CSV (optional)"
                  table={task2XwalkTa}
                  onFileSelected={(file) => onUpload(file, setTask2XwalkTa)}
                  onClear={() => setTask2XwalkTa(null)}
                  pickerTitle="TA Crosswalk CSV (e.g., 'xwalkTA.csv')"
                />
              </div>
            ) : (
              <div className="grid-two">
                <FileUpload
                  key="task2-raw-reviews"
                  label="Raw MS Forms Reviews CSV"
                  required
                  table={task2Raw}
                  onFileSelected={(file) => onUpload(file, setTask2Raw)}
                  onClear={() => setTask2Raw(null)}
                  pickerTitle="Raw MS Forms Reviews CSV (e.g., 'Chapter Notes Peer Review (...).csv')"
                />
                <FileUpload
                  key="task2-raw-assignments"
                  label="PeerReviewAssignments.csv"
                  required
                  table={task2Assignments}
                  onFileSelected={(file) => onUpload(file, setTask2Assignments)}
                  onClear={() => setTask2Assignments(null)}
                  pickerTitle="Peer Review Participation CSV (e.g., 'PeerReviewAssignments.csv')"
                />
                <FileUpload
                  key="task2-raw-ownermap"
                  label="Owner Map CSV (PeerReviewSubmissions.csv)"
                  required
                  table={task2OwnerMap}
                  onFileSelected={(file) => onUpload(file, setTask2OwnerMap)}
                  onClear={() => setTask2OwnerMap(null)}
                  pickerTitle="Owner Map CSV (e.g., 'PeerReviewSubmissions.csv')"
                />
                <FileUpload
                  key="task2-raw-xwalk"
                  label="TA Crosswalk CSV (optional)"
                  table={task2XwalkTa}
                  onFileSelected={(file) => onUpload(file, setTask2XwalkTa)}
                  onClear={() => setTask2XwalkTa(null)}
                  pickerTitle="TA Crosswalk CSV (e.g., 'xwalkTA.csv')"
                />
              </div>
            )}
          </div>

          <details
            className="wizard-step collapsible-step"
            open={task2FieldMappingOpen}
            onToggle={(event) =>
              setTask2FieldMappingOpen((event.target as HTMLDetailsElement).open)
            }
          >
            <summary>
              <span className="step-title">Step 2: Field Mapping</span>
              {!task2FieldMappingOpen ? ' (collapsed by default)' : ''}
            </summary>
            <div className="wizard-step-body grid-two">
              <FieldSelect
                label="Gradebook Join Field"
                options={task2GradebookHeaders}
                value={task2Config.gradebookJoinField}
                onChange={(value) => setTask2Config((prev) => ({ ...prev, gradebookJoinField: value }))}
                required
              />
              <FieldSelect
                label="Summary Join Field"
                options={task2SummaryHeaders}
                value={task2Config.summaryJoinField}
                onChange={(value) => setTask2Config((prev) => ({ ...prev, summaryJoinField: value }))}
                required
              />
              <FieldSelect
                label="Assignment Field"
                options={task2GradebookHeaders}
                value={task2Config.assignmentField}
                onChange={(value) => setTask2Config((prev) => ({ ...prev, assignmentField: value }))}
                required
              />
              <FieldSelect
                label="Gradebook Feedback Field"
                options={task2GradebookHeaders}
                value={task2Config.gradebookFeedbackField}
                onChange={(value) =>
                  setTask2Config((prev) => ({ ...prev, gradebookFeedbackField: value }))
                }
                required
              />
              <FieldSelect
                label="Summary Feedback Source"
                options={task2SummaryHeaders}
                value={task2Config.feedbackSourceField}
                onChange={(value) => setTask2Config((prev) => ({ ...prev, feedbackSourceField: value }))}
                required
              />
              <FieldSelect
                label="Reviews Completed Field"
                options={task2SummaryHeaders}
                value={task2Config.reviewsCompletedField}
                onChange={(value) =>
                  setTask2Config((prev) => ({ ...prev, reviewsCompletedField: value }))
                }
                required
              />
              <FieldSelect
                label="Fairness Flag Count Field"
                options={task2SummaryHeaders}
                value={task2Config.fairnessCountField}
                onChange={(value) =>
                  setTask2Config((prev) => ({ ...prev, fairnessCountField: value }))
                }
                required
              />
              <FieldSelect
                label="Integrity Flag Count Field"
                options={task2SummaryHeaders}
                value={task2Config.integrityField}
                onChange={(value) => setTask2Config((prev) => ({ ...prev, integrityField: value }))}
                required
              />
              <FieldSelect
                label="Range Flag Field"
                options={task2SummaryHeaders}
                value={task2Config.rangeFlagField}
                onChange={(value) => setTask2Config((prev) => ({ ...prev, rangeFlagField: value }))}
                required
              />
              {task2Config.rangeScoreFields.slice(0, 4).map((field, index) => (
                <FieldSelect
                  key={`task2-range-score-${index}`}
                  label={`Range Score ${index + 1} Field`}
                  options={task2SummaryHeaders}
                  value={field}
                  onChange={(value) =>
                    setTask2Config((prev) => ({
                      ...prev,
                      rangeScoreFields: prev.rangeScoreFields.map((item, i) =>
                        i === index ? value : item,
                      ),
                    }))
                  }
                  required={task2Config.rangeExclusionEnabled}
                />
              ))}
              <FieldSelect
                label="Integrity Notes Field"
                options={task2SummaryHeaders}
                value={task2Config.integrityNotesField}
                onChange={(value) =>
                  setTask2Config((prev) => ({ ...prev, integrityNotesField: value }))
                }
              />
              <FieldSelect
                label="TA Field"
                options={task2SummaryHeaders}
                value={task2Config.taField}
                onChange={(value) => setTask2Config((prev) => ({ ...prev, taField: value }))}
              />
              <FieldSelect
                label="Section Field"
                options={task2SummaryHeaders}
                value={task2Config.sectionField}
                onChange={(value) => setTask2Config((prev) => ({ ...prev, sectionField: value }))}
              />
              <FieldSelect
                label="Summary Chapter Field"
                options={task2SummaryHeaders}
                value={task2Config.summaryChapterField}
                onChange={(value) => setTask2Config((prev) => ({ ...prev, summaryChapterField: value }))}
                required
              />
              <FieldSelect
                label="TA Crosswalk Join Field"
                options={task2XwalkTa?.headers ?? []}
                value={task2Config.xwalkTaJoinField}
                onChange={(value) => setTask2Config((prev) => ({ ...prev, xwalkTaJoinField: value }))}
              />
              <FieldSelect
                label="TA Crosswalk Username Field"
                options={task2SummaryHeaders}
                value={task2Config.xwalkTaUsernameField}
                onChange={(value) =>
                  setTask2Config((prev) => ({ ...prev, xwalkTaUsernameField: value }))
                }
              />
              <FieldSelect
                label="TA Crosswalk TA Field"
                options={task2XwalkTa?.headers ?? []}
                value={task2Config.xwalkTaField}
                onChange={(value) => setTask2Config((prev) => ({ ...prev, xwalkTaField: value }))}
              />
              <FieldSelect
                label="TA Crosswalk Section Field"
                options={task2XwalkTa?.headers ?? []}
                value={task2Config.xwalkSectionField}
                onChange={(value) => setTask2Config((prev) => ({ ...prev, xwalkSectionField: value }))}
              />
            </div>

            {task2Mode === 'raw' ? (
              <div className="raw-grid">
                <h4>Raw Mode Mapping</h4>
                <div className="grid-two">
                  <FieldSelect
                    label="Raw Review Token Field"
                    options={task2RawHeaders}
                    value={task2RawConfig.rawTokenField}
                    onChange={(value) =>
                      setTask2RawConfig((prev) => ({ ...prev, rawTokenField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Raw PaperKey Field"
                    options={task2RawHeaders}
                    value={task2RawConfig.rawPaperKeyField}
                    onChange={(value) =>
                      setTask2RawConfig((prev) => ({ ...prev, rawPaperKeyField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Raw Feedback Field"
                    options={task2RawHeaders}
                    value={task2RawConfig.rawFeedbackField}
                    onChange={(value) =>
                      setTask2RawConfig((prev) => ({ ...prev, rawFeedbackField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Raw Integrity Field"
                    options={task2RawHeaders}
                    value={task2RawConfig.rawIntegrityField}
                    onChange={(value) =>
                      setTask2RawConfig((prev) => ({ ...prev, rawIntegrityField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Raw Integrity Notes Field"
                    options={task2RawHeaders}
                    value={task2RawConfig.rawIntegrityNotesField}
                    onChange={(value) =>
                      setTask2RawConfig((prev) => ({ ...prev, rawIntegrityNotesField: value }))
                    }
                  />
                  <FieldSelect
                    label="Assignments Token Field"
                    options={task2AssignmentsHeaders}
                    value={task2RawConfig.assignmentsTokenField}
                    onChange={(value) =>
                      setTask2RawConfig((prev) => ({ ...prev, assignmentsTokenField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Assignments PaperKey Field"
                    options={task2AssignmentsHeaders}
                    value={task2RawConfig.assignmentsPaperKeyField}
                    onChange={(value) =>
                      setTask2RawConfig((prev) => ({ ...prev, assignmentsPaperKeyField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Assignments PaperLink Field"
                    options={task2AssignmentsHeaders}
                    value={task2RawConfig.assignmentsPaperLinkField}
                    onChange={(value) =>
                      setTask2RawConfig((prev) => ({ ...prev, assignmentsPaperLinkField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Owner Map AnonKey Field"
                    options={task2OwnerMap?.headers ?? []}
                    value={task2RawConfig.ownerMapAnonKeyField}
                    onChange={(value) =>
                      setTask2RawConfig((prev) => ({ ...prev, ownerMapAnonKeyField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Owner Map Username Field"
                    options={task2OwnerMap?.headers ?? []}
                    value={task2RawConfig.ownerMapUsernameField}
                    onChange={(value) =>
                      setTask2RawConfig((prev) => ({ ...prev, ownerMapUsernameField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Owner Map Chapter Field"
                    options={task2OwnerMap?.headers ?? []}
                    value={task2RawConfig.ownerMapChapterField}
                    onChange={(value) =>
                      setTask2RawConfig((prev) => ({ ...prev, ownerMapChapterField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Owner Map TA Field"
                    options={task2OwnerMap?.headers ?? []}
                    value={task2RawConfig.ownerMapTaField}
                    onChange={(value) =>
                      setTask2RawConfig((prev) => ({ ...prev, ownerMapTaField: value }))
                    }
                  />
                  <FieldSelect
                    label="Owner Map Section Field"
                    options={task2OwnerMap?.headers ?? []}
                    value={task2RawConfig.ownerMapSectionField}
                    onChange={(value) =>
                      setTask2RawConfig((prev) => ({ ...prev, ownerMapSectionField: value }))
                    }
                  />
                </div>

                <h5>Raw Score Fields</h5>
                {task2RawConfig.rawScoreFields.map((field, index) => (
                  <FieldSelect
                    key={`${field}-${index}`}
                    label={`Raw Score Field ${index + 1}`}
                    options={task2RawHeaders}
                    value={field}
                    onChange={(value) =>
                      setTask2RawConfig((prev) => ({
                        ...prev,
                        rawScoreFields: prev.rawScoreFields.map((item, i) =>
                          i === index ? value : item,
                        ),
                      }))
                    }
                    required
                  />
                ))}
              </div>
            ) : null}
          </details>

          <details
            className="wizard-step collapsible-step"
            open={task2ParametersOpen}
            onToggle={(event) =>
              setTask2ParametersOpen((event.target as HTMLDetailsElement).open)
            }
          >
            <summary>
              <span className="step-title">Step 3: Parameters</span>
            </summary>
            <div className="grid-two">
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={task2Config.chapterFilterEnabled}
                  onChange={(event) =>
                    setTask2Config((prev) => ({ ...prev, chapterFilterEnabled: event.target.checked }))
                  }
                />
                Enable chapter filtering
              </label>
              <label className="field-select">
                <span>Chapter token (e.g., ch19)</span>
                <input
                  value={task2Config.chapterValue}
                  onChange={(event) =>
                    setTask2Config((prev) => ({ ...prev, chapterValue: event.target.value }))
                  }
                />
              </label>
              <label className="field-select">
                <span>Chapter range start</span>
                <input
                  type="number"
                  value={task2Config.chapterRangeStart}
                  onChange={(event) =>
                    setTask2Config((prev) => ({
                      ...prev,
                      chapterRangeStart: parseNumberInput(event.target.value, prev.chapterRangeStart),
                    }))
                  }
                />
              </label>
              <label className="field-select">
                <span>Chapter range end</span>
                <input
                  type="number"
                  value={task2Config.chapterRangeEnd}
                  onChange={(event) =>
                    setTask2Config((prev) => ({
                      ...prev,
                      chapterRangeEnd: parseNumberInput(event.target.value, prev.chapterRangeEnd),
                    }))
                  }
                />
              </label>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={task2Config.onlyUpdateNeedsGrading}
                  onChange={(event) =>
                    setTask2Config((prev) => ({
                      ...prev,
                      onlyUpdateNeedsGrading: event.target.checked,
                    }))
                  }
                />
                Only update records currently set to Needs Grading
              </label>
              <label className="field-select">
                <span>Minimum reviews required</span>
                <input
                  type="number"
                  value={task2Config.minReviews}
                  onChange={(event) =>
                    setTask2Config((prev) => ({
                      ...prev,
                      minReviews: parseNumberInput(event.target.value, prev.minReviews),
                    }))
                  }
                />
              </label>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={task2Config.rangeExclusionEnabled}
                  onChange={(event) =>
                    setTask2Config((prev) => ({
                      ...prev,
                      rangeExclusionEnabled: event.target.checked,
                    }))
                  }
                />
                Exclude records with wide range scores
              </label>
              <label className="field-select">
                <span>Range score exclusion threshold (4 = 4+ range)</span>
                <input
                  type="number"
                  value={task2Config.rangeThreshold}
                  disabled={!task2Config.rangeExclusionEnabled}
                  onChange={(event) =>
                    setTask2Config((prev) => ({
                      ...prev,
                      rangeThreshold: parseNumberInput(event.target.value, prev.rangeThreshold),
                    }))
                  }
                />
              </label>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={
                    task2Mode === 'summary'
                      ? true
                      : task2Config.includeFairnessFlaggedReviewsInScoreCalculation
                  }
                  disabled={task2Mode === 'summary'}
                  onChange={(event) =>
                    setTask2Config((prev) => ({
                      ...prev,
                      includeFairnessFlaggedReviewsInScoreCalculation: event.target.checked,
                    }))
                  }
                />
                <span>
                  Include Fairness flag reviews in score calculation
                  {task2Mode === 'summary' ? (
                    <span className="muted">
                      {' '}
                      (Summary mode: reviews marked unfair are already excluded. Use Raw mode to
                      include them.)
                    </span>
                  ) : null}
                </span>
              </label>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={task2Config.includeFeedbackWhenBelowMinReviews}
                  onChange={(event) =>
                    setTask2Config((prev) => ({
                      ...prev,
                      includeFeedbackWhenBelowMinReviews: event.target.checked,
                    }))
                  }
                />
                Include feedback when minimum reviews not met
              </label>
              <label className="field-select">
                <span>Feedback write mode</span>
                <select
                  value={task2Config.feedbackWriteMode}
                  onChange={(event) =>
                    setTask2Config((prev) => ({
                      ...prev,
                      feedbackWriteMode: event.target.value as Task2SharedConfig['feedbackWriteMode'],
                    }))
                  }
                >
                  <option value="append">Append</option>
                  <option value="overwrite">Overwrite</option>
                </select>
              </label>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={task2Config.addUniversalFeedback}
                  onChange={(event) =>
                    setTask2Config((prev) => ({
                      ...prev,
                      addUniversalFeedback: event.target.checked,
                    }))
                  }
                />
                Add universal feedback prefix
              </label>
              {task2Config.addUniversalFeedback ? (
                <label className="field-select span-two">
                  <span>Universal feedback (HTML allowed)</span>
                  <textarea
                    rows={3}
                    value={task2Config.universalFeedback}
                    onChange={(event) =>
                      setTask2Config((prev) => ({ ...prev, universalFeedback: event.target.value }))
                    }
                  />
                </label>
              ) : null}
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={task2Config.enableManualJoinOverrides}
                  onChange={(event) =>
                    setTask2Config((prev) => ({
                      ...prev,
                      enableManualJoinOverrides: event.target.checked,
                    }))
                  }
                />
                Enable manual join overrides for missing gradebook join keys
              </label>
              {task2Config.enableManualJoinOverrides ? (
                <div className="span-two">
                  <FieldSelect
                    label="Gradebook Identifier Field (for manual overrides)"
                    options={task2GradebookHeaders}
                    value={task2Config.manualJoinIdentifierField}
                    onChange={(value) =>
                      setTask2Config((prev) => ({
                        ...prev,
                        manualJoinIdentifierField: value,
                      }))
                    }
                    required
                  />
                </div>
              ) : null}
            </div>

            {task2Config.enableManualJoinOverrides ? (
              <p className="muted">
                Manual mappings are selected after <strong>Run Preview</strong> in the result panel.
              </p>
            ) : null}

            <p className="muted">
              <code>needs-review-late-submission</code> means a gradebook row still shows Needs
              Grading but has no matching summary row after chapter/join filtering. These rows are
              routed to TA issue files for manual review.
            </p>

            <label className="field-select">
              <span>Scoring mode</span>
              <select
                value={task2Config.scoringMode}
                onChange={(event) =>
                  setTask2Config((prev) => ({
                    ...prev,
                    scoringMode: event.target.value as Task2SharedConfig['scoringMode'],
                  }))
                }
              >
                <option value="rubric_weighted">Calculate by Rubric Weighted Categories</option>
                <option value="average_overall">Average Overall Score</option>
              </select>
            </label>

            {task2Config.scoringMode === 'rubric_weighted' ? (
              <details
                className="rubric-editor collapsible-step"
                open={task2RubricOpen}
                onToggle={(event) =>
                  setTask2RubricOpen((event.target as HTMLDetailsElement).open)
                }
              >
                <summary>Rubric Weighted Components</summary>
                <div className="wizard-step-body">
                {task2Config.rubricComponents.map((component, index) => (
                  <div key={`${component.field}-${index}`} className="rubric-row">
                    <FieldSelect
                      label={`Component ${index + 1} Field`}
                      options={task2SummaryHeaders}
                      value={component.field}
                      onChange={(value) =>
                        setTask2Config((prev) => ({
                          ...prev,
                          rubricComponents: prev.rubricComponents.map((item, i) =>
                            i === index ? { ...item, field: value } : item,
                          ),
                        }))
                      }
                      required
                    />
                    <label className="field-select">
                      <span>Total points</span>
                      <input
                        type="number"
                        value={component.totalPoints}
                        onChange={(event) =>
                          setTask2Config((prev) => ({
                            ...prev,
                            rubricComponents: prev.rubricComponents.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    totalPoints: parseNumberInput(event.target.value, item.totalPoints),
                                  }
                                : item,
                            ),
                          }))
                        }
                      />
                    </label>
                    <label className="field-select">
                      <span>Weight (%)</span>
                      <input
                        type="number"
                        value={component.weightPercent}
                        onChange={(event) =>
                          setTask2Config((prev) => ({
                            ...prev,
                            rubricComponents: prev.rubricComponents.map((item, i) =>
                              i === index
                                ? {
                                    ...item,
                                    weightPercent: parseNumberInput(event.target.value, item.weightPercent),
                                  }
                                : item,
                            ),
                          }))
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setTask2Config((prev) => ({
                          ...prev,
                          rubricComponents:
                            prev.rubricComponents.length > 1
                              ? prev.rubricComponents.filter((_, i) => i !== index)
                              : prev.rubricComponents,
                        }))
                      }
                    >
                      Remove
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setTask2Config((prev) => ({
                      ...prev,
                      rubricComponents: [
                        ...prev.rubricComponents,
                        {
                          field: task2SummaryHeaders[0] ?? '',
                          totalPoints: 10,
                          weightPercent: 0,
                        },
                      ],
                    }))
                  }
                >
                  Add Rubric Component
                </button>

                <label className="field-select">
                  <span>Assignment total points (Blackboard)</span>
                  <input
                    type="number"
                    value={task2Config.rubricAssignmentPoints}
                    onChange={(event) =>
                      setTask2Config((prev) => ({
                        ...prev,
                        rubricAssignmentPoints: parseNumberInput(
                          event.target.value,
                          prev.rubricAssignmentPoints,
                        ),
                      }))
                    }
                  />
                </label>
                </div>
              </details>
            ) : (
              <div className="grid-two">
                <FieldSelect
                  label="Average Overall Score Field"
                  options={task2SummaryHeaders}
                  value={task2Config.overallScoreField}
                  onChange={(value) => setTask2Config((prev) => ({ ...prev, overallScoreField: value }))}
                  required
                />
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={task2Config.scaleOverallScore}
                    onChange={(event) =>
                      setTask2Config((prev) => ({ ...prev, scaleOverallScore: event.target.checked }))
                    }
                  />
                  Scale overall score to Blackboard assignment points
                </label>
                <label className="field-select">
                  <span>Overall score total points</span>
                  <input
                    type="number"
                    value={task2Config.overallScoreTotalPoints}
                    onChange={(event) =>
                      setTask2Config((prev) => ({
                        ...prev,
                        overallScoreTotalPoints: parseNumberInput(
                          event.target.value,
                          prev.overallScoreTotalPoints,
                        ),
                      }))
                    }
                  />
                </label>
                <label className="field-select">
                  <span>Blackboard assignment total points</span>
                  <input
                    type="number"
                    value={task2Config.overallAssignmentPoints}
                    onChange={(event) =>
                      setTask2Config((prev) => ({
                        ...prev,
                        overallAssignmentPoints: parseNumberInput(
                          event.target.value,
                          prev.overallAssignmentPoints,
                        ),
                      }))
                    }
                  />
                </label>
              </div>
            )}
          </details>

          <div className="wizard-step actions">
            <h3>Step 4: Preview + Export</h3>
            <button type="button" onClick={runTask2}>
              Run Preview
            </button>
          </div>
        </section>
      ) : null}

      {activeTask === 'peer_review_participation' ? (
        <section className="task-card">
          <h2>Task 3: Peer Review Participation</h2>
          <div className="task-controls">
            <button type="button" className="reset-task" onClick={resetTask3}>
              Reset Task 3
            </button>
          </div>

          <div className="wizard-step">
            <h3>Step 1: Uploads</h3>
            <div className="grid-two">
              <FileUpload
                key="task3-gradebook"
                label="BB Gradebook CSV (Peer Review)"
                required
                table={task3Gradebook}
                onFileSelected={(file) => onUpload(file, setTask3Gradebook)}
                onClear={() => setTask3Gradebook(null)}
                pickerTitle="BB Gradebook CSV (e.g., 'gc_HIST112-000-SPRING...csv')"
              />
              <label className="field-select">
                <span>Input Mode</span>
                <select
                  value={task3Mode}
                  onChange={(event) => {
                    setTask3Mode(event.target.value as Task3Mode);
                    setTask3Result(null);
                    setTask3FieldMappingOpen(false);
                  }}
                >
                  <option value="assignments">Assignments Participation CSV</option>
                  <option value="raw">Raw MS Forms + Assignments Crosswalk</option>
                </select>
              </label>
              <FileUpload
                key="task3-assignments"
                label="Peer Review Participation CSV (PeerReviewAssignments.csv)"
                required
                table={task3Assignments}
                onFileSelected={(file) => onUpload(file, setTask3Assignments)}
                onClear={() => setTask3Assignments(null)}
                pickerTitle="Peer Review Participation CSV (e.g., 'PeerReviewAssignments.csv')"
              />
              {task3Mode === 'raw' ? (
                <FileUpload
                  key="task3-raw-reviews"
                  label="Raw MS Forms Reviews CSV"
                  required
                  table={task3Raw}
                  onFileSelected={(file) => onUpload(file, setTask3Raw)}
                  onClear={() => setTask3Raw(null)}
                  pickerTitle="Raw MS Forms Reviews CSV (e.g., 'Chapter Notes Peer Review (...).csv')"
                />
              ) : null}
              <FileUpload
                key="task3-xwalk"
                label="TA Crosswalk CSV (optional)"
                table={task3XwalkTa}
                onFileSelected={(file) => onUpload(file, setTask3XwalkTa)}
                onClear={() => setTask3XwalkTa(null)}
                pickerTitle="TA Crosswalk CSV (e.g., 'xwalkTA.csv')"
              />
            </div>
          </div>

          <details
            className="wizard-step collapsible-step"
            open={task3FieldMappingOpen}
            onToggle={(event) =>
              setTask3FieldMappingOpen((event.target as HTMLDetailsElement).open)
            }
          >
            <summary>
              <span className="step-title">Step 2: Field Mapping</span>
              {!task3FieldMappingOpen ? ' (collapsed by default)' : ''}
            </summary>
            <div className="wizard-step-body grid-two">
              <FieldSelect
                label="Gradebook Join Field"
                options={task3GradebookHeaders}
                value={task3Config.gradebookJoinField}
                onChange={(value) => setTask3Config((prev) => ({ ...prev, gradebookJoinField: value }))}
                required
              />
              <FieldSelect
                label="Assignments Join Field"
                options={task3AssignmentsHeaders}
                value={task3Config.assignmentsJoinField}
                onChange={(value) =>
                  setTask3Config((prev) => ({ ...prev, assignmentsJoinField: value }))
                }
                required
              />
              <FieldSelect
                label="Assignments Chapter Field"
                options={task3AssignmentsHeaders}
                value={task3Config.assignmentsChapterField}
                onChange={(value) =>
                  setTask3Config((prev) => ({ ...prev, assignmentsChapterField: value }))
                }
                required
              />
              <FieldSelect
                label="Assignment Field"
                options={task3GradebookHeaders}
                value={task3Config.assignmentField}
                onChange={(value) => setTask3Config((prev) => ({ ...prev, assignmentField: value }))}
                required
              />
              <FieldSelect
                label="Feedback Field"
                options={task3GradebookHeaders}
                value={task3Config.feedbackField}
                onChange={(value) => setTask3Config((prev) => ({ ...prev, feedbackField: value }))}
                required
              />
              {task3Mode === 'assignments' ? (
                <>
                  <FieldSelect
                    label="Status Field"
                    options={task3AssignmentsHeaders}
                    value={task3Config.statusField}
                    onChange={(value) => setTask3Config((prev) => ({ ...prev, statusField: value }))}
                    required
                  />
                  <FieldSelect
                    label="CompletedAt Field"
                    options={task3AssignmentsHeaders}
                    value={task3Config.completedAtField}
                    onChange={(value) =>
                      setTask3Config((prev) => ({ ...prev, completedAtField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Fairness Field"
                    options={task3AssignmentsHeaders}
                    value={task3Config.fairnessField}
                    onChange={(value) => setTask3Config((prev) => ({ ...prev, fairnessField: value }))}
                    required
                  />
                </>
              ) : (
                <>
                  <FieldSelect
                    label="Raw Review Token Field"
                    options={task3RawHeaders}
                    value={task3RawConfig.rawTokenField}
                    onChange={(value) =>
                      setTask3RawConfig((prev) => ({ ...prev, rawTokenField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Raw Completion Time Field"
                    options={task3RawHeaders}
                    value={task3RawConfig.rawCompletedAtField}
                    onChange={(value) =>
                      setTask3RawConfig((prev) => ({ ...prev, rawCompletedAtField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Raw Fairness Field"
                    options={task3RawHeaders}
                    value={task3RawConfig.rawFairnessField}
                    onChange={(value) =>
                      setTask3RawConfig((prev) => ({ ...prev, rawFairnessField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Assignments Token Field"
                    options={task3AssignmentsHeaders}
                    value={task3RawConfig.assignmentsTokenField}
                    onChange={(value) =>
                      setTask3RawConfig((prev) => ({ ...prev, assignmentsTokenField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Assignments Reviewer Field"
                    options={task3AssignmentsHeaders}
                    value={task3RawConfig.assignmentsReviewerField}
                    onChange={(value) =>
                      setTask3RawConfig((prev) => ({ ...prev, assignmentsReviewerField: value }))
                    }
                    required
                  />
                  <FieldSelect
                    label="Assignments PaperKey Field"
                    options={task3AssignmentsHeaders}
                    value={task3RawConfig.assignmentsPaperKeyField}
                    onChange={(value) =>
                      setTask3RawConfig((prev) => ({ ...prev, assignmentsPaperKeyField: value }))
                    }
                    required
                  />
                </>
              )}
              <FieldSelect
                label="TA Crosswalk Join Field"
                options={task3XwalkTa?.headers ?? []}
                value={task3Config.xwalkJoinField}
                onChange={(value) => setTask3Config((prev) => ({ ...prev, xwalkJoinField: value }))}
              />
              <FieldSelect
                label="TA Crosswalk TA Field"
                options={task3XwalkTa?.headers ?? []}
                value={task3Config.xwalkTaField}
                onChange={(value) => setTask3Config((prev) => ({ ...prev, xwalkTaField: value }))}
              />
              <FieldSelect
                label="TA Crosswalk Section Field"
                options={task3XwalkTa?.headers ?? []}
                value={task3Config.xwalkSectionField}
                onChange={(value) => setTask3Config((prev) => ({ ...prev, xwalkSectionField: value }))}
              />
            </div>
          </details>

          <details
            className="wizard-step collapsible-step"
            open={task3ParametersOpen}
            onToggle={(event) =>
              setTask3ParametersOpen((event.target as HTMLDetailsElement).open)
            }
          >
            <summary>
              <span className="step-title">Step 3: Parameters</span>
            </summary>
            <div className="grid-two">
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={task3Config.chapterFilterEnabled}
                  onChange={(event) =>
                    setTask3Config((prev) => ({ ...prev, chapterFilterEnabled: event.target.checked }))
                  }
                />
                Enable chapter filtering
              </label>
              <label className="field-select">
                <span>Chapter token</span>
                <input
                  value={task3Config.chapterValue}
                  onChange={(event) =>
                    setTask3Config((prev) => ({ ...prev, chapterValue: event.target.value }))
                  }
                />
              </label>
              <label className="field-select">
                <span>Required reviews</span>
                <input
                  type="number"
                  value={task3Config.requiredReviews}
                  onChange={(event) =>
                    setTask3Config((prev) => ({
                      ...prev,
                      requiredReviews: parseNumberInput(event.target.value, prev.requiredReviews),
                    }))
                  }
                />
              </label>
              <label className="field-select">
                <span>Assignment points</span>
                <input
                  type="number"
                  value={task3Config.assignmentPoints}
                  onChange={(event) =>
                    setTask3Config((prev) => ({
                      ...prev,
                      assignmentPoints: parseNumberInput(event.target.value, prev.assignmentPoints),
                    }))
                  }
                />
              </label>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={task3Config.assignZeroWhenNoAssignedReviews}
                  onChange={(event) =>
                    setTask3Config((prev) => ({
                      ...prev,
                      assignZeroWhenNoAssignedReviews: event.target.checked,
                    }))
                  }
                />
                Assign 0 when no reviews are assigned for the selected chapter
              </label>
              <label className="field-select">
                <span>Late penalty (%)</span>
                <input
                  type="number"
                  value={task3Config.latePenaltyPercent}
                  onChange={(event) =>
                    setTask3Config((prev) => ({
                      ...prev,
                      latePenaltyPercent: parseNumberInput(event.target.value, prev.latePenaltyPercent),
                    }))
                  }
                />
              </label>
              <label className="field-select">
                <span>Feedback write mode</span>
                <select
                  value={task3Config.feedbackWriteMode}
                  onChange={(event) =>
                    setTask3Config((prev) => ({
                      ...prev,
                      feedbackWriteMode: event.target.value as Task3Config['feedbackWriteMode'],
                    }))
                  }
                >
                  <option value="append">Append</option>
                  <option value="overwrite">Overwrite</option>
                </select>
              </label>
              <label className="checkbox-line">
                <input
                  type="checkbox"
                  checked={task3Config.enableManualJoinOverrides}
                  onChange={(event) =>
                    setTask3Config((prev) => ({
                      ...prev,
                      enableManualJoinOverrides: event.target.checked,
                    }))
                  }
                />
                Enable manual join overrides for missing gradebook join keys
              </label>
              {task3Config.enableManualJoinOverrides ? (
                <div className="span-two">
                  <FieldSelect
                    label="Gradebook Identifier Field (for manual overrides)"
                    options={task3GradebookHeaders}
                    value={task3Config.manualJoinIdentifierField}
                    onChange={(value) =>
                      setTask3Config((prev) => ({
                        ...prev,
                        manualJoinIdentifierField: value,
                      }))
                    }
                    required
                  />
                </div>
              ) : null}
              <label className="field-select">
                <span>Due date/time (Eastern)</span>
                <input
                  type="datetime-local"
                  value={task3DueLocal}
                  onChange={(event) => {
                    const iso = parseDateTimeLocalToEasternIso(event.target.value);
                    if (!iso) {
                      return;
                    }
                    setTask3Config((prev) => ({ ...prev, dueDateIsoEastern: iso }));
                  }}
                />
              </label>
              <label className="field-select">
                <span>CompletedAt timezone mode</span>
                <select
                  value={task3Config.completedAtTimezoneMode}
                  onChange={(event) =>
                    setTask3Config((prev) => ({
                      ...prev,
                      completedAtTimezoneMode: event.target.value as CompletedAtTimezoneMode,
                    }))
                  }
                >
                  <option value="auto">Auto-detect + Eastern fallback</option>
                  <option value="utc">Assume UTC</option>
                  <option value="america_new_york">Assume America/New_York</option>
                  <option value="custom_offset">Use custom UTC offset</option>
                </select>
              </label>
              {task3Config.completedAtTimezoneMode === 'custom_offset' ? (
                <label className="field-select">
                  <span>Custom offset (e.g., +00:00)</span>
                  <input
                    value={task3Config.customTimezoneOffset}
                    onChange={(event) =>
                      setTask3Config((prev) => ({
                        ...prev,
                        customTimezoneOffset: event.target.value,
                      }))
                    }
                  />
                </label>
              ) : null}
              <label className="checkbox-line span-two">
                <input
                  type="checkbox"
                  checked={task3Config.classScheduleEnabled}
                  onChange={(event) =>
                    setTask3Config((prev) => ({
                      ...prev,
                      classScheduleEnabled: event.target.checked,
                    }))
                  }
                />
                Flag reviews completed during class time (no participation credit)
              </label>
              {task3Config.classScheduleEnabled ? (
                <>
                  <label className="field-select span-two">
                    <span>Class days (Eastern)</span>
                    <div>
                      {WEEKDAY_OPTIONS.map((option) => (
                        <label key={`task3-day-${option.value}`} style={{ marginRight: '0.8rem' }}>
                          <input
                            type="checkbox"
                            checked={task3Config.classDaysOfWeek.includes(option.value)}
                            onChange={() => toggleTask3ClassDay(option.value)}
                          />{' '}
                          {option.label}
                        </label>
                      ))}
                    </div>
                  </label>
                  <label className="field-select">
                    <span>Class start time (Eastern, HH:mm)</span>
                    <input
                      value={task3Config.classStartTimeEastern}
                      onChange={(event) =>
                        setTask3Config((prev) => ({
                          ...prev,
                          classStartTimeEastern: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field-select">
                    <span>Class end time (Eastern, HH:mm)</span>
                    <input
                      value={task3Config.classEndTimeEastern}
                      onChange={(event) =>
                        setTask3Config((prev) => ({
                          ...prev,
                          classEndTimeEastern: event.target.value,
                        }))
                      }
                    />
                  </label>
                </>
              ) : null}
            </div>
            {task3Config.enableManualJoinOverrides ? (
              <p className="muted">
                Manual mappings are selected after <strong>Run Preview</strong> in the result panel.
              </p>
            ) : null}
          </details>

          <div className="wizard-step actions">
            <h3>Step 4: Preview + Export</h3>
            <button type="button" onClick={runTask3}>
              Run Preview
            </button>
          </div>
        </section>
      ) : null}

      {taskResult ? (
        <section className="result-card">
          {taskResult.errors.length > 0 ? (
            <div className="errors">
              <h3>Validation Errors</h3>
              <ul>
                {taskResult.errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {taskResult.warnings.length > 0 ? (
            <div className="warnings">
              <h3>Warnings</h3>
              <ul>
                {taskResult.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {activeTask === 'peer_review_summary' && task2Config.enableManualJoinOverrides ? (
            <section className="manual-mapping-panel">
              <h3>Manual Join Mapping (After Preview)</h3>
              {task2MissingJoinIssues.length === 0 ? (
                <p className="muted">
                  No <code>missing-gradebook-join-key</code> records found in the latest preview.
                </p>
              ) : (
                <>
                  <p className="muted">
                    Map each missing gradebook identifier to an existing summary join key.
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Gradebook Identifier</th>
                          <th>Username (if present)</th>
                          <th>Issue Detail</th>
                          <th>Map to Summary Join Key</th>
                        </tr>
                      </thead>
                      <tbody>
                        {task2MissingJoinIssues.map((issue) => (
                          <tr key={`task2-map-${issue.identifier}`}>
                            <td>{issue.identifier}</td>
                            <td>{issue.username}</td>
                            <td>{issue.details}</td>
                            <td>
                              <select
                                value={task2ManualOverrideSelections[issue.identifier] ?? ''}
                                onChange={(event) =>
                                  updateTask2ManualSelection(issue.identifier, event.target.value)
                                }
                              >
                                <option value="">Select join key</option>
                                {task2JoinCandidates.map((candidate) => (
                                  <option key={`task2-candidate-${candidate}`} value={candidate}>
                                    {candidate}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button type="button" onClick={runTask2}>
                    Re-run Preview with Selected Manual Mappings
                  </button>
                </>
              )}
            </section>
          ) : null}

          {activeTask === 'peer_review_participation' && task3Config.enableManualJoinOverrides ? (
            <section className="manual-mapping-panel">
              <h3>Manual Join Mapping (After Preview)</h3>
              {task3MissingJoinIssues.length === 0 ? (
                <p className="muted">
                  No <code>missing-gradebook-join-key</code> records found in the latest preview.
                </p>
              ) : (
                <>
                  <p className="muted">
                    Map each missing gradebook identifier to an existing assignments join key.
                  </p>
                  <div className="table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Gradebook Identifier</th>
                          <th>Username (if present)</th>
                          <th>Issue Detail</th>
                          <th>Map to Assignments Join Key</th>
                        </tr>
                      </thead>
                      <tbody>
                        {task3MissingJoinIssues.map((issue) => (
                          <tr key={`task3-map-${issue.identifier}`}>
                            <td>{issue.identifier}</td>
                            <td>{issue.username}</td>
                            <td>{issue.details}</td>
                            <td>
                              <select
                                value={task3ManualOverrideSelections[issue.identifier] ?? ''}
                                onChange={(event) =>
                                  updateTask3ManualSelection(issue.identifier, event.target.value)
                                }
                              >
                                <option value="">Select join key</option>
                                {task3JoinCandidates.map((candidate) => (
                                  <option key={`task3-candidate-${candidate}`} value={candidate}>
                                    {candidate}
                                  </option>
                                ))}
                              </select>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <button type="button" onClick={runTask3}>
                    Re-run Preview with Selected Manual Mappings
                  </button>
                </>
              )}
            </section>
          ) : null}

          <PreviewPanel preview={taskResult.preview} />
          <OutputPanel files={taskResult.files} />
        </section>
      ) : null}

      <footer>
        <p>
          No data is uploaded by this tool. CSV processing occurs locally in the browser on this
          machine.
        </p>
      </footer>
    </div>
  );
}

export default App;

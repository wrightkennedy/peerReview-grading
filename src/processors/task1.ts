import { buildAudit, incrementReason } from '../lib/audit';
import { makeCsvFile, makeJsonFile } from '../lib/download';
import { buildUniqueIndex } from '../lib/join';
import { auditToPrettyJson } from '../lib/audit';
import {
  createAuditName,
  createMainOutputName,
  cloneRows,
  emptyPreview,
  gradebookRowsWithStudentId,
  keyForRow,
  trackChange,
  writeFeedbackField,
} from './common';
import { equalsNormalized, isNeedsGrading, isPresent, normalizeKey } from '../lib/text';
import type { CsvTable, ProcessorResult, Task1Config } from '../types';

export function processTask1(
  gradebook: CsvTable,
  attendance: CsvTable,
  config: Task1Config,
): ProcessorResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const processableCount = gradebookRowsWithStudentId(gradebook.rows).length;

  if (!gradebook.headers.includes(config.assignmentField)) {
    errors.push(`Gradebook assignment field not found: ${config.assignmentField}`);
  }
  if (!gradebook.headers.includes(config.feedbackField)) {
    errors.push(`Gradebook feedback field not found: ${config.feedbackField}`);
  }
  if (!gradebook.headers.includes(config.gradebookJoinField)) {
    errors.push(`Gradebook join field not found: ${config.gradebookJoinField}`);
  }
  if (!attendance.headers.includes(config.attendanceJoinField)) {
    errors.push(`Attendance join field not found: ${config.attendanceJoinField}`);
  }
  if (!attendance.headers.includes(config.attendanceStatusField)) {
    errors.push(`Attendance status field not found: ${config.attendanceStatusField}`);
  }

  if (errors.length > 0) {
    return {
      preview: emptyPreview(processableCount),
      files: [],
      audit: buildAudit({
        task: 'attendance_verification',
        mode: 'attendance_verification',
        generatedAtIso: new Date().toISOString(),
        inputs: {
          gradebook: gradebook.sourceName,
          attendance: attendance.sourceName,
        },
        mappings: {},
        parameters: {},
        counts: {
          totalRows: processableCount,
          updatedRows: 0,
          skippedRows: processableCount,
          issueRows: 0,
        },
        issuesByReason: {},
        outputFiles: [],
        notes: ['Validation failed before processing.'],
      }),
      issueRows: [],
      errors,
      warnings,
    };
  }

  const updatedRows = cloneRows(gradebook.rows);
  const processableRows = gradebookRowsWithStudentId(updatedRows);
  const preview = emptyPreview(processableRows.length);
  const issueReasons: Record<string, number> = {};

  const attendanceIndex = buildUniqueIndex(attendance.rows, config.attendanceJoinField);

  if (attendanceIndex.duplicates.size > 0) {
    warnings.push(
      `Attendance duplicate join keys detected: ${attendanceIndex.duplicates.size}`,
    );
  }

  for (const row of processableRows) {
    const joinKeyRaw = row[config.gradebookJoinField];
    const normalizedKey = normalizeKey(joinKeyRaw);

    if (!normalizedKey) {
      preview.skippedRows += 1;
      incrementReason(issueReasons, 'missing-join-key');
      continue;
    }

    if (attendanceIndex.duplicates.has(normalizedKey)) {
      preview.skippedRows += 1;
      incrementReason(issueReasons, 'duplicate-attendance-key');
      continue;
    }

    const attendanceRow = attendanceIndex.map.get(normalizedKey);
    const status = attendanceRow?.[config.attendanceStatusField] ?? '';

    const targetRow = isNeedsGrading(row[config.assignmentField]);
    const absent = !isPresent(status);

    if (targetRow && absent) {
      const beforeScore = row[config.assignmentField];
      row[config.assignmentField] = '0';

      const generatedFeedback = config.feedbackTemplate;
      const existingFeedback = row[config.feedbackField] ?? '';
      row[config.feedbackField] = writeFeedbackField(
        existingFeedback,
        generatedFeedback,
        config.feedbackWriteMode,
      );

      preview.updatedRows += 1;
      trackChange(preview.sampleChanges, {
        key: keyForRow(row),
        field: config.assignmentField,
        before: beforeScore,
        after: row[config.assignmentField],
        note: `Attendance status "${status || 'missing'}" is not Present`,
      });
    } else {
      preview.skippedRows += 1;
      if (!targetRow) {
        incrementReason(issueReasons, 'not-needs-grading');
      }
      if (!absent) {
        incrementReason(issueReasons, 'present-status');
      }
      if (!attendanceRow) {
        incrementReason(issueReasons, 'missing-attendance-record');
      }
    }

    if (attendanceRow && equalsNormalized(status, 'Present')) {
      // No-op path included for explicitness in audit output.
    }
  }

  preview.issueRows = 0;
  preview.issuesByReason = issueReasons;

  const outputTable: CsvTable = {
    ...gradebook,
    rows: updatedRows,
  };

  const outputName = createMainOutputName(gradebook.sourceName, '_NoAttendance');
  const auditName = createAuditName(gradebook.sourceName, '_NoAttendance');

  const audit = buildAudit({
    task: 'attendance_verification',
    mode: 'attendance_verification',
    generatedAtIso: new Date().toISOString(),
    inputs: {
      gradebook: gradebook.sourceName,
      attendance: attendance.sourceName,
    },
    mappings: {
      gradebookJoinField: config.gradebookJoinField,
      attendanceJoinField: config.attendanceJoinField,
      attendanceStatusField: config.attendanceStatusField,
      assignmentField: config.assignmentField,
      feedbackField: config.feedbackField,
    },
    parameters: {
      feedbackWriteMode: config.feedbackWriteMode,
      feedbackTemplateLength: config.feedbackTemplate.length,
    },
    counts: {
      totalRows: preview.totalRows,
      updatedRows: preview.updatedRows,
      skippedRows: preview.skippedRows,
      issueRows: preview.issueRows,
    },
    issuesByReason: preview.issuesByReason,
    outputFiles: [outputName, auditName],
    notes: [],
  });

  return {
    preview,
    files: [
      makeCsvFile(outputName, outputTable),
      makeJsonFile(auditName, auditToPrettyJson(audit)),
    ],
    audit,
    issueRows: [],
    errors,
    warnings,
  };
}

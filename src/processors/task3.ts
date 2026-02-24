import { DateTime } from 'luxon';
import type {
  CsvRow,
  CsvTable,
  ProcessorResult,
  Task3Config,
  Task3RawConfig,
} from '../types';
import {
  cloneRows,
  createAuditName,
  createMainOutputName,
  createIssueRow,
  emptyPreview,
  gradebookRowsWithStudentId,
  issueTableByTa,
  keyForRow,
  makeIssueTable,
  parseManualJoinOverrides,
  trackChange,
  writeFeedbackField,
} from './common';
import { buildGroupedIndex, buildUniqueIndex } from '../lib/join';
import { buildAudit, incrementReason } from '../lib/audit';
import { makeCsvFile, makeJsonFile } from '../lib/download';
import { auditToPrettyJson } from '../lib/audit';
import {
  equalsNormalized,
  hasText,
  normalizeForCompare,
  normalizeKey,
} from '../lib/text';
import { detectChapterFromAssignmentField, matchesChapter } from '../lib/chapter';
import { roundAndClamp, toFixedScore } from '../lib/math';
import { parseCompletedAt, toEastern } from '../lib/timezone';

const NO_ASSIGNED_REVIEW_FEEDBACK =
  'No reviews assigned due to missing chapter notes. If you feel this is a mistake, please contact your TA.';

function parseTimeToMinutes(value: string): number | null {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    return null;
  }
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function isDuringClassWindow(
  completedEastern: DateTime,
  classDays: Set<number>,
  startMinutes: number,
  endMinutes: number,
): boolean {
  if (!classDays.has(completedEastern.weekday)) {
    return false;
  }
  const totalMinutes = completedEastern.hour * 60 + completedEastern.minute;
  return totalMinutes >= startMinutes && totalMinutes <= endMinutes;
}

export function processTask3(
  gradebook: CsvTable,
  assignments: CsvTable,
  xwalkTa: CsvTable | null,
  config: Task3Config,
): ProcessorResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const processableCount = gradebookRowsWithStudentId(gradebook.rows).length;

  [
    config.gradebookJoinField,
    config.assignmentField,
    config.feedbackField,
  ].forEach((field) => {
    if (!gradebook.headers.includes(field)) {
      errors.push(`Gradebook field not found: ${field}`);
    }
  });

  [
    config.assignmentsJoinField,
    config.statusField,
    config.completedAtField,
    config.fairnessField,
  ].forEach((field) => {
    if (!assignments.headers.includes(field)) {
      errors.push(`Assignments field not found: ${field}`);
    }
  });

  if (errors.length > 0) {
    return {
      preview: emptyPreview(processableCount),
      files: [],
      audit: buildAudit({
        task: 'peer_review_participation',
        mode: 'participation',
        generatedAtIso: new Date().toISOString(),
        inputs: {
          gradebook: gradebook.sourceName,
          assignments: assignments.sourceName,
          xwalkTA: xwalkTa?.sourceName ?? 'not-provided',
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

  const chapterValue =
    config.chapterFilterEnabled && config.chapterValue
      ? config.chapterValue
      : config.chapterFilterEnabled
        ? detectChapterFromAssignmentField(
            config.assignmentField,
            config.chapterRangeStart,
            config.chapterRangeEnd,
          )
        : '';

  const filteredAssignments = assignments.rows.filter((row) => {
    if (!config.chapterFilterEnabled || !chapterValue) {
      return true;
    }
    return matchesChapter(row[config.assignmentsChapterField], chapterValue);
  });

  const assignmentsByReviewer = buildGroupedIndex(
    filteredAssignments,
    config.assignmentsJoinField,
  );

  const xwalkIndex = xwalkTa
    ? buildUniqueIndex(xwalkTa.rows, config.xwalkJoinField)
    : { map: new Map<string, CsvRow>(), duplicates: new Set<string>() };

  if (xwalkTa && xwalkIndex.duplicates.size > 0) {
    warnings.push(`Duplicate TA crosswalk keys detected: ${xwalkIndex.duplicates.size}`);
  }

  const dueEastern = DateTime.fromISO(config.dueDateIsoEastern, {
    zone: 'America/New_York',
  });

  if (!dueEastern.isValid) {
    errors.push('Invalid Task 3 due date/time.');
    return {
      preview: emptyPreview(processableCount),
      files: [],
      audit: buildAudit({
        task: 'peer_review_participation',
        mode: 'participation',
        generatedAtIso: new Date().toISOString(),
        inputs: {
          gradebook: gradebook.sourceName,
          assignments: assignments.sourceName,
          xwalkTA: xwalkTa?.sourceName ?? 'not-provided',
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
        notes: ['Due date parsing failed.'],
      }),
      issueRows: [],
      errors,
      warnings,
    };
  }

  const classDays = new Set(
    config.classDaysOfWeek.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7),
  );
  const classStartMinutes = parseTimeToMinutes(config.classStartTimeEastern);
  const classEndMinutes = parseTimeToMinutes(config.classEndTimeEastern);

  if (config.classScheduleEnabled) {
    if (classDays.size === 0) {
      errors.push('Class schedule is enabled but no class days are selected.');
    }
    if (classStartMinutes === null || classEndMinutes === null) {
      errors.push('Class schedule start/end time must be in HH:mm format.');
    } else if (classStartMinutes > classEndMinutes) {
      errors.push('Class schedule start time must be before end time.');
    }
  }

  if (errors.length > 0) {
    return {
      preview: emptyPreview(processableCount),
      files: [],
      audit: buildAudit({
        task: 'peer_review_participation',
        mode: 'participation',
        generatedAtIso: new Date().toISOString(),
        inputs: {
          gradebook: gradebook.sourceName,
          assignments: assignments.sourceName,
          xwalkTA: xwalkTa?.sourceName ?? 'not-provided',
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

  const preview = emptyPreview(processableCount);
  const issueReasons: Record<string, number> = {};
  const issueRows: CsvRow[] = [];
  const rows = cloneRows(gradebook.rows);
  const processableRows = gradebookRowsWithStudentId(rows);
  const manualOverrides = config.enableManualJoinOverrides
    ? parseManualJoinOverrides(config.manualJoinOverridesText)
    : new Map<string, string>();
  let manualOverrideUsedCount = 0;

  for (const row of processableRows) {
    const username = row[config.gradebookJoinField] ?? '';
    const identifierValue = row[config.manualJoinIdentifierField] ?? '';
    let key = normalizeKey(username);
    if (!key && config.enableManualJoinOverrides) {
      const override = manualOverrides.get(normalizeKey(identifierValue));
      if (override) {
        key = normalizeKey(override);
        manualOverrideUsedCount += 1;
        incrementReason(issueReasons, 'manual-join-override-used');
      }
    }

    if (!key) {
      preview.skippedRows += 1;
      preview.issueRows += 1;
      incrementReason(issueReasons, 'missing-gradebook-join-key');
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: 'missing-gradebook-join-key',
          details:
            'Gradebook join field is empty and no manual override was found for this identifier.',
        }),
      );
      continue;
    }

    const assignmentRows = assignmentsByReviewer.get(key) ?? [];
    const assignedCount = assignmentRows.length;
    let onTimeFairCount = 0;
    let lateFairCount = 0;
    let unfairCompletedCount = 0;
    let classTimeNoCreditCount = 0;
    let completedCount = 0;
    let parseErrorCount = 0;
    const classTimeCompletions: string[] = [];

    for (const assignmentRow of assignmentRows) {
      const status = normalizeForCompare(assignmentRow[config.statusField]);
      const completedAtRaw = assignmentRow[config.completedAtField] ?? '';
      if (status !== 'completed' || !hasText(completedAtRaw)) {
        continue;
      }

      const parsed = parseCompletedAt(
        completedAtRaw,
        config.completedAtTimezoneMode,
        config.customTimezoneOffset,
      );

      if (!parsed) {
        parseErrorCount += 1;
        continue;
      }

      completedCount += 1;
      const completedEastern = toEastern(parsed);
      const duringClass =
        config.classScheduleEnabled &&
        classStartMinutes !== null &&
        classEndMinutes !== null &&
        isDuringClassWindow(completedEastern, classDays, classStartMinutes, classEndMinutes);
      if (duringClass) {
        classTimeCompletions.push(completedEastern.toFormat('MM/dd/yyyy HH:mm:ss ZZZZ'));
      }

      const fairnessNo = equalsNormalized(assignmentRow[config.fairnessField], 'No');
      if (fairnessNo) {
        unfairCompletedCount += 1;
        continue;
      }

      if (duringClass) {
        classTimeNoCreditCount += 1;
        continue;
      }

      if (completedEastern > dueEastern) {
        lateFairCount += 1;
      } else {
        onTimeFairCount += 1;
      }
    }

    let ta = '';
    let section = '';
    if (xwalkTa && !xwalkIndex.duplicates.has(key)) {
      const xwalkRow = xwalkIndex.map.get(key);
      if (xwalkRow) {
        ta = xwalkRow[config.xwalkTaField] ?? '';
        section = xwalkRow[config.xwalkSectionField] ?? '';
      }
    }

    if (assignedCount === 0) {
      const details = config.assignZeroWhenNoAssignedReviews
        ? 'No peer reviews were assigned to this student for the selected chapter. Assigned participation score = 0 based on configuration.'
        : 'No peer reviews were assigned to this student for the selected chapter. This usually means they did not submit chapter notes for the week. No participation score was written.';

      preview.issueRows += 1;
      incrementReason(issueReasons, 'no-assigned-reviews');
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: 'no-assigned-reviews',
          details,
          reviewsCompleted: '0',
          taEmail: ta,
          section,
        }),
      );

      if (!config.assignZeroWhenNoAssignedReviews) {
        preview.skippedRows += 1;
        continue;
      }

      const before = row[config.assignmentField] ?? '';
      row[config.assignmentField] = '0';
      row[config.feedbackField] = writeFeedbackField(
        row[config.feedbackField] ?? '',
        NO_ASSIGNED_REVIEW_FEEDBACK,
        config.feedbackWriteMode,
      );
      preview.updatedRows += 1;
      trackChange(preview.sampleChanges, {
        key: keyForRow(row),
        field: config.assignmentField,
        before,
        after: row[config.assignmentField],
        note: 'No assigned reviews found; assigned 0 points by configuration.',
      });
      continue;
    }

    if (parseErrorCount > 0) {
      preview.issueRows += 1;
      incrementReason(issueReasons, 'completedat-parse-error');
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: 'completedat-parse-error',
          details: `Could not parse ${parseErrorCount} completion timestamp(s).`,
          reviewsCompleted: String(completedCount),
          taEmail: ta,
          section,
        }),
      );
    }

    if (unfairCompletedCount > 0) {
      preview.issueRows += 1;
      incrementReason(issueReasons, 'fairness-no-reviews');
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: 'fairness-no-reviews',
          details: `${unfairCompletedCount} completed review(s) marked unfair were excluded from participation credit.`,
          reviewsCompleted: String(completedCount),
          taEmail: ta,
          section,
        }),
      );
    }

    if (classTimeCompletions.length > 0) {
      preview.issueRows += 1;
      incrementReason(issueReasons, 'completed-during-class-time');
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: 'completed-during-class-time',
          details: `Completed during class time (Eastern): ${classTimeCompletions.join(' | ')}. These reviews received no participation credit and should be marked as 0 for attendance.`,
          reviewsCompleted: String(completedCount),
          taEmail: ta,
          section,
        }),
      );
    }

    const scoreDenominator = Math.max(assignedCount, 1);
    const onTimePoints =
      (onTimeFairCount / scoreDenominator) * config.assignmentPoints;
    const latePointsRaw =
      (lateFairCount / scoreDenominator) * config.assignmentPoints;
    const lateAdjusted = latePointsRaw * (1 - config.latePenaltyPercent / 100);
    const score = roundAndClamp(onTimePoints + lateAdjusted, 0, config.assignmentPoints);

    const before = row[config.assignmentField] ?? '';
    row[config.assignmentField] = toFixedScore(score);

    const creditedCount = onTimeFairCount + lateFairCount;
    const feedbackParts = [
      `You earned credit for ${creditedCount} out of ${assignedCount} reviews assigned to you.`,
    ];
    if (unfairCompletedCount > 0) {
      feedbackParts.push(
        `No credit earned for ${unfairCompletedCount} review(s) you marked unfair.`,
      );
    }
    if (classTimeNoCreditCount > 0) {
      feedbackParts.push(
        `No credit earned for ${classTimeNoCreditCount} review(s) completed during class time.`,
      );
    }
    if (lateFairCount > 0 && config.latePenaltyPercent > 0) {
      feedbackParts.push(
        `Late penalty applied to ${lateFairCount} review(s) (${config.latePenaltyPercent}% reduction on those reviews).`,
      );
    }

    const generatedFeedback = feedbackParts.join('<br>');
    row[config.feedbackField] = writeFeedbackField(
      row[config.feedbackField] ?? '',
      generatedFeedback,
      config.feedbackWriteMode,
    );

    preview.updatedRows += 1;
    trackChange(preview.sampleChanges, {
      key: keyForRow(row),
      field: config.assignmentField,
      before,
      after: row[config.assignmentField],
      note: `assigned=${assignedCount}, on-time-fair=${onTimeFairCount}, late-fair=${lateFairCount}, unfair=${unfairCompletedCount}, class-time-no-credit=${classTimeNoCreditCount}`,
    });
  }

  preview.skippedRows = preview.totalRows - preview.updatedRows;
  preview.issuesByReason = issueReasons;

  const outputMain: CsvTable = {
    ...gradebook,
    rows,
  };

  const outputName = createMainOutputName(gradebook.sourceName, '_PeerReviewParticipation');
  const issueName = createMainOutputName(
    gradebook.sourceName,
    '_PeerReviewParticipation_Issues',
  );
  const auditName = createAuditName(gradebook.sourceName, '_PeerReviewParticipation');

  const files = [makeCsvFile(outputName, outputMain)];
  if (issueRows.length > 0) {
    const issueTable = makeIssueTable(issueName, issueRows, gradebook.formatMeta);
    files.push(makeCsvFile(issueName, issueTable));

    const perTa = issueTableByTa(issueName, issueRows, gradebook.formatMeta);
    for (const table of perTa.values()) {
      files.push(makeCsvFile(table.sourceName, table));
    }
  }

  const audit = buildAudit({
    task: 'peer_review_participation',
    mode: 'participation',
    generatedAtIso: new Date().toISOString(),
    inputs: {
      gradebook: gradebook.sourceName,
      assignments: assignments.sourceName,
      xwalkTA: xwalkTa?.sourceName ?? 'not-provided',
    },
    mappings: {
      gradebookJoinField: config.gradebookJoinField,
      assignmentsJoinField: config.assignmentsJoinField,
      assignmentField: config.assignmentField,
      feedbackField: config.feedbackField,
      statusField: config.statusField,
      completedAtField: config.completedAtField,
      fairnessField: config.fairnessField,
      manualJoinIdentifierField: config.manualJoinIdentifierField,
    },
    parameters: {
      chapterFilterEnabled: config.chapterFilterEnabled,
      chapterValue,
      requiredReviews: config.requiredReviews,
      assignmentPoints: config.assignmentPoints,
      assignZeroWhenNoAssignedReviews: config.assignZeroWhenNoAssignedReviews,
      latePenaltyPercent: config.latePenaltyPercent,
      dueDateIsoEastern: config.dueDateIsoEastern,
      completedAtTimezoneMode: config.completedAtTimezoneMode,
      customTimezoneOffset: config.customTimezoneOffset,
      classScheduleEnabled: config.classScheduleEnabled,
      classDaysOfWeek: config.classDaysOfWeek.join(','),
      classStartTimeEastern: config.classStartTimeEastern,
      classEndTimeEastern: config.classEndTimeEastern,
      feedbackWriteMode: config.feedbackWriteMode,
      manualJoinOverridesEnabled: config.enableManualJoinOverrides,
      manualJoinOverridesProvided: manualOverrides.size,
      manualJoinOverridesUsed: manualOverrideUsedCount,
    },
    counts: {
      totalRows: preview.totalRows,
      updatedRows: preview.updatedRows,
      skippedRows: preview.skippedRows,
      issueRows: issueRows.length,
    },
    issuesByReason: preview.issuesByReason,
    outputFiles: files.map((file) => file.fileName).concat(auditName),
    notes: warnings,
  });

  files.push(makeJsonFile(auditName, auditToPrettyJson(audit)));

  return {
    preview,
    files,
    audit,
    issueRows,
    errors,
    warnings,
  };
}

export function processTask3Raw(
  gradebook: CsvTable,
  raw: CsvTable,
  assignments: CsvTable,
  xwalkTa: CsvTable | null,
  config: Task3Config,
  rawConfig: Task3RawConfig,
): ProcessorResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const processableCount = gradebookRowsWithStudentId(gradebook.rows).length;

  [config.gradebookJoinField, config.assignmentField, config.feedbackField].forEach((field) => {
    if (!gradebook.headers.includes(field)) {
      errors.push(`Gradebook field not found: ${field}`);
    }
  });

  [
    config.assignmentsChapterField,
    rawConfig.assignmentsTokenField,
    rawConfig.assignmentsReviewerField,
    rawConfig.assignmentsPaperKeyField,
  ].forEach((field) => {
    if (!assignments.headers.includes(field)) {
      errors.push(`Assignments field not found: ${field}`);
    }
  });

  [rawConfig.rawTokenField, rawConfig.rawCompletedAtField, rawConfig.rawFairnessField].forEach(
    (field) => {
      if (!raw.headers.includes(field)) {
        errors.push(`Raw field not found: ${field}`);
      }
    },
  );

  if (errors.length > 0) {
    return {
      preview: emptyPreview(processableCount),
      files: [],
      audit: buildAudit({
        task: 'peer_review_participation',
        mode: 'participation_raw',
        generatedAtIso: new Date().toISOString(),
        inputs: {
          gradebook: gradebook.sourceName,
          raw: raw.sourceName,
          assignments: assignments.sourceName,
          xwalkTA: xwalkTa?.sourceName ?? 'not-provided',
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

  const chapterValue =
    config.chapterFilterEnabled && config.chapterValue
      ? config.chapterValue
      : config.chapterFilterEnabled
        ? detectChapterFromAssignmentField(
            config.assignmentField,
            config.chapterRangeStart,
            config.chapterRangeEnd,
          )
        : '';

  const filteredAssignments = assignments.rows.filter((row) => {
    if (!config.chapterFilterEnabled || !chapterValue) {
      return true;
    }
    return matchesChapter(row[config.assignmentsChapterField], chapterValue);
  });

  const assignmentsByReviewer = buildGroupedIndex(
    filteredAssignments,
    rawConfig.assignmentsReviewerField,
  );
  const assignmentsTokenIndex = buildUniqueIndex(filteredAssignments, rawConfig.assignmentsTokenField);
  if (assignmentsTokenIndex.duplicates.size > 0) {
    warnings.push(
      `Duplicate assignment tokens detected: ${assignmentsTokenIndex.duplicates.size}. Duplicate-token rows are skipped.`,
    );
  }

  const rawTokenIndex = buildUniqueIndex(raw.rows, rawConfig.rawTokenField);
  if (rawTokenIndex.duplicates.size > 0) {
    warnings.push(
      `Duplicate raw review tokens detected: ${rawTokenIndex.duplicates.size}. Duplicate-token rows are skipped.`,
    );
  }

  const xwalkIndex = xwalkTa
    ? buildUniqueIndex(xwalkTa.rows, config.xwalkJoinField)
    : { map: new Map<string, CsvRow>(), duplicates: new Set<string>() };
  if (xwalkTa && xwalkIndex.duplicates.size > 0) {
    warnings.push(`Duplicate TA crosswalk keys detected: ${xwalkIndex.duplicates.size}`);
  }

  const dueEastern = DateTime.fromISO(config.dueDateIsoEastern, {
    zone: 'America/New_York',
  });
  if (!dueEastern.isValid) {
    errors.push('Invalid Task 3 due date/time.');
    return {
      preview: emptyPreview(processableCount),
      files: [],
      audit: buildAudit({
        task: 'peer_review_participation',
        mode: 'participation_raw',
        generatedAtIso: new Date().toISOString(),
        inputs: {
          gradebook: gradebook.sourceName,
          raw: raw.sourceName,
          assignments: assignments.sourceName,
          xwalkTA: xwalkTa?.sourceName ?? 'not-provided',
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
        notes: ['Due date parsing failed.'],
      }),
      issueRows: [],
      errors,
      warnings,
    };
  }

  const classDays = new Set(
    config.classDaysOfWeek.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7),
  );
  const classStartMinutes = parseTimeToMinutes(config.classStartTimeEastern);
  const classEndMinutes = parseTimeToMinutes(config.classEndTimeEastern);

  if (config.classScheduleEnabled) {
    if (classDays.size === 0) {
      errors.push('Class schedule is enabled but no class days are selected.');
    }
    if (classStartMinutes === null || classEndMinutes === null) {
      errors.push('Class schedule start/end time must be in HH:mm format.');
    } else if (classStartMinutes > classEndMinutes) {
      errors.push('Class schedule start time must be before end time.');
    }
  }

  if (errors.length > 0) {
    return {
      preview: emptyPreview(processableCount),
      files: [],
      audit: buildAudit({
        task: 'peer_review_participation',
        mode: 'participation_raw',
        generatedAtIso: new Date().toISOString(),
        inputs: {
          gradebook: gradebook.sourceName,
          raw: raw.sourceName,
          assignments: assignments.sourceName,
          xwalkTA: xwalkTa?.sourceName ?? 'not-provided',
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

  const preview = emptyPreview(processableCount);
  const issueReasons: Record<string, number> = {};
  const issueRows: CsvRow[] = [];
  const rows = cloneRows(gradebook.rows);
  const processableRows = gradebookRowsWithStudentId(rows);
  const manualOverrides = config.enableManualJoinOverrides
    ? parseManualJoinOverrides(config.manualJoinOverridesText)
    : new Map<string, string>();
  let manualOverrideUsedCount = 0;

  for (const row of processableRows) {
    const username = row[config.gradebookJoinField] ?? '';
    const identifierValue = row[config.manualJoinIdentifierField] ?? '';
    let reviewerKey = normalizeKey(username);
    if (!reviewerKey && config.enableManualJoinOverrides) {
      const override = manualOverrides.get(normalizeKey(identifierValue));
      if (override) {
        reviewerKey = normalizeKey(override);
        manualOverrideUsedCount += 1;
        incrementReason(issueReasons, 'manual-join-override-used');
      }
    }

    if (!reviewerKey) {
      preview.skippedRows += 1;
      preview.issueRows += 1;
      incrementReason(issueReasons, 'missing-gradebook-join-key');
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: 'missing-gradebook-join-key',
          details:
            'Gradebook join field is empty and no manual override was found for this identifier.',
        }),
      );
      continue;
    }

    const assignmentRows = assignmentsByReviewer.get(reviewerKey) ?? [];
    const assignedCount = assignmentRows.length;
    let onTimeFairCount = 0;
    let lateFairCount = 0;
    let unfairCompletedCount = 0;
    let classTimeNoCreditCount = 0;
    let completedCount = 0;
    let parseErrorCount = 0;
    let skippedAssignmentDuplicateTokenCount = 0;
    let duplicateRawTokenCount = 0;
    const duplicateRawPaperKeys = new Set<string>();
    const classTimeCompletions: string[] = [];

    for (const assignmentRow of assignmentRows) {
      const token = normalizeKey(assignmentRow[rawConfig.assignmentsTokenField]);
      if (!token) {
        continue;
      }
      if (assignmentsTokenIndex.duplicates.has(token)) {
        skippedAssignmentDuplicateTokenCount += 1;
        continue;
      }
      const rawRow = rawTokenIndex.map.get(token);
      if (!rawRow) {
        continue;
      }
      if (rawTokenIndex.duplicates.has(token)) {
        duplicateRawTokenCount += 1;
        const paperKey = assignmentRow[rawConfig.assignmentsPaperKeyField] ?? '';
        if (hasText(paperKey)) {
          duplicateRawPaperKeys.add(paperKey);
        }
      }

      const completedAtRaw = rawRow[rawConfig.rawCompletedAtField] ?? '';
      if (!hasText(completedAtRaw)) {
        continue;
      }

      const parsed = parseCompletedAt(
        completedAtRaw,
        config.completedAtTimezoneMode,
        config.customTimezoneOffset,
      );
      if (!parsed) {
        parseErrorCount += 1;
        continue;
      }

      completedCount += 1;
      const completedEastern = toEastern(parsed);
      const duringClass =
        config.classScheduleEnabled &&
        classStartMinutes !== null &&
        classEndMinutes !== null &&
        isDuringClassWindow(completedEastern, classDays, classStartMinutes, classEndMinutes);
      if (duringClass) {
        classTimeCompletions.push(completedEastern.toFormat('MM/dd/yyyy HH:mm:ss ZZZZ'));
      }

      const fairnessNo = equalsNormalized(rawRow[rawConfig.rawFairnessField], 'No');
      if (fairnessNo) {
        unfairCompletedCount += 1;
        continue;
      }

      if (duringClass) {
        classTimeNoCreditCount += 1;
        continue;
      }

      if (completedEastern > dueEastern) {
        lateFairCount += 1;
      } else {
        onTimeFairCount += 1;
      }
    }

    let ta = '';
    let section = '';
    if (xwalkTa && !xwalkIndex.duplicates.has(reviewerKey)) {
      const xwalkRow = xwalkIndex.map.get(reviewerKey);
      if (xwalkRow) {
        ta = xwalkRow[config.xwalkTaField] ?? '';
        section = xwalkRow[config.xwalkSectionField] ?? '';
      }
    }

    if (assignedCount === 0) {
      const details = config.assignZeroWhenNoAssignedReviews
        ? 'No peer reviews were assigned to this student for the selected chapter. Assigned participation score = 0 based on configuration.'
        : 'No peer reviews were assigned to this student for the selected chapter. This usually means they did not submit chapter notes for the week. No participation score was written.';

      preview.issueRows += 1;
      incrementReason(issueReasons, 'no-assigned-reviews');
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: 'no-assigned-reviews',
          details,
          reviewsCompleted: '0',
          taEmail: ta,
          section,
        }),
      );

      if (!config.assignZeroWhenNoAssignedReviews) {
        preview.skippedRows += 1;
        continue;
      }

      const before = row[config.assignmentField] ?? '';
      row[config.assignmentField] = '0';
      row[config.feedbackField] = writeFeedbackField(
        row[config.feedbackField] ?? '',
        NO_ASSIGNED_REVIEW_FEEDBACK,
        config.feedbackWriteMode,
      );
      preview.updatedRows += 1;
      trackChange(preview.sampleChanges, {
        key: keyForRow(row),
        field: config.assignmentField,
        before,
        after: row[config.assignmentField],
        note: 'No assigned reviews found; assigned 0 points by configuration.',
      });
      continue;
    }

    if (skippedAssignmentDuplicateTokenCount > 0) {
      preview.issueRows += 1;
      incrementReason(issueReasons, 'duplicate-assignment-token-skipped');
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: 'duplicate-assignment-token-skipped',
          details: `${skippedAssignmentDuplicateTokenCount} assignment token(s) were duplicate and excluded from scoring.`,
          reviewsCompleted: String(completedCount),
          taEmail: ta,
          section,
        }),
      );
    }

    if (duplicateRawTokenCount > 0) {
      preview.issueRows += 1;
      incrementReason(issueReasons, 'duplicate-reviewtoken-submission');
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: 'duplicate-reviewtoken-submission',
          details:
            'Duplicate raw ReviewToken submission detected. First submission is counted; additional duplicates are excluded.',
          notes:
            duplicateRawPaperKeys.size > 0
              ? `Duplicate submissions for paper(s): ${Array.from(duplicateRawPaperKeys).join(', ')}`
              : '',
          reviewsCompleted: String(completedCount),
          taEmail: ta,
          section,
        }),
      );
    }

    if (parseErrorCount > 0) {
      preview.issueRows += 1;
      incrementReason(issueReasons, 'completedat-parse-error');
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: 'completedat-parse-error',
          details: `Could not parse ${parseErrorCount} completion timestamp(s).`,
          reviewsCompleted: String(completedCount),
          taEmail: ta,
          section,
        }),
      );
    }

    if (unfairCompletedCount > 0) {
      preview.issueRows += 1;
      incrementReason(issueReasons, 'fairness-no-reviews');
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: 'fairness-no-reviews',
          details: `${unfairCompletedCount} completed review(s) marked unfair were excluded from participation credit.`,
          reviewsCompleted: String(completedCount),
          taEmail: ta,
          section,
        }),
      );
    }

    if (classTimeCompletions.length > 0) {
      preview.issueRows += 1;
      incrementReason(issueReasons, 'completed-during-class-time');
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: 'completed-during-class-time',
          details: `Completed during class time (Eastern): ${classTimeCompletions.join(' | ')}. These reviews received no participation credit and should be marked as 0 for attendance.`,
          reviewsCompleted: String(completedCount),
          taEmail: ta,
          section,
        }),
      );
    }

    const scoreDenominator = Math.max(assignedCount, 1);
    const onTimePoints = (onTimeFairCount / scoreDenominator) * config.assignmentPoints;
    const latePointsRaw = (lateFairCount / scoreDenominator) * config.assignmentPoints;
    const lateAdjusted = latePointsRaw * (1 - config.latePenaltyPercent / 100);
    const score = roundAndClamp(onTimePoints + lateAdjusted, 0, config.assignmentPoints);

    const before = row[config.assignmentField] ?? '';
    row[config.assignmentField] = toFixedScore(score);

    const creditedCount = onTimeFairCount + lateFairCount;
    const feedbackParts = [
      `You earned credit for ${creditedCount} out of ${assignedCount} reviews assigned to you.`,
    ];
    if (unfairCompletedCount > 0) {
      feedbackParts.push(`No credit earned for ${unfairCompletedCount} review(s) you marked unfair.`);
    }
    if (classTimeNoCreditCount > 0) {
      feedbackParts.push(
        `No credit earned for ${classTimeNoCreditCount} review(s) completed during class time.`,
      );
    }
    if (lateFairCount > 0 && config.latePenaltyPercent > 0) {
      feedbackParts.push(
        `Late penalty applied to ${lateFairCount} review(s) (${config.latePenaltyPercent}% reduction on those reviews).`,
      );
    }
    if (duplicateRawPaperKeys.size > 0) {
      feedbackParts.push(
        `You submitted multiple reviews for paper ${Array.from(duplicateRawPaperKeys).join(', ')}. The first submission was counted.`,
      );
    }

    row[config.feedbackField] = writeFeedbackField(
      row[config.feedbackField] ?? '',
      feedbackParts.join('<br>'),
      config.feedbackWriteMode,
    );

    preview.updatedRows += 1;
    trackChange(preview.sampleChanges, {
      key: keyForRow(row),
      field: config.assignmentField,
      before,
      after: row[config.assignmentField],
      note: `assigned=${assignedCount}, on-time-fair=${onTimeFairCount}, late-fair=${lateFairCount}, unfair=${unfairCompletedCount}, class-time-no-credit=${classTimeNoCreditCount}`,
    });
  }

  preview.skippedRows = preview.totalRows - preview.updatedRows;
  preview.issuesByReason = issueReasons;

  const outputMain: CsvTable = { ...gradebook, rows };
  const outputName = createMainOutputName(gradebook.sourceName, '_PeerReviewParticipation_Raw');
  const issueName = createMainOutputName(
    gradebook.sourceName,
    '_PeerReviewParticipation_Raw_Issues',
  );
  const auditName = createAuditName(gradebook.sourceName, '_PeerReviewParticipation_Raw');

  const files = [makeCsvFile(outputName, outputMain)];
  if (issueRows.length > 0) {
    const issueTable = makeIssueTable(issueName, issueRows, gradebook.formatMeta);
    files.push(makeCsvFile(issueName, issueTable));

    const perTa = issueTableByTa(issueName, issueRows, gradebook.formatMeta);
    for (const table of perTa.values()) {
      files.push(makeCsvFile(table.sourceName, table));
    }
  }

  const audit = buildAudit({
    task: 'peer_review_participation',
    mode: 'participation_raw',
    generatedAtIso: new Date().toISOString(),
    inputs: {
      gradebook: gradebook.sourceName,
      raw: raw.sourceName,
      assignments: assignments.sourceName,
      xwalkTA: xwalkTa?.sourceName ?? 'not-provided',
    },
    mappings: {
      gradebookJoinField: config.gradebookJoinField,
      assignmentsChapterField: config.assignmentsChapterField,
      assignmentField: config.assignmentField,
      feedbackField: config.feedbackField,
      rawTokenField: rawConfig.rawTokenField,
      rawCompletedAtField: rawConfig.rawCompletedAtField,
      rawFairnessField: rawConfig.rawFairnessField,
      assignmentsTokenField: rawConfig.assignmentsTokenField,
      assignmentsReviewerField: rawConfig.assignmentsReviewerField,
      assignmentsPaperKeyField: rawConfig.assignmentsPaperKeyField,
      manualJoinIdentifierField: config.manualJoinIdentifierField,
    },
    parameters: {
      chapterFilterEnabled: config.chapterFilterEnabled,
      chapterValue,
      requiredReviews: config.requiredReviews,
      assignmentPoints: config.assignmentPoints,
      assignZeroWhenNoAssignedReviews: config.assignZeroWhenNoAssignedReviews,
      latePenaltyPercent: config.latePenaltyPercent,
      dueDateIsoEastern: config.dueDateIsoEastern,
      completedAtTimezoneMode: config.completedAtTimezoneMode,
      customTimezoneOffset: config.customTimezoneOffset,
      classScheduleEnabled: config.classScheduleEnabled,
      classDaysOfWeek: config.classDaysOfWeek.join(','),
      classStartTimeEastern: config.classStartTimeEastern,
      classEndTimeEastern: config.classEndTimeEastern,
      feedbackWriteMode: config.feedbackWriteMode,
      manualJoinOverridesEnabled: config.enableManualJoinOverrides,
      manualJoinOverridesProvided: manualOverrides.size,
      manualJoinOverridesUsed: manualOverrideUsedCount,
    },
    counts: {
      totalRows: preview.totalRows,
      updatedRows: preview.updatedRows,
      skippedRows: preview.skippedRows,
      issueRows: issueRows.length,
    },
    issuesByReason: preview.issuesByReason,
    outputFiles: files.map((file) => file.fileName).concat(auditName),
    notes: warnings,
  });

  files.push(makeJsonFile(auditName, auditToPrettyJson(audit)));

  return {
    preview,
    files,
    audit,
    issueRows,
    errors,
    warnings,
  };
}

import { DateTime } from 'luxon';
import type {
  CsvRow,
  CsvTable,
  ProcessorResult,
  RubricComponentConfig,
  Task2RawConfig,
  Task2SharedConfig,
} from '../types';
import {
  cloneRows,
  createAuditName,
  createMainOutputName,
  createIssueRow,
  emptyPreview,
  gradebookRowsWithStudentId,
  ISSUE_HEADERS,
  issueTableByTa,
  keyForRow,
  makeIssueTable,
  parseManualJoinOverrides,
  trackChange,
  writeFeedbackField,
} from './common';
import { buildUniqueIndex } from '../lib/join';
import { buildAudit, incrementReason } from '../lib/audit';
import { makeCsvFile, makeJsonFile } from '../lib/download';
import { auditToPrettyJson } from '../lib/audit';
import {
  equalsNormalized,
  hasText,
  isNeedsGrading,
  isTruthyText,
  normalizeKey,
} from '../lib/text';
import { clamp, parseNumber, roundToTwoDecimals, toFixedScore } from '../lib/math';
import { deriveChapterFromPaperKey, matchesChapter } from '../lib/chapter';

interface ScoreResult {
  value: number;
  detail: string;
}

interface SummaryRunContext {
  summaryRows: CsvRow[];
  summarySourceName: string;
  modeSuffix: string;
  prebuiltIssueRows: CsvRow[];
}

interface RawAggregate {
  username: string;
  chapter: string;
  taEmail: string;
  section: string;
  scoreSums: number[];
  scoreCounts: number[];
  scoreMins: number[];
  scoreMaxs: number[];
  reviewCount: number;
  fairnessNoCount: number;
  integrityCount: number;
  feedback: string[];
  integrityNotes: string[];
  paperKeys: Set<string>;
  paperLinks: Set<string>;
}

function validateRubric(components: RubricComponentConfig[]): string[] {
  const errors: string[] = [];
  if (components.length === 0) {
    errors.push('At least one rubric component is required.');
    return errors;
  }

  let totalWeight = 0;
  components.forEach((component, index) => {
    if (!component.field) {
      errors.push(`Rubric component ${index + 1} is missing a source field.`);
    }
    if (component.totalPoints <= 0) {
      errors.push(`Rubric component ${index + 1} total points must be > 0.`);
    }
    if (component.weightPercent < 0) {
      errors.push(`Rubric component ${index + 1} weight must be >= 0.`);
    }
    totalWeight += component.weightPercent;
  });

  if (Math.abs(totalWeight - 100) > 0.01) {
    errors.push(`Rubric weights must sum to 100. Current total: ${totalWeight.toFixed(2)}`);
  }

  return errors;
}

function computeScore(row: CsvRow, config: Task2SharedConfig): ScoreResult | null {
  if (config.scoringMode === 'rubric_weighted') {
    let weighted = 0;

    for (const component of config.rubricComponents) {
      const raw = parseNumber(row[component.field]);
      if (raw === null) {
        return null;
      }

      const normalized = raw / component.totalPoints;
      weighted += normalized * (component.weightPercent / 100);
    }

    const score = clamp(weighted * config.rubricAssignmentPoints, 0, config.rubricAssignmentPoints);
    return {
      value: roundToTwoDecimals(score),
      detail: `rubric:${weighted.toFixed(4)}`,
    };
  }

  const overallRaw = parseNumber(row[config.overallScoreField]);
  if (overallRaw === null) {
    return null;
  }

  if (config.scaleOverallScore) {
    if (config.overallScoreTotalPoints <= 0) {
      return null;
    }

    const normalized = overallRaw / config.overallScoreTotalPoints;
    const score = clamp(
      normalized * config.overallAssignmentPoints,
      0,
      config.overallAssignmentPoints,
    );

    return {
      value: roundToTwoDecimals(score),
      detail: `overall_scaled:${normalized.toFixed(4)}`,
    };
  }

  return {
    value: roundToTwoDecimals(overallRaw),
    detail: 'overall_raw',
  };
}

function resolveRangeScores(
  row: CsvRow,
  config: Task2SharedConfig,
): {
  values: string[];
  numericValues: Array<number | null>;
} {
  const fields = config.rangeScoreFields.slice(0, 4);
  const values = fields.map((field) => (field ? row[field] ?? '' : ''));
  const numericValues = values.map((value) => parseNumber(value));
  return { values, numericValues };
}

function rawEmailForNotes(row: CsvRow): string {
  const direct = row.Email ?? row.email ?? '';
  if (hasText(direct)) {
    return direct;
  }
  const key = Object.keys(row).find((header) => normalizeKey(header) === 'email');
  return key ? row[key] ?? '' : '';
}

function matchesConfiguredChapter(
  config: Task2SharedConfig,
  paperKey?: string,
  explicitChapter?: string,
): boolean {
  if (!config.chapterFilterEnabled) {
    return true;
  }
  const chapterFromPaperKey = hasText(paperKey ?? '')
    ? deriveChapterFromPaperKey(paperKey ?? '')
    : '';
  const candidateChapter = hasText(chapterFromPaperKey)
    ? chapterFromPaperKey
    : (explicitChapter ?? '');
  if (!hasText(candidateChapter)) {
    return true;
  }
  return matchesChapter(candidateChapter, config.chapterValue);
}

function buildSummaryTableFromRaw(
  raw: CsvTable,
  assignments: CsvTable,
  ownerMap: CsvTable,
  sharedConfig: Task2SharedConfig,
  rawConfig: Task2RawConfig,
): { summaryTable: CsvTable; issueRows: CsvRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const issueRows: CsvRow[] = [];

  const pushRawIssue = (issue: Parameters<typeof createIssueRow>[0], chapterHint = ''): void => {
    if (!matchesConfiguredChapter(sharedConfig, issue.paperKey, chapterHint)) {
      return;
    }
    issueRows.push(createIssueRow(issue));
  };

  const assignmentIndex = buildUniqueIndex(assignments.rows, rawConfig.assignmentsTokenField);
  if (assignmentIndex.duplicates.size > 0) {
    warnings.push(
      `Duplicate assignment token keys detected: ${assignmentIndex.duplicates.size}`,
    );
  }

  const ownerIndex = buildUniqueIndex(ownerMap.rows, rawConfig.ownerMapAnonKeyField);
  if (ownerIndex.duplicates.size > 0) {
    warnings.push(
      `Duplicate owner map keys detected: ${ownerIndex.duplicates.size}`,
    );
  }

  const aggregateMap = new Map<string, RawAggregate>();
  const seenRawTokens = new Set<string>();

  for (const rawRow of raw.rows) {
    const token = normalizeKey(rawRow[rawConfig.rawTokenField]);
    if (!token) {
      pushRawIssue({
        username: '',
        reason: 'missing-review-token',
        details: 'Raw row has empty ReviewToken',
        paperKey: rawRow[rawConfig.rawPaperKeyField] ?? '',
      });
      continue;
    }

    if (seenRawTokens.has(token)) {
      const duplicateAssignment = assignmentIndex.map.get(token);
      pushRawIssue({
        username: '',
        reason: 'duplicate-reviewtoken-submission',
        details: 'Duplicate raw ReviewToken submission detected. First submission is used.',
        notes: hasText(rawEmailForNotes(rawRow))
          ? `Raw email: ${rawEmailForNotes(rawRow)}`
          : '',
        paperKey:
          duplicateAssignment?.[rawConfig.assignmentsPaperKeyField] ??
          rawRow[rawConfig.rawPaperKeyField] ??
          '',
        paperLink: duplicateAssignment?.[rawConfig.assignmentsPaperLinkField] ?? '',
      });
      continue;
    }
    seenRawTokens.add(token);

    if (assignmentIndex.duplicates.has(token)) {
      pushRawIssue({
        username: '',
        reason: 'duplicate-review-token',
        details: `Token duplicated in assignments: ${token}`,
        paperKey: rawRow[rawConfig.rawPaperKeyField] ?? '',
      });
      continue;
    }

    const assignmentRow = assignmentIndex.map.get(token);
    if (!assignmentRow) {
      pushRawIssue({
        username: '',
        reason: 'token-not-found-in-assignments',
        details: `Token missing from assignments: ${token}`,
        notes: hasText(rawEmailForNotes(rawRow))
          ? `Raw email: ${rawEmailForNotes(rawRow)}`
          : '',
        paperKey: rawRow[rawConfig.rawPaperKeyField] ?? '',
      });
      continue;
    }

    const paperKey =
      assignmentRow[rawConfig.assignmentsPaperKeyField] || rawRow[rawConfig.rawPaperKeyField] || '';
    const paperLink = assignmentRow[rawConfig.assignmentsPaperLinkField] || '';
    const normalizedPaperKey = normalizeKey(paperKey);
    if (!normalizedPaperKey) {
      pushRawIssue({
        username: '',
        reason: 'missing-paperkey',
        details: `Token ${token} has no PaperKey`,
        paperLink,
      });
      continue;
    }

    if (ownerIndex.duplicates.has(normalizedPaperKey)) {
      pushRawIssue({
        username: '',
        reason: 'duplicate-owner-map-key',
        details: `PaperKey duplicated in owner map: ${paperKey}`,
        paperKey,
        paperLink,
      });
      continue;
    }

    const ownerRow = ownerIndex.map.get(normalizedPaperKey);
    if (!ownerRow) {
      pushRawIssue({
        username: '',
        reason: 'paperkey-not-found-in-owner-map',
        details: `PaperKey missing from owner map: ${paperKey}`,
        paperKey,
        paperLink,
      });
      continue;
    }

    const username = ownerRow[rawConfig.ownerMapUsernameField] ?? '';
    if (!hasText(username)) {
      pushRawIssue({
        username: '',
        reason: 'owner-username-missing',
        details: `PaperKey ${paperKey} has empty owner username`,
        paperKey,
        paperLink,
      });
      continue;
    }

    const chapterFromOwner = ownerRow[rawConfig.ownerMapChapterField] ?? '';
    const chapterFromPaperKey = deriveChapterFromPaperKey(paperKey);
    const chapter = chapterFromPaperKey || chapterFromOwner;
    if (sharedConfig.chapterFilterEnabled && !matchesChapter(chapter, sharedConfig.chapterValue)) {
      continue;
    }

    const aggregateKey = normalizeKey(username);
    const existing = aggregateMap.get(aggregateKey);
    const aggregate: RawAggregate =
      existing ?? {
        username,
        chapter,
        taEmail: ownerRow[rawConfig.ownerMapTaField] ?? '',
        section: ownerRow[rawConfig.ownerMapSectionField] ?? '',
        scoreSums: rawConfig.rawScoreFields.map(() => 0),
        scoreCounts: rawConfig.rawScoreFields.map(() => 0),
        scoreMins: rawConfig.rawScoreFields.map(() => Number.POSITIVE_INFINITY),
        scoreMaxs: rawConfig.rawScoreFields.map(() => Number.NEGATIVE_INFINITY),
        reviewCount: 0,
        fairnessNoCount: 0,
        integrityCount: 0,
        feedback: [],
        integrityNotes: [],
        paperKeys: new Set<string>(),
        paperLinks: new Set<string>(),
      };

    if (hasText(paperKey)) {
      aggregate.paperKeys.add(paperKey);
    }
    if (hasText(paperLink)) {
      aggregate.paperLinks.add(paperLink);
    }

    const fairnessNo = equalsNormalized(rawRow[rawConfig.rawFairnessField], 'No');
    if (fairnessNo) {
      aggregate.fairnessNoCount += 1;
      if (!sharedConfig.includeFairnessFlaggedReviewsInScoreCalculation) {
        aggregateMap.set(aggregateKey, aggregate);
        continue;
      }
    }

    rawConfig.rawScoreFields.forEach((field, index) => {
      const numeric = parseNumber(rawRow[field]);
      if (numeric !== null) {
        aggregate.scoreSums[index] += numeric;
        aggregate.scoreCounts[index] += 1;
        aggregate.scoreMins[index] = Math.min(aggregate.scoreMins[index], numeric);
        aggregate.scoreMaxs[index] = Math.max(aggregate.scoreMaxs[index], numeric);
      }
    });

    const feedback = rawRow[rawConfig.rawFeedbackField] ?? '';
    if (hasText(feedback)) {
      aggregate.feedback.push(`<br><b>Feedback: </b>${feedback}<br>---<br>`);
    }

    const integrityValue = rawRow[rawConfig.rawIntegrityField] ?? '';
    if (hasText(integrityValue) && !equalsNormalized(integrityValue, 'Not Applicable')) {
      aggregate.integrityCount += 1;
      const note = rawRow[rawConfig.rawIntegrityNotesField] ?? '';
      if (hasText(note)) {
        aggregate.integrityNotes.push(note);
      }
    }

    aggregate.reviewCount += 1;
    aggregateMap.set(aggregateKey, aggregate);
  }

  const summaryHeaders = [
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

  const summaryRows: CsvRow[] = [];
  for (const aggregate of aggregateMap.values()) {
    const averages = rawConfig.rawScoreFields.map((_, index) => {
      const count = aggregate.scoreCounts[index];
      if (count === 0) {
        return '';
      }
      return roundToTwoDecimals(aggregate.scoreSums[index] / count).toFixed(3);
    });

    const numericAverages = averages
      .map((value) => parseNumber(value))
      .filter((value): value is number => value !== null);
    const rangeScores = rawConfig.rawScoreFields.map((_, index) => {
      const count = aggregate.scoreCounts[index];
      if (count === 0) {
        return '';
      }
      const range = aggregate.scoreMaxs[index] - aggregate.scoreMins[index];
      return roundToTwoDecimals(range).toFixed(3);
    });
    const hasRangeFlag = rangeScores.some((value) => {
      const parsed = parseNumber(value);
      return parsed !== null && parsed >= sharedConfig.rangeThreshold;
    });
    const overallAverage =
      numericAverages.length > 0
        ? roundToTwoDecimals(
            numericAverages.reduce((acc, value) => acc + value, 0) / numericAverages.length,
          ).toFixed(3)
        : '';

    const paperKeys = Array.from(aggregate.paperKeys).sort((a, b) => a.localeCompare(b));
    const paperLinks = Array.from(aggregate.paperLinks).sort((a, b) => a.localeCompare(b));
    if (paperKeys.length > 1) {
      pushRawIssue(
        {
          username: aggregate.username,
          reason: 'multiple-paperkeys-for-owner',
          details:
            'Multiple PaperKeys mapped to the same owner after chapter filtering. First PaperKey is used in summary output.',
          paperKey: paperKeys.join(' | '),
          paperLink: paperLinks.join(' | '),
          taEmail: aggregate.taEmail,
          section: aggregate.section,
        },
        aggregate.chapter,
      );
    }

    summaryRows.push({
      Username: aggregate.username,
      Chapter: aggregate.chapter,
      PaperKey: paperKeys[0] ?? '',
      PaperLink: paperLinks[0] ?? '',
      AvgScore1: averages[0] ?? '',
      AvgScore2: averages[1] ?? '',
      AvgScore3: averages[2] ?? '',
      AvgScore4: averages[3] ?? '',
      RangeScore1: rangeScores[0] ?? '',
      RangeScore2: rangeScores[1] ?? '',
      RangeScore3: rangeScores[2] ?? '',
      RangeScore4: rangeScores[3] ?? '',
      AvgScoreOverall: overallAverage,
      RangeFlag: hasRangeFlag ? 'True' : 'False',
      ReviewsCompleted: String(aggregate.reviewCount),
      FairnessNoCount: String(aggregate.fairnessNoCount),
      IntegrityFlagCount: String(aggregate.integrityCount),
      PeerFeedback: aggregate.feedback.join(''),
      IntegrityNotes: aggregate.integrityNotes.join(' | '),
      TAEmail: aggregate.taEmail,
      Section: aggregate.section,
    });
  }

  const summaryTable: CsvTable = {
    sourceName: `${raw.sourceName}_Aggregated.csv`,
    headers: summaryHeaders,
    rows: summaryRows,
    formatMeta: raw.formatMeta,
  };

  return {
    summaryTable,
    issueRows,
    warnings,
  };
}

function processTask2SummaryCore(
  gradebook: CsvTable,
  summary: CsvTable,
  xwalkTa: CsvTable | null,
  config: Task2SharedConfig,
  context: SummaryRunContext,
): ProcessorResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const processableCount = gradebookRowsWithStudentId(gradebook.rows).length;

  const rubricErrors =
    config.scoringMode === 'rubric_weighted' ? validateRubric(config.rubricComponents) : [];
  errors.push(...rubricErrors);

  const requiredGradebookFields = [
    config.gradebookJoinField,
    config.assignmentField,
    config.gradebookFeedbackField,
  ];

  requiredGradebookFields.forEach((field) => {
    if (!gradebook.headers.includes(field)) {
      errors.push(`Gradebook field not found: ${field}`);
    }
  });

  const requiredSummaryFields = [
    config.summaryJoinField,
    config.reviewsCompletedField,
    config.fairnessCountField,
    config.integrityField,
    config.feedbackSourceField,
  ];

  if (config.chapterFilterEnabled) {
    requiredSummaryFields.push(config.summaryChapterField);
  }

  if (config.rangeFlagField) {
    requiredSummaryFields.push(config.rangeFlagField);
  }
  if (config.rangeExclusionEnabled) {
    config.rangeScoreFields.forEach((field) => {
      if (field) {
        requiredSummaryFields.push(field);
      }
    });
  }
  if (config.integrityNotesField) {
    requiredSummaryFields.push(config.integrityNotesField);
  }
  if (config.taField) {
    requiredSummaryFields.push(config.taField);
  }
  if (config.sectionField) {
    requiredSummaryFields.push(config.sectionField);
  }

  if (config.scoringMode === 'rubric_weighted') {
    config.rubricComponents.forEach((component) => requiredSummaryFields.push(component.field));
  } else {
    requiredSummaryFields.push(config.overallScoreField);
  }

  requiredSummaryFields.forEach((field) => {
    if (field && !summary.headers.includes(field)) {
      errors.push(`Summary field not found: ${field}`);
    }
  });

  if (errors.length > 0) {
    return {
      preview: emptyPreview(processableCount),
      files: [],
      audit: buildAudit({
        task: 'peer_review_summary',
        mode: context.modeSuffix,
        generatedAtIso: DateTime.utc().toISO() ?? new Date().toISOString(),
        inputs: {
          gradebook: gradebook.sourceName,
          summary: context.summarySourceName,
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

  const filteredSummaryRows = config.chapterFilterEnabled
    ? summary.rows.filter((row) => matchesChapter(row[config.summaryChapterField], config.chapterValue))
    : summary.rows;

  const summaryIndex = buildUniqueIndex(filteredSummaryRows, config.summaryJoinField);
  if (summaryIndex.duplicates.size > 0) {
    warnings.push(
      `Duplicate summary join keys detected: ${summaryIndex.duplicates.size}. Affected rows will be skipped.`,
    );
  }

  const xwalkIndex = xwalkTa
    ? buildUniqueIndex(xwalkTa.rows, config.xwalkTaJoinField)
    : { map: new Map<string, CsvRow>(), duplicates: new Set<string>() };

  const rows = cloneRows(gradebook.rows);
  const processableRows = gradebookRowsWithStudentId(rows);
  const issueRows: CsvRow[] = [...context.prebuiltIssueRows];
  const preview = emptyPreview(processableRows.length);
  const issueReasons: Record<string, number> = {};
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

    if (config.onlyUpdateNeedsGrading && !isNeedsGrading(row[config.assignmentField])) {
      preview.skippedRows += 1;
      incrementReason(issueReasons, 'already-graded');
      continue;
    }

    if (summaryIndex.duplicates.has(key)) {
      preview.skippedRows += 1;
      preview.issueRows += 1;
      incrementReason(issueReasons, 'duplicate-summary-join-key');
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: 'duplicate-summary-join-key',
          details: 'Multiple summary records match this user.',
        }),
      );
      continue;
    }

    const summaryRow = summaryIndex.map.get(key);
    if (!summaryRow) {
      let ta = '';
      let section = '';
      if (xwalkTa && !xwalkIndex.duplicates.has(key)) {
        const xwalkRow = xwalkIndex.map.get(key);
        if (xwalkRow) {
          ta = xwalkRow[config.xwalkTaField] ?? '';
          section = xwalkRow[config.xwalkSectionField] ?? '';
        }
      }

      const likelyLateSubmission = isNeedsGrading(row[config.assignmentField]);
      const reason = likelyLateSubmission
        ? 'needs-review-late-submission'
        : 'missing-summary-row';
      const details = likelyLateSubmission
        ? 'No summary record matched this Needs Grading row. Likely submitted late; route to TA Needs Review list for manual grading.'
        : 'No summary record matched this gradebook row after chapter filter and join key mapping.';
      preview.skippedRows += 1;
      preview.issueRows += 1;
      incrementReason(issueReasons, reason);
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason,
          details,
          taEmail: ta,
          section,
        }),
      );
      continue;
    }

    const reviewsCompleted = parseNumber(summaryRow[config.reviewsCompletedField]) ?? 0;
    const fairnessNoCount = parseNumber(summaryRow[config.fairnessCountField]) ?? 0;
    const integrityCount = parseNumber(summaryRow[config.integrityField]) ?? 0;
    const paperKey = hasText(summaryRow.PaperKey ?? '')
      ? (summaryRow.PaperKey ?? '')
      : (summaryRow.AnonKey ?? '');
    const paperLink = hasText(summaryRow.PaperLink ?? '')
      ? (summaryRow.PaperLink ?? '')
      : (summaryRow.FileLink ?? '');
    const { values: rangeScoreValues, numericValues: rangeScoreNumeric } = resolveRangeScores(
      summaryRow,
      config,
    );
    const hasRangeScores = rangeScoreNumeric.some((value) => value !== null);
    const rangeFlagFromField = config.rangeFlagField
      ? isTruthyText(summaryRow[config.rangeFlagField])
      : false;
    const rangeFlagFromThreshold = rangeScoreNumeric.some(
      (value) => value !== null && value >= config.rangeThreshold,
    );
    const rangeThresholdHit = hasRangeScores ? rangeFlagFromThreshold : rangeFlagFromField;
    const rangeExcluded = config.rangeExclusionEnabled && rangeThresholdHit;

    const taFromSummary = config.taField ? summaryRow[config.taField] ?? '' : '';
    const sectionFromSummary = config.sectionField ? summaryRow[config.sectionField] ?? '' : '';

    let ta = taFromSummary;
    let section = sectionFromSummary;
    if ((!hasText(ta) || !hasText(section)) && xwalkTa) {
      const xwalkKey = normalizeKey(summaryRow[config.xwalkTaUsernameField] ?? summaryRow[config.summaryJoinField]);
      if (xwalkKey && !xwalkIndex.duplicates.has(xwalkKey)) {
        const xwalkRow = xwalkIndex.map.get(xwalkKey);
        if (xwalkRow) {
          ta = ta || xwalkRow[config.xwalkTaField] || '';
          section = section || xwalkRow[config.xwalkSectionField] || '';
        }
      }
    }

    const exclusionReasons: string[] = [];
    const advisoryReasons: string[] = [];
    if (reviewsCompleted < config.minReviews) {
      exclusionReasons.push('below-min-reviews');
    }
    if (rangeExcluded) {
      exclusionReasons.push('range-flag');
    }
    if (integrityCount > 0) {
      advisoryReasons.push('integrity-flag');
    }
    if (fairnessNoCount > 0) {
      advisoryReasons.push('fairness-flag-present');
    }
    if (rangeThresholdHit && !config.rangeExclusionEnabled) {
      advisoryReasons.push('range-flag');
    }

    if (exclusionReasons.length > 0) {
      if (
        config.includeFeedbackWhenBelowMinReviews &&
        exclusionReasons.includes('below-min-reviews')
      ) {
        const summaryFeedback = summaryRow[config.feedbackSourceField] ?? '';
        let generatedFeedback = summaryFeedback;
        if (config.addUniversalFeedback && hasText(config.universalFeedback)) {
          generatedFeedback = hasText(summaryFeedback)
            ? `${config.universalFeedback}<br><b>Peer Review Feedback:</b><br>${summaryFeedback}`
            : config.universalFeedback;
        }
        row[config.gradebookFeedbackField] = writeFeedbackField(
          row[config.gradebookFeedbackField] ?? '',
          generatedFeedback,
          config.feedbackWriteMode,
        );
      }

      const allIssueReasons = Array.from(new Set([...exclusionReasons, ...advisoryReasons]));
      preview.skippedRows += 1;
      preview.issueRows += 1;
      allIssueReasons.forEach((reason) => incrementReason(issueReasons, reason));
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: allIssueReasons.join('|'),
          details: rangeThresholdHit
            ? `Excluded by Task 2 flag policy. Range threshold is ${config.rangeThreshold}+ across RangeScore fields.`
            : 'Excluded by Task 2 flag policy.',
          notes:
            fairnessNoCount > 0
              ? `Fairness flag count: ${fairnessNoCount}. Included in scoring: ${config.includeFairnessFlaggedReviewsInScoreCalculation}.`
              : '',
          paperKey,
          paperLink,
          reviewsCompleted: summaryRow[config.reviewsCompletedField],
          rangeFlag: config.rangeFlagField ? summaryRow[config.rangeFlagField] : '',
          rangeScore1: rangeScoreValues[0] ?? '',
          rangeScore2: rangeScoreValues[1] ?? '',
          rangeScore3: rangeScoreValues[2] ?? '',
          rangeScore4: rangeScoreValues[3] ?? '',
          integrityFlagCount: summaryRow[config.integrityField],
          integrityNotes: config.integrityNotesField
            ? summaryRow[config.integrityNotesField]
            : '',
          peerFeedback: summaryRow[config.feedbackSourceField] ?? '',
          taEmail: ta,
          section,
        }),
      );
      continue;
    }

    const score = computeScore(summaryRow, config);
    if (!score) {
      preview.skippedRows += 1;
      preview.issueRows += 1;
      incrementReason(issueReasons, 'missing-or-invalid-score');
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: 'missing-or-invalid-score',
          details: 'Required score fields are empty or non-numeric.',
          notes:
            fairnessNoCount > 0
              ? `Fairness flag count: ${fairnessNoCount}.`
              : '',
          paperKey,
          paperLink,
          reviewsCompleted: summaryRow[config.reviewsCompletedField],
          rangeFlag: config.rangeFlagField ? summaryRow[config.rangeFlagField] : '',
          rangeScore1: rangeScoreValues[0] ?? '',
          rangeScore2: rangeScoreValues[1] ?? '',
          rangeScore3: rangeScoreValues[2] ?? '',
          rangeScore4: rangeScoreValues[3] ?? '',
          integrityFlagCount: summaryRow[config.integrityField],
          integrityNotes: config.integrityNotesField
            ? summaryRow[config.integrityNotesField]
            : '',
          peerFeedback: summaryRow[config.feedbackSourceField] ?? '',
          taEmail: ta,
          section,
        }),
      );
      continue;
    }

    let finalScoreValue = score.value;
    if (
      fairnessNoCount > 0 &&
      !config.includeFairnessFlaggedReviewsInScoreCalculation &&
      reviewsCompleted > 0
    ) {
      const fairFraction = Math.max(reviewsCompleted - fairnessNoCount, 0) / reviewsCompleted;
      finalScoreValue = roundToTwoDecimals(score.value * fairFraction);
    }

    const before = row[config.assignmentField] ?? '';
    row[config.assignmentField] = toFixedScore(finalScoreValue);

    const summaryFeedback = summaryRow[config.feedbackSourceField] ?? '';
    let generatedFeedback = summaryFeedback;
    if (config.addUniversalFeedback && hasText(config.universalFeedback)) {
      generatedFeedback = hasText(summaryFeedback)
        ? `${config.universalFeedback}<br><b>Peer Review Feedback:</b><br>${summaryFeedback}`
        : config.universalFeedback;
    }

    row[config.gradebookFeedbackField] = writeFeedbackField(
      row[config.gradebookFeedbackField] ?? '',
      generatedFeedback,
      config.feedbackWriteMode,
    );

    preview.updatedRows += 1;

    if (advisoryReasons.length > 0) {
      preview.issueRows += 1;
      advisoryReasons.forEach((reason) => incrementReason(issueReasons, reason));
      issueRows.push(
        createIssueRow({
          username,
          gradebookIdentifier: identifierValue,
          reason: advisoryReasons.join('|'),
          details: 'Included in score update; flagged for TA review.',
          notes:
            fairnessNoCount > 0
              ? `Fairness flag count: ${fairnessNoCount}. Included in scoring: ${config.includeFairnessFlaggedReviewsInScoreCalculation}.`
              : '',
          paperKey,
          paperLink,
          reviewsCompleted: summaryRow[config.reviewsCompletedField],
          rangeFlag: config.rangeFlagField ? summaryRow[config.rangeFlagField] : '',
          rangeScore1: rangeScoreValues[0] ?? '',
          rangeScore2: rangeScoreValues[1] ?? '',
          rangeScore3: rangeScoreValues[2] ?? '',
          rangeScore4: rangeScoreValues[3] ?? '',
          integrityFlagCount: summaryRow[config.integrityField],
          integrityNotes: config.integrityNotesField
            ? summaryRow[config.integrityNotesField]
            : '',
          peerFeedback: summaryRow[config.feedbackSourceField] ?? '',
          taEmail: ta,
          section,
        }),
      );
    }

    trackChange(preview.sampleChanges, {
      key: keyForRow(row),
      field: config.assignmentField,
      before,
      after: row[config.assignmentField],
      note: score.detail,
    });
  }

  preview.issuesByReason = issueReasons;

  const outputMainTable: CsvTable = {
    ...gradebook,
    rows,
  };

  const baseSuffix = context.modeSuffix === 'raw' ? '_PeerReviewSummary_Raw' : '_PeerReviewSummary';
  const outputName = createMainOutputName(gradebook.sourceName, baseSuffix);
  const issueName = createMainOutputName(gradebook.sourceName, `${baseSuffix}_Issues`);
  const auditName = createAuditName(gradebook.sourceName, baseSuffix);

  const files = [makeCsvFile(outputName, outputMainTable)];
  if (issueRows.length > 0) {
    const issueTable = makeIssueTable(issueName, issueRows, gradebook.formatMeta);
    files.push(makeCsvFile(issueName, issueTable));

    const perTa = issueTableByTa(issueName, issueRows, gradebook.formatMeta);
    for (const table of perTa.values()) {
      files.push(makeCsvFile(table.sourceName, table));
    }
  }

  const audit = buildAudit({
    task: 'peer_review_summary',
    mode: context.modeSuffix,
    generatedAtIso: DateTime.utc().toISO() ?? new Date().toISOString(),
    inputs: {
      gradebook: gradebook.sourceName,
      summary: context.summarySourceName,
      xwalkTA: xwalkTa?.sourceName ?? 'not-provided',
    },
    mappings: {
      gradebookJoinField: config.gradebookJoinField,
      summaryJoinField: config.summaryJoinField,
      assignmentField: config.assignmentField,
      gradebookFeedbackField: config.gradebookFeedbackField,
      feedbackSourceField: config.feedbackSourceField,
      reviewsCompletedField: config.reviewsCompletedField,
      fairnessCountField: config.fairnessCountField,
      integrityField: config.integrityField,
      rangeFlagField: config.rangeFlagField,
      rangeScoreField1: config.rangeScoreFields[0] ?? '',
      rangeScoreField2: config.rangeScoreFields[1] ?? '',
      rangeScoreField3: config.rangeScoreFields[2] ?? '',
      rangeScoreField4: config.rangeScoreFields[3] ?? '',
      taField: config.taField,
      sectionField: config.sectionField,
      manualJoinIdentifierField: config.manualJoinIdentifierField,
    },
    parameters: {
      chapterFilterEnabled: config.chapterFilterEnabled,
      chapterValue: config.chapterValue,
      minReviews: config.minReviews,
      includeFairnessFlaggedReviewsInScoreCalculation:
        config.includeFairnessFlaggedReviewsInScoreCalculation,
      rangeExclusionEnabled: config.rangeExclusionEnabled,
      rangeThreshold: config.rangeThreshold,
      includeFeedbackWhenBelowMinReviews: config.includeFeedbackWhenBelowMinReviews,
      onlyUpdateNeedsGrading: config.onlyUpdateNeedsGrading,
      scoringMode: config.scoringMode,
      rubricAssignmentPoints: config.rubricAssignmentPoints,
      overallAssignmentPoints: config.overallAssignmentPoints,
      overallScoreTotalPoints: config.overallScoreTotalPoints,
      feedbackWriteMode: config.feedbackWriteMode,
      addUniversalFeedback: config.addUniversalFeedback,
      issueSeedRows: context.prebuiltIssueRows.length,
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

export function processTask2Summary(
  gradebook: CsvTable,
  summary: CsvTable,
  xwalkTa: CsvTable | null,
  config: Task2SharedConfig,
): ProcessorResult {
  const summaryModeConfig: Task2SharedConfig = {
    ...config,
    includeFairnessFlaggedReviewsInScoreCalculation: true,
  };
  return processTask2SummaryCore(gradebook, summary, xwalkTa, summaryModeConfig, {
    summaryRows: summary.rows,
    summarySourceName: summary.sourceName,
    modeSuffix: 'summary',
    prebuiltIssueRows: [],
  });
}

export function processTask2Raw(
  gradebook: CsvTable,
  raw: CsvTable,
  assignments: CsvTable,
  ownerMap: CsvTable,
  xwalkTa: CsvTable | null,
  sharedConfig: Task2SharedConfig,
  rawConfig: Task2RawConfig,
): ProcessorResult {
  const aggregation = buildSummaryTableFromRaw(
    raw,
    assignments,
    ownerMap,
    sharedConfig,
    rawConfig,
  );

  const result = processTask2SummaryCore(
    gradebook,
    aggregation.summaryTable,
    xwalkTa,
    sharedConfig,
    {
      summaryRows: aggregation.summaryTable.rows,
      summarySourceName: aggregation.summaryTable.sourceName,
      modeSuffix: 'raw',
      prebuiltIssueRows: aggregation.issueRows,
    },
  );

  result.warnings.push(...aggregation.warnings);
  return result;
}

export const TASK2_ISSUE_HEADERS = ISSUE_HEADERS;

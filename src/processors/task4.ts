import { DateTime } from 'luxon';
import type {
  BellCurveStats,
  CsvRow,
  CsvTable,
  ProcessorResult,
  Task4Config,
} from '../types';
import {
  cloneRows,
  createMainOutputName,
  createAuditName,
  emptyPreview,
  gradebookRowsWithStudentId,
  keyForRow,
  trackChange,
  writeFeedbackField,
} from './common';
import { buildAudit } from '../lib/audit';
import { auditToPrettyJson } from '../lib/audit';
import { makeCsvFile, makeJsonFile } from '../lib/download';
import { clamp, parseNumber, roundToTwoDecimals, toFixedScore } from '../lib/math';
import { hasText, isNeedsGrading } from '../lib/text';

/**
 * Determines if a row should be skipped from curving.
 * Returns a reason string if skipped, null if the row should be curved.
 */
function shouldSkipRow(
  row: CsvRow,
  currentScore: number | null,
  config: Task4Config,
): string | null {
  const rawValue = row[config.assignmentField] ?? '';

  if (config.skipNoSubmission && (!hasText(rawValue) || isNeedsGrading(rawValue))) {
    return 'no-submission';
  }

  if (currentScore === null) {
    return 'non-numeric';
  }

  if (config.skipZeros && currentScore === 0) {
    return 'zero-score';
  }

  return null;
}

/**
 * Compute bell-curve statistics from the eligible numeric grades.
 */
export function computeBellCurveStats(
  rows: CsvRow[],
  config: Task4Config,
): BellCurveStats {
  const scores: number[] = [];

  for (const row of gradebookRowsWithStudentId(rows)) {
    const rawValue = row[config.assignmentField] ?? '';
    if (!hasText(rawValue) || isNeedsGrading(rawValue)) continue;
    const score = parseNumber(rawValue);
    if (score === null) continue;
    if (score === 0) continue;
    scores.push(score);
  }

  if (scores.length === 0) {
    return { count: 0, mean: 0, median: 0, stdDev: 0, min: 0, max: 0 };
  }

  scores.sort((a, b) => a - b);
  const count = scores.length;
  const sum = scores.reduce((acc, s) => acc + s, 0);
  const mean = sum / count;
  const median =
    count % 2 === 0
      ? (scores[count / 2 - 1] + scores[count / 2]) / 2
      : scores[Math.floor(count / 2)];
  const variance = scores.reduce((acc, s) => acc + (s - mean) ** 2, 0) / count;
  const stdDev = Math.sqrt(variance);

  return {
    count,
    mean: roundToTwoDecimals(mean),
    median: roundToTwoDecimals(median),
    stdDev: roundToTwoDecimals(stdDev),
    min: scores[0],
    max: scores[count - 1],
  };
}

/**
 * Calculate the bell-curve shift: targetMean - currentMean.
 * Returns 0 if the shift would be negative (guardrail: only curve up).
 */
export function calculateBellCurveShift(
  stats: BellCurveStats,
  targetMean: number,
): number {
  if (stats.count === 0) return 0;
  const shift = targetMean - stats.mean;
  return Math.max(0, roundToTwoDecimals(shift));
}

/**
 * Resolve the effective curve points for a given mode.
 */
function resolveEffectiveCurvePoints(config: Task4Config, bellCurveShift: number): number {
  switch (config.curveMode) {
    case 'fixed_points':
      return config.curvePoints;
    case 'percentage':
      return roundToTwoDecimals((config.curvePercent / 100) * config.totalPointsPossible);
    case 'bell_curve':
      return bellCurveShift;
  }
}

/**
 * Build the curve feedback text for a single student.
 */
function buildCurveFeedback(
  curveAmount: number,
  totalPointsPossible: number,
  display: Task4Config['feedbackDisplay'],
): string {
  const pointsText = `${curveAmount >= 0 ? '+' : ''}${toFixedScore(curveAmount)} points`;
  const pctValue = totalPointsPossible > 0
    ? roundToTwoDecimals((curveAmount / totalPointsPossible) * 100)
    : 0;
  const pctText = `${pctValue >= 0 ? '+' : ''}${pctValue.toFixed(1)}%`;

  switch (display) {
    case 'points':
      return `[Curve applied: ${pointsText}]`;
    case 'percentage':
      return `[Curve applied: ${pctText} of total points]`;
    case 'both':
      return `[Curve applied: ${pointsText} (${pctText} of total points)]`;
  }
}

export function processTask4(
  gradebook: CsvTable,
  config: Task4Config,
): ProcessorResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!gradebook.headers.includes(config.assignmentField)) {
    errors.push(`Assignment field not found in gradebook: ${config.assignmentField}`);
  }
  if (config.includeCurveFeedback && !gradebook.headers.includes(config.feedbackField)) {
    errors.push(`Feedback field not found in gradebook: ${config.feedbackField}`);
  }
  if (config.totalPointsPossible <= 0) {
    errors.push('Total points possible must be greater than 0.');
  }

  const processableCount = gradebookRowsWithStudentId(gradebook.rows).length;

  if (errors.length > 0) {
    return {
      preview: emptyPreview(processableCount),
      files: [],
      audit: buildAudit({
        task: 'grade_curve',
        mode: config.curveMode,
        generatedAtIso: DateTime.utc().toISO() ?? new Date().toISOString(),
        inputs: { gradebook: gradebook.sourceName },
        mappings: {},
        parameters: {},
        counts: { totalRows: processableCount, updatedRows: 0, skippedRows: processableCount, issueRows: 0 },
        issuesByReason: {},
        outputFiles: [],
        notes: ['Validation failed before processing.'],
      }),
      issueRows: [],
      errors,
      warnings,
    };
  }

  const rows = cloneRows(gradebook.rows);
  const processableRows = gradebookRowsWithStudentId(rows);
  const preview = emptyPreview(processableRows.length);

  // Compute bell curve stats & shift
  const bellStats = config.curveMode === 'bell_curve'
    ? computeBellCurveStats(gradebook.rows, config)
    : null;
  const bellShift = bellStats
    ? calculateBellCurveShift(bellStats, config.bellCurveTargetMean)
    : 0;

  if (config.curveMode === 'bell_curve' && bellStats && bellStats.count > 0) {
    if (config.bellCurveTargetMean <= bellStats.mean) {
      warnings.push(
        `Target mean (${config.bellCurveTargetMean}) is at or below current mean (${bellStats.mean}). No curve will be applied.`,
      );
    }
  }

  const effectiveCurvePoints = resolveEffectiveCurvePoints(config, bellShift);

  if (effectiveCurvePoints === 0) {
    warnings.push('Effective curve is 0 points. No grades will be changed.');
  }

  for (const row of processableRows) {
    const rawValue = row[config.assignmentField] ?? '';
    const currentScore = parseNumber(rawValue);
    const skipReason = shouldSkipRow(row, currentScore, config);

    if (skipReason) {
      preview.skippedRows += 1;
      continue;
    }

    if (effectiveCurvePoints === 0) {
      preview.skippedRows += 1;
      continue;
    }

    let newScore = roundToTwoDecimals(currentScore! + effectiveCurvePoints);
    if (!config.allowExceedMax) {
      newScore = clamp(newScore, 0, config.totalPointsPossible);
    } else {
      newScore = Math.max(newScore, 0);
    }

    const before = row[config.assignmentField] ?? '';
    row[config.assignmentField] = toFixedScore(newScore);

    if (config.includeCurveFeedback) {
      const actualCurveApplied = roundToTwoDecimals(newScore - currentScore!);
      if (actualCurveApplied !== 0) {
        const feedbackText = buildCurveFeedback(
          actualCurveApplied,
          config.totalPointsPossible,
          config.feedbackDisplay,
        );
        row[config.feedbackField] = writeFeedbackField(
          row[config.feedbackField] ?? '',
          feedbackText,
          config.feedbackWriteMode,
        );
      }
    }

    preview.updatedRows += 1;
    trackChange(preview.sampleChanges, {
      key: keyForRow(row),
      field: config.assignmentField,
      before,
      after: row[config.assignmentField],
      note: `Curve: ${effectiveCurvePoints >= 0 ? '+' : ''}${toFixedScore(effectiveCurvePoints)}`,
    });
  }

  const files = [];
  const mainName = createMainOutputName(gradebook.sourceName, 'GradeCurve');
  files.push(makeCsvFile(mainName, {
    headers: gradebook.headers,
    rows,
    formatMeta: gradebook.formatMeta,
    sourceName: gradebook.sourceName,
  }));

  const auditName = createAuditName(gradebook.sourceName, 'GradeCurve');
  const audit = buildAudit({
    task: 'grade_curve',
    mode: config.curveMode,
    generatedAtIso: DateTime.utc().toISO() ?? new Date().toISOString(),
    inputs: { gradebook: gradebook.sourceName },
    mappings: {
      assignmentField: config.assignmentField,
      feedbackField: config.feedbackField,
    },
    parameters: {
      curveMode: config.curveMode,
      effectiveCurvePoints,
      totalPointsPossible: config.totalPointsPossible,
      skipZeros: config.skipZeros,
      skipNoSubmission: config.skipNoSubmission,
      allowExceedMax: config.allowExceedMax,
      includeCurveFeedback: config.includeCurveFeedback,
      feedbackDisplay: config.feedbackDisplay,
      ...(config.curveMode === 'fixed_points' ? { curvePoints: config.curvePoints } : {}),
      ...(config.curveMode === 'percentage' ? { curvePercent: config.curvePercent } : {}),
      ...(config.curveMode === 'bell_curve' && bellStats
        ? {
            bellCurveTargetMean: config.bellCurveTargetMean,
            bellCurveCurrentMean: bellStats.mean,
            bellCurveShift: bellShift,
            bellCurveStudentCount: bellStats.count,
            bellCurveMedian: bellStats.median,
            bellCurveStdDev: bellStats.stdDev,
          }
        : {}),
    },
    counts: {
      totalRows: preview.totalRows,
      updatedRows: preview.updatedRows,
      skippedRows: preview.skippedRows,
      issueRows: 0,
    },
    issuesByReason: {},
    outputFiles: files.map((f) => f.fileName).concat(auditName),
    notes: warnings,
  });

  files.push(makeJsonFile(auditName, auditToPrettyJson(audit)));

  return {
    preview,
    files,
    audit,
    issueRows: [],
    errors,
    warnings,
  };
}

import {
  detectChapterFromAssignmentField,
  findFirstTotalPointsField,
} from './chapter';
import type {
  CsvTable,
  Task1Config,
  Task2RawConfig,
  Task2SharedConfig,
  Task3Config,
  Task3RawConfig,
  Task4Config,
} from '../types';
import { getPreviousFridayDueIsoEastern } from './timezone';

function pickHeader(headers: string[], preferred: string, fallback = ''): string {
  return headers.find((header) => header === preferred) ?? fallback;
}

function pickFirstMatching(headers: string[], matcher: RegExp, fallback = ''): string {
  return headers.find((header) => matcher.test(header)) ?? fallback;
}

export function defaultTask1Config(
  gradebook: CsvTable | null,
  attendance: CsvTable | null,
): Task1Config {
  const gradebookHeaders = gradebook?.headers ?? [];
  const attendanceHeaders = attendance?.headers ?? [];
  return {
    gradebookJoinField: pickHeader(gradebookHeaders, 'Username', gradebookHeaders[0] ?? ''),
    attendanceJoinField: pickHeader(
      attendanceHeaders,
      'username',
      attendanceHeaders[0] ?? '',
    ),
    attendanceStatusField: pickHeader(
      attendanceHeaders,
      'status',
      attendanceHeaders[0] ?? '',
    ),
    assignmentField: findFirstTotalPointsField(gradebookHeaders),
    feedbackField: pickHeader(
      gradebookHeaders,
      'Feedback to Learner',
      '',
    ),
    feedbackWriteMode: 'append',
    feedbackTemplate:
      'No attendance recorded.<br>If you did swipe in with your Carolina Card, please register your card with a TA in the next lecture class. We will ensure you receive credit for this assignment.',
    gradeByAttendancePresence: false,
    attendancePoints: 5,
  };
}

export function defaultTask2SharedConfig(
  gradebook: CsvTable | null,
  summary: CsvTable | null,
): Task2SharedConfig {
  const gradebookHeaders = gradebook?.headers ?? [];
  const summaryHeaders = summary?.headers ?? [];
  const assignmentField = findFirstTotalPointsField(gradebookHeaders);
  const chapterValue = detectChapterFromAssignmentField(assignmentField, 15, 29);

  return {
    chapterFilterEnabled: true,
    chapterRangeStart: 15,
    chapterRangeEnd: 29,
    chapterValue,
    summaryChapterField: pickHeader(summaryHeaders, 'Chapter', 'Chapter'),
    gradebookJoinField: pickHeader(gradebookHeaders, 'Username', gradebookHeaders[0] ?? ''),
    summaryJoinField: pickHeader(summaryHeaders, 'Username', 'Username'),
    assignmentField,
    gradebookFeedbackField: pickHeader(
      gradebookHeaders,
      'Feedback to Learner',
      '',
    ),
    feedbackSourceField: pickHeader(summaryHeaders, 'PeerFeedback', 'PeerFeedback'),
    feedbackWriteMode: 'append',
    addUniversalFeedback: false,
    universalFeedback: '',
    onlyUpdateNeedsGrading: true,
    minReviews: 2,
    includeFeedbackWhenBelowMinReviews: true,
    reviewsCompletedField: pickHeader(
      summaryHeaders,
      'ReviewsCompleted',
      'ReviewsCompleted',
    ),
    fairnessCountField: pickHeader(summaryHeaders, 'FairnessNoCount', 'FairnessNoCount'),
    includeFairnessFlaggedReviewsInScoreCalculation: true,
    integrityField: pickHeader(
      summaryHeaders,
      'IntegrityFlagCount',
      'IntegrityFlagCount',
    ),
    rangeFlagField: pickHeader(summaryHeaders, 'RangeFlag', 'RangeFlag'),
    rangeExclusionEnabled: true,
    rangeThreshold: 4,
    rangeScoreFields: [
      pickHeader(summaryHeaders, 'RangeScore1', 'RangeScore1'),
      pickHeader(summaryHeaders, 'RangeScore2', 'RangeScore2'),
      pickHeader(summaryHeaders, 'RangeScore3', 'RangeScore3'),
      pickHeader(summaryHeaders, 'RangeScore4', 'RangeScore4'),
    ],
    integrityNotesField: pickHeader(summaryHeaders, 'IntegrityNotes', 'IntegrityNotes'),
    taField: pickHeader(summaryHeaders, 'TAEmail', 'TAEmail'),
    sectionField: pickHeader(summaryHeaders, 'Section', 'Section'),
    scoringMode: 'rubric_weighted',
    rubricComponents: [
      {
        field: pickHeader(summaryHeaders, 'AvgScore1', 'AvgScore1'),
        totalPoints: 10,
        weightPercent: 40,
      },
      {
        field: pickHeader(summaryHeaders, 'AvgScore2', 'AvgScore2'),
        totalPoints: 10,
        weightPercent: 20,
      },
      {
        field: pickHeader(summaryHeaders, 'AvgScore3', 'AvgScore3'),
        totalPoints: 10,
        weightPercent: 20,
      },
      {
        field: pickHeader(summaryHeaders, 'AvgScore4', 'AvgScore4'),
        totalPoints: 10,
        weightPercent: 20,
      },
    ],
    rubricAssignmentPoints: 25,
    overallScoreField: pickHeader(
      summaryHeaders,
      'AvgScoreOverall',
      'AvgScoreOverall',
    ),
    overallScoreTotalPoints: 10,
    overallAssignmentPoints: 25,
    scaleOverallScore: true,
    xwalkTaJoinField: 'Title',
    xwalkTaUsernameField: 'Username',
    xwalkTaField: 'TAEmail',
    xwalkSectionField: 'Section',
    enableManualJoinOverrides: false,
    manualJoinIdentifierField: pickHeader(
      gradebookHeaders,
      'Student ID',
      gradebookHeaders[0] ?? '',
    ),
    manualJoinOverridesText: '',
    curveEnabled: false,
    curvePoints: 0,
    curveAllowExceedMax: false,
  };
}

export function defaultTask2RawConfig(raw: CsvTable | null, assignments: CsvTable | null): Task2RawConfig {
  const rawHeaders = raw?.headers ?? [];
  const assignmentHeaders = assignments?.headers ?? [];
  return {
    rawTokenField: pickHeader(rawHeaders, 'ReviewToken', rawHeaders[0] ?? ''),
    rawPaperKeyField: pickHeader(rawHeaders, 'PaperKey', rawHeaders[0] ?? ''),
    rawScoreFields: [
      pickFirstMatching(rawHeaders, /Comprehensiveness/i, rawHeaders[0] ?? ''),
      pickFirstMatching(rawHeaders, /Organization/i, rawHeaders[0] ?? ''),
      pickFirstMatching(rawHeaders, /Originality/i, rawHeaders[0] ?? ''),
      pickFirstMatching(rawHeaders, /Accuracy/i, rawHeaders[0] ?? ''),
    ],
    rawFeedbackField: pickFirstMatching(
      rawHeaders,
      /Briefly explain your lowest score/i,
      rawHeaders[0] ?? '',
    ),
    rawFairnessField: pickFirstMatching(
      rawHeaders,
      /fair and reasonable assessment/i,
      rawHeaders[0] ?? '',
    ),
    rawIntegrityField: pickFirstMatching(
      rawHeaders,
      /Academic Integrity Flag/i,
      rawHeaders[0] ?? '',
    ),
    rawIntegrityNotesField: pickFirstMatching(
      rawHeaders,
      /explain your suspicions/i,
      rawHeaders[0] ?? '',
    ),
    assignmentsTokenField: pickHeader(assignmentHeaders, 'Token', assignmentHeaders[0] ?? ''),
    assignmentsPaperKeyField: pickHeader(
      assignmentHeaders,
      'PaperKey',
      assignmentHeaders[0] ?? '',
    ),
    assignmentsPaperLinkField: pickHeader(
      assignmentHeaders,
      'PaperLink',
      assignmentHeaders[0] ?? '',
    ),
    ownerMapAnonKeyField: 'AnonKey',
    ownerMapUsernameField: 'Username',
    ownerMapChapterField: 'Chapter',
    ownerMapTaField: 'TAEmail',
    ownerMapSectionField: 'Section',
  };
}

export function defaultTask3Config(
  gradebook: CsvTable | null,
  assignments: CsvTable | null,
): Task3Config {
  const gradebookHeaders = gradebook?.headers ?? [];
  const assignmentHeaders = assignments?.headers ?? [];
  const assignmentField = findFirstTotalPointsField(gradebookHeaders);

  return {
    chapterFilterEnabled: true,
    chapterRangeStart: 15,
    chapterRangeEnd: 29,
    chapterValue: detectChapterFromAssignmentField(assignmentField, 15, 29),
    gradebookJoinField: pickHeader(gradebookHeaders, 'Username', gradebookHeaders[0] ?? ''),
    assignmentsJoinField: pickHeader(
      assignmentHeaders,
      'ReviewerUsername',
      assignmentHeaders[0] ?? '',
    ),
    assignmentsChapterField: pickHeader(
      assignmentHeaders,
      'Chapter',
      assignmentHeaders[0] ?? '',
    ),
    assignmentField,
    feedbackField: pickHeader(
      gradebookHeaders,
      'Feedback to Learner',
      '',
    ),
    feedbackWriteMode: 'append',
    requiredReviews: 3,
    assignmentPoints: 15,
    assignZeroWhenNoAssignedReviews: false,
    latePenaltyPercent: 10,
    statusField: pickHeader(assignmentHeaders, 'Status', assignmentHeaders[0] ?? ''),
    completedAtField: pickHeader(
      assignmentHeaders,
      'CompletedAt',
      assignmentHeaders[0] ?? '',
    ),
    fairnessField: pickHeader(assignmentHeaders, 'Fairness', assignmentHeaders[0] ?? ''),
    completedAtTimezoneMode: 'auto',
    customTimezoneOffset: '+00:00',
    dueDateIsoEastern: getPreviousFridayDueIsoEastern(),
    classScheduleEnabled: true,
    classDaysOfWeek: [2, 4],
    classStartTimeEastern: '08:30',
    classEndTimeEastern: '09:20',
    xwalkJoinField: 'Title',
    xwalkUsernameField: 'Username',
    xwalkTaField: 'TAEmail',
    xwalkSectionField: 'Section',
    enableManualJoinOverrides: false,
    manualJoinIdentifierField: pickHeader(
      gradebookHeaders,
      'Student ID',
      gradebookHeaders[0] ?? '',
    ),
    manualJoinOverridesText: '',
  };
}

export function defaultTask3RawConfig(
  raw: CsvTable | null,
  assignments: CsvTable | null,
): Task3RawConfig {
  const rawHeaders = raw?.headers ?? [];
  const assignmentHeaders = assignments?.headers ?? [];

  return {
    rawTokenField: pickHeader(rawHeaders, 'ReviewToken', rawHeaders[0] ?? ''),
    rawCompletedAtField: pickHeader(rawHeaders, 'Completion time', rawHeaders[0] ?? ''),
    rawFairnessField: pickFirstMatching(
      rawHeaders,
      /fair and reasonable assessment/i,
      rawHeaders[0] ?? '',
    ),
    assignmentsTokenField: pickHeader(assignmentHeaders, 'Token', assignmentHeaders[0] ?? ''),
    assignmentsReviewerField: pickHeader(
      assignmentHeaders,
      'ReviewerUsername',
      assignmentHeaders[0] ?? '',
    ),
    assignmentsPaperKeyField: pickHeader(
      assignmentHeaders,
      'PaperKey',
      assignmentHeaders[0] ?? '',
    ),
  };
}

export function defaultTask4Config(gradebook: CsvTable | null): Task4Config {
  const headers = gradebook?.headers ?? [];
  return {
    assignmentField: findFirstTotalPointsField(headers),
    feedbackField: pickHeader(headers, 'Feedback to Learner', ''),
    feedbackWriteMode: 'append',
    totalPointsPossible: 25,
    curveMode: 'fixed_points',
    curvePoints: 0,
    curvePercent: 0,
    bellCurveTargetMean: 0,
    skipZeros: true,
    skipNoSubmission: true,
    allowExceedMax: false,
    includeCurveFeedback: true,
    feedbackDisplay: 'points',
  };
}

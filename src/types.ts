export type TaskType =
  | 'attendance_verification'
  | 'peer_review_summary'
  | 'peer_review_participation';

export type FeedbackWriteMode = 'append' | 'overwrite';

export type Task2ScoringMode = 'rubric_weighted' | 'average_overall';

export type CompletedAtTimezoneMode =
  | 'auto'
  | 'utc'
  | 'america_new_york'
  | 'custom_offset';

export interface CsvFormatMeta {
  delimiter: string;
  newline: '\n' | '\r\n';
  hasBom: boolean;
  quoteChar: string;
}

export type CsvRow = Record<string, string>;

export interface CsvTable {
  headers: string[];
  rows: CsvRow[];
  formatMeta: CsvFormatMeta;
  sourceName: string;
}

export interface RubricComponentConfig {
  field: string;
  totalPoints: number;
  weightPercent: number;
}

export interface Task1Config {
  gradebookJoinField: string;
  attendanceJoinField: string;
  attendanceStatusField: string;
  assignmentField: string;
  feedbackField: string;
  feedbackWriteMode: FeedbackWriteMode;
  feedbackTemplate: string;
  gradeByAttendancePresence: boolean;
  attendancePoints: number;
}

export interface Task2SharedConfig {
  chapterFilterEnabled: boolean;
  chapterRangeStart: number;
  chapterRangeEnd: number;
  chapterValue: string;
  summaryChapterField: string;
  gradebookJoinField: string;
  summaryJoinField: string;
  assignmentField: string;
  gradebookFeedbackField: string;
  feedbackSourceField: string;
  feedbackWriteMode: FeedbackWriteMode;
  addUniversalFeedback: boolean;
  universalFeedback: string;
  onlyUpdateNeedsGrading: boolean;
  minReviews: number;
  includeFeedbackWhenBelowMinReviews: boolean;
  reviewsCompletedField: string;
  fairnessCountField: string;
  includeFairnessFlaggedReviewsInScoreCalculation: boolean;
  integrityField: string;
  rangeFlagField: string;
  rangeExclusionEnabled: boolean;
  rangeThreshold: number;
  rangeScoreFields: string[];
  integrityNotesField: string;
  taField: string;
  sectionField: string;
  scoringMode: Task2ScoringMode;
  rubricComponents: RubricComponentConfig[];
  rubricAssignmentPoints: number;
  overallScoreField: string;
  overallScoreTotalPoints: number;
  overallAssignmentPoints: number;
  scaleOverallScore: boolean;
  xwalkTaJoinField: string;
  xwalkTaUsernameField: string;
  xwalkTaField: string;
  xwalkSectionField: string;
  enableManualJoinOverrides: boolean;
  manualJoinIdentifierField: string;
  manualJoinOverridesText: string;
}

export interface Task2RawConfig {
  rawTokenField: string;
  rawPaperKeyField: string;
  rawScoreFields: string[];
  rawFeedbackField: string;
  rawFairnessField: string;
  rawIntegrityField: string;
  rawIntegrityNotesField: string;
  assignmentsTokenField: string;
  assignmentsPaperKeyField: string;
  assignmentsPaperLinkField: string;
  ownerMapAnonKeyField: string;
  ownerMapUsernameField: string;
  ownerMapChapterField: string;
  ownerMapTaField: string;
  ownerMapSectionField: string;
}

export interface Task3Config {
  chapterFilterEnabled: boolean;
  chapterRangeStart: number;
  chapterRangeEnd: number;
  chapterValue: string;
  gradebookJoinField: string;
  assignmentsJoinField: string;
  assignmentsChapterField: string;
  assignmentField: string;
  feedbackField: string;
  feedbackWriteMode: FeedbackWriteMode;
  requiredReviews: number;
  assignmentPoints: number;
  assignZeroWhenNoAssignedReviews: boolean;
  latePenaltyPercent: number;
  statusField: string;
  completedAtField: string;
  fairnessField: string;
  completedAtTimezoneMode: CompletedAtTimezoneMode;
  customTimezoneOffset: string;
  dueDateIsoEastern: string;
  classScheduleEnabled: boolean;
  classDaysOfWeek: number[];
  classStartTimeEastern: string;
  classEndTimeEastern: string;
  xwalkJoinField: string;
  xwalkUsernameField: string;
  xwalkTaField: string;
  xwalkSectionField: string;
  enableManualJoinOverrides: boolean;
  manualJoinIdentifierField: string;
  manualJoinOverridesText: string;
}

export interface Task3RawConfig {
  rawTokenField: string;
  rawCompletedAtField: string;
  rawFairnessField: string;
  assignmentsTokenField: string;
  assignmentsReviewerField: string;
  assignmentsPaperKeyField: string;
}

export interface PreviewChange {
  key: string;
  field: string;
  before: string;
  after: string;
  note: string;
}

export interface PreviewSummary {
  totalRows: number;
  updatedRows: number;
  skippedRows: number;
  issueRows: number;
  issuesByReason: Record<string, number>;
  sampleChanges: PreviewChange[];
}

export interface RunAudit {
  task: TaskType;
  mode: string;
  generatedAtIso: string;
  inputs: Record<string, string>;
  mappings: Record<string, string>;
  parameters: Record<string, string | number | boolean | null>;
  counts: {
    totalRows: number;
    updatedRows: number;
    skippedRows: number;
    issueRows: number;
  };
  issuesByReason: Record<string, number>;
  outputFiles: string[];
  notes: string[];
}

export interface GeneratedFile {
  fileName: string;
  content: string;
  mimeType: string;
}

export interface ProcessorResult {
  preview: PreviewSummary;
  files: GeneratedFile[];
  audit: RunAudit;
  issueRows: CsvRow[];
  errors: string[];
  warnings: string[];
}

export interface ColumnResolution {
  selected: string;
  foundByDefault: boolean;
}

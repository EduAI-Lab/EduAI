import type { UserRole } from '@eduai/types';

/**
 * Effective role for AI Tutor's UI/routing: the platform `UserRole` plus the
 * enrollment-derived TA overlay. `@eduai/types`' `UserRole` has no TA (a
 * course TA is a STUDENT-platform user with a TA course enrollment) — the
 * server (`server/src/routes/authentication.js`) rewrites `role` to `'TA'`
 * when the enrollment sync finds a TA-taught course, mirroring Core's own
 * `EffectiveRole` pattern (#225 AUTH-12). Never compare this to the raw Core
 * `User.role` — that's `UserRole` and never `'TA'`.
 */
export type Role = UserRole | 'TA';

export type EnrollmentRole = 'STUDENT' | 'TA' | 'INSTRUCTOR';

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  authorizedUnits?: string[];
};

/** The student's submitted answer, stored as the Prisma `Submission.response` JSON. */
export type SubmissionResponse = {
  answerText?: string | null;
  answerOption?: number | null;
};

export type SubmissionRow = {
  id: number;
  userId: string;
  /** Core-owned display name for `userId`; null when Core lookup is unavailable. */
  studentName?: string | null;
  activityId: number;
  /** Activity title, e.g. "Balancing equations"; null falls back to the id. */
  activityTitle?: string | null;
  /** Parent lesson title for context, e.g. "Week 3 · Stoichiometry". */
  lessonTitle?: string | null;
  /** The activity's question prompt, so graders see what was asked. */
  questionText?: string | null;
  attemptNumber: number;
  /** Actual submitted answer (text or selected MCQ option index). */
  response?: SubmissionResponse | null;
  /** Resolved MCQ option label (the choice text), when the pick maps to a choice. */
  answerLabel?: string | null;
  /** AI grader note, e.g. `{ message: string }`. */
  aiFeedback?: { message?: string | null } | null;
  score?: number | null;
  isCorrect?: boolean | null;
  createdAt: string;
};

export type ActivityFeedbackRow = {
  id: number;
  userId: string;
  activityId: number;
  rating: number;
  note?: string | null;
  createdAt: string;
};

export type StudentMetricRow = {
  userId: string;
  submissionCount: number;
  correctSubmissionCount: number;
  incorrectSubmissionCount: number;
  helpRequestCount: number;
};

export type ActivityAnalyticsRow = {
  activityId: number;
  averageRating?: number | null;
  feedbackCount?: number;
  difficultyScore?: string | null;
  activity?: {
    id: number;
    title?: string | null;
    lessonId?: number;
  };
};

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
};

/**
 * Core's paginated user envelope, proxied by `GET /api/admin/users` (#1041).
 * `stats` is platform-wide and unaffected by the current page.
 */
export type AdminUserPage = {
  data: AdminUser[];
  total: number;
  page: number;
  pageSize: number;
  stats: { total: number; active: number; byRole: Record<string, number> };
};

export type EnrolledStudent = AdminUser & {
  role?: EnrollmentRole;
};

export type AdminEnrollmentData = {
  courseId: number;
  enrolledStudents: EnrolledStudent[];
  /** One page of Core's STUDENT list, minus anyone already enrolled (#1041). */
  availableStudents: AdminUser[];
  /** Paging state for `availableStudents`; `total` counts Core's STUDENT matches. */
  availableStudentsPage: { total: number; page: number; pageSize: number };
};

export type BugReportStatus = 'unhandled' | 'in progress' | 'resolved';

export type BugReportType =
  | 'UI_DISPLAY'
  | 'FEATURE_NOT_WORKING'
  | 'PERFORMANCE'
  | 'CONTENT_ERROR'
  | 'ACCESS_PERMISSION'
  | 'OTHER';

export type BugReportContext = {
  courseOfferingId?: number | null;
  moduleId?: number | null;
  lessonId?: number | null;
  activityId?: number | null;
};

export type BugReportCreatePayload = {
  description: string;
  bugType: BugReportType | null;
  isAnonymous: boolean;
  consoleLogs: string;
  networkLogs: string;
  screenshot: string | null;
  pageUrl: string;
  userAgent: string;
  context?: BugReportContext;
};

export type AdminBugReportRow = {
  id: string;
  description: string;
  bugType?: BugReportType | null;
  status: BugReportStatus;
  consoleLogs?: string | null;
  networkLogs?: string | null;
  screenshot?: string | null;
  /** Present on list rows when bodies are omitted (#979). */
  hasConsoleLogs?: boolean;
  hasNetworkLogs?: boolean;
  hasScreenshot?: boolean;
  pageUrl?: string | null;
  userAgent?: string | null;
  isAnonymous: boolean;
  userId: string;
  reporterName?: string | null;
  reporterEmail?: string | null;
  reporterRole?: Role | null;
  user?:
    | {
        id: string;
        name: string | null;
        email: string | null;
        role: Role | null;
      }
    | null;
  userName?: string | null;
  userEmail?: string | null;
  role?: Role | null;
  createdAt: string;
  updatedAt?: string;
  courseOfferingId?: number | null;
  moduleId?: number | null;
  lessonId?: number | null;
  activityId?: number | null;
  courseTitle?: string | null;
  moduleTitle?: string | null;
  lessonTitle?: string | null;
  activityTitle?: string | null;
};

export type EduAiApiKeyStatus = {
  configured: boolean;
  source: 'ADMIN' | 'ENV' | 'NONE';
  hasAdminOverride: boolean;
  envConfigured: boolean;
  updatedAt: string | null;
};

export type CostTier = 'LOW' | 'MEDIUM' | 'HIGH';

export type AdminAiModelPolicy = {
  allowedTutorModelIds: string[];
  defaultTutorModelId: string | null;
  defaultSupervisorModelId: string | null;
  dualLoopEnabled: boolean;
  maxSupervisorIterations: number;
};

export type Progress = {
  completed: number;
  total: number;
  percentage: number;
};

export type CompletionStatus = 'correct' | 'incorrect' | 'not_attempted';

export type Course = {
  id: number;
  /** Core's own course id — the read-through link (#1072 step 2/4). Always
   *  present (`CourseOffering` is a pure anchor row, `coreOfferingId` is
   *  required + unique); optional/nullable here only defensively. */
  coreOfferingId?: string | null;
  /** Core-owned (#1072 step 4) — `null` when Core can't be resolved (no
   *  local fallback exists anymore). */
  title: string | null;
  /** Core-owned course code (e.g. "COSC 101"), read-through — not the local `externalId`. */
  code?: string | null;
  description?: string | null;
  department?: string | null;
  isPublished: boolean;
  startDate?: string | null;
  endDate?: string | null;
  /** Canonical term code (e.g. "W1"), read-through from Core. Empty/absent when unknown. */
  term?: string | null;
  /** Calendar year, read-through from Core. */
  year?: number | null;
  /** Core-owned instructor guidance for the AI tutor — available but not yet consumed (#1072). */
  aiInstructions?: string | null;
  /** #225 SEAM-04: set only on the publish/unpublish response when the write
   *  to Core succeeded but the immediate re-read failed — `isPublished`
   *  reflects the write, not a confirmed Core read. Absent otherwise. */
  corePublishStale?: boolean;
  progress?: Progress;
};

export type Module = {
  id: number;
  title: string;
  description?: string | null;
  position: number;
  isPublished: boolean;
  progress?: Progress;
};

export type ModuleDetail = Module & {
  courseOfferingId: number;
};

export type Lesson = {
  id: number;
  title: string;
  contentMd?: string | null;
  position: number;
  isPublished: boolean;
  courseOfferingId?: number;
  moduleId?: number;
  progress?: Progress;
};

export type Activity = {
  id: number;
  title?: string | null;
  instructionsMd: string;
  position: number;
  question: string;
  type: 'MCQ' | 'SHORT_TEXT';
  options: { choices?: string[] } | null;
  answer?: any;
  hints: string[];
  promptTemplateId?: number | null;
  promptTemplate?: { id: number; name: string } | null;
  mainTopic: Topic | null;
  secondaryTopics: Topic[];
  enableTeachMode: boolean;
  enableGuideMode: boolean;
  enableCustomMode: boolean;
  customPrompt: string | null;
  customPromptTitle: string | null;
  completionStatus?: CompletionStatus;
};

export type PromptTemplate = {
  id: number;
  name: string;
  systemPrompt: string;
  temperature?: number | null;
  topP?: number | null;
};

export type Topic = {
  id: number;
  name: string;
};

export type AiModel = {
  id: string;
  modelId: string;
  modelName: string;
  provider?: string | null;
  summary?: string | null;
  costTier?: CostTier | null;
  roleHint?: string | null;
  studentSelectable?: boolean;
  availability?: 'allowed' | 'admin-only' | 'blocked';
  isDefaultTutor?: boolean;
};

export type SuggestedPrompt = {
  id: number;
  mode: 'teach' | 'guide';
  text: string;
};

export type ActivityAnswerResult = {
  ok: boolean;
  isCorrect: boolean | null;
  message: string;
  submissionId?: number;
  feedbackRequired?: boolean;
  feedbackAlreadySubmitted?: boolean;
};

export type ActivityFeedbackResult = {
  ok: boolean;
  feedback?: {
    id: number;
    rating: number;
    note: string | null;
    createdAt: string;
  };
};

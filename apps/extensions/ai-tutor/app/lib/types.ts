export type Role = 'STUDENT' | 'PROFESSOR' | 'TA' | 'ADMIN';

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
};

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  createdAt: string;
};

export type AdminEnrollmentData = {
  courseId: number;
  enrolledStudents: AdminUser[];
  availableStudents: AdminUser[];
};

export type BugReportStatus = 'unhandled' | 'in progress' | 'resolved';

export type BugReportContext = {
  courseOfferingId?: number | null;
  moduleId?: number | null;
  lessonId?: number | null;
  activityId?: number | null;
};

export type BugReportCreatePayload = {
  description: string;
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
  status: BugReportStatus;
  consoleLogs?: string | null;
  networkLogs?: string | null;
  screenshot?: string | null;
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

export type ExternalCourseMetadata = {
  id: string;
  code?: string | null;
  name?: string | null;
  description?: string | null;
  term?: string | null;
  year?: number | null;
  isActive?: boolean | null;
  aiInstructions?: string | null;
  [key: string]: unknown;
};

export type EduAiCourse = ExternalCourseMetadata;

export type Course = {
  id: number;
  title: string;
  description?: string | null;
  isPublished: boolean;
  startDate?: string | null;
  endDate?: string | null;
  progress?: Progress;
  externalId?: string | null;
  externalSource?: string | null;
  externalMetadata?: ExternalCourseMetadata | null;
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

import type { CreateUserInput, UpdateUserInput } from "~/lib/auth/schemas";
import type { AIModel, AIProvider } from "~/types/ai";

export type { CreateUserInput, UpdateUserInput, AIModel, AIProvider };

export type PlatformUser = {
  id: string;
  email: string;
  name: string;
  image?: string;
  role: "ADMIN" | "UNIT_ADMIN" | "INSTRUCTOR" | "TA" | "STUDENT";
  isActive: boolean;
  emailVerified: boolean;
  authorizedUnits: string[];
  createdAt: string;
  updatedAt: string;
  _count: {
    enrolledCourses: number;
    assistedCourses: number;
    taughtCourses: number;
    aiInteractions: number;
  };
};

export type ChatSessionMeta = {
  id: string;
  systemPrompt: string | null;
  title: string | null;
  adhdAssist: boolean;
  createdAt: string;
  updatedAt: string;
};

export type BugReportStatus = "UNHANDLED" | "IN_PROGRESS" | "RESOLVED";

export type BugReportSource = "CORE" | "AI_TUTOR" | "QUESTION_MAKER";

export type BugReport = {
  id: string;
  description: string;
  status: BugReportStatus;
  source: BugReportSource;
  isAnonymous: boolean;
  reporterName: string | null;
  reporterEmail: string | null;
  createdAt: string;
  updatedAt: string;
};

export type SubmitBugReportInput = {
  /** Merged description to persist (title, if any, should be folded in by the caller). */
  description: string;
  isAnonymous?: boolean;
};

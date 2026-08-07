import type { BugReport } from "~/hooks/api/types";

/** Fixture data — not used in production; real API at /api/admin/bug-reports. */
export const stubBugReports: BugReport[] = [
  {
    id: "bug-stub-001",
    description: "User reported chatId not persisting in local state.",
    bugType: "FEATURE_NOT_WORKING",
    status: "UNHANDLED",
    source: "CORE",
    isAnonymous: false,
    reporterName: "Test Student",
    reporterEmail: "student@eduai.test",
    createdAt: "2026-05-01T10:00:00.000Z",
    updatedAt: "2026-05-01T10:00:00.000Z",
  },
  {
    id: "bug-stub-002",
    description: "AI models dropdown sometimes renders with no options.",
    bugType: "UI_DISPLAY",
    status: "IN_PROGRESS",
    source: "AI_TUTOR",
    isAnonymous: true,
    reporterName: null,
    reporterEmail: null,
    createdAt: "2026-05-02T14:30:00.000Z",
    updatedAt: "2026-05-03T09:15:00.000Z",
  },
  {
    id: "bug-stub-003",
    description: "Timeout when exporting more than 500 questions.",
    bugType: "PERFORMANCE",
    status: "RESOLVED",
    source: "QUESTION_MAKER",
    isAnonymous: false,
    reporterName: "Test Instructor",
    reporterEmail: "instructor@eduai.test",
    createdAt: "2026-04-28T08:00:00.000Z",
    updatedAt: "2026-05-01T16:45:00.000Z",
  },
];

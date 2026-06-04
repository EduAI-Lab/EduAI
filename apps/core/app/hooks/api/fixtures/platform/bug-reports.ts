import type { BugReport } from "~/hooks/api/types";

/** Fixture data until Core bug API (#304). */
export const stubBugReports: BugReport[] = [
  {
    id: "bug-stub-001",
    title: "Chat session lost after refresh",
    description: "User reported chatId not persisting in local state.",
    status: "OPEN",
    source: "CORE",
    isAnonymous: false,
    reporterName: "Test Student",
    reporterEmail: "student@eduai.test",
    createdAt: "2026-05-01T10:00:00.000Z",
    updatedAt: "2026-05-01T10:00:00.000Z",
  },
  {
    id: "bug-stub-002",
    title: "Model selector empty on first load",
    description: "AI models dropdown sometimes renders with no options.",
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
    title: "Export fails for large question banks",
    description: "Timeout when exporting more than 500 questions.",
    status: "RESOLVED",
    source: "QUESTION_MAKER",
    isAnonymous: false,
    reporterName: "Test Instructor",
    reporterEmail: "instructor@eduai.test",
    createdAt: "2026-04-28T08:00:00.000Z",
    updatedAt: "2026-05-01T16:45:00.000Z",
  },
];

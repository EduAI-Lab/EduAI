/**
 * #1756 — after a CSV import enrolls students the component never learns about
 * individually, the roster must re-read. Without this the instructor imports 97
 * students, the list does not change, and the import reads as though it failed.
 *
 * Written with `createElement` rather than JSX so it can live alongside the
 * other `enrollments-csv*` unit tests as a `.ts` file. The heavy nested feature
 * components are stubbed exactly as `course-detail-manager-view.test.tsx` stubs
 * them, so the assertions stay about this view's own wiring.
 */
import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Mock } from "vitest";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

vi.mock("~/components/course-materials-upload", () => ({
  CourseMaterialsUpload: () => createElement("div", { "data-testid": "upload-widget" }),
}));
vi.mock("~/components/course-embedding-settings", () => ({
  CourseEmbeddingSettings: () => createElement("div", { "data-testid": "embedding-settings" }),
}));
vi.mock("~/components/courses/course-response-style-settings", () => ({
  CourseResponseStyleSettings: () => createElement("div", { "data-testid": "rs-settings" }),
  CourseResponseStyleSummary: () => createElement("div", { "data-testid": "rs-summary" }),
}));
vi.mock("~/components/courses/course-chats-panel", () => ({
  CourseChatsTab: () => createElement("div", { "data-testid": "chat-history-tab" }),
}));
vi.mock("~/components/canvas/canvas-material-sync-dialog", () => ({
  CanvasMaterialSyncDialog: () => null,
}));
vi.mock("~/hooks/api/use-student-candidates", () => ({
  useStudentCandidates: () => ({ candidates: [], loading: false, search: vi.fn() }),
}));

import {
  CourseDetailManagerView,
  type CourseDetailManagerCourse,
} from "~/components/courses/course-detail-manager-view";
import { PolicyProvider } from "~/components/policy/policy-gate";

const COURSE: CourseDetailManagerCourse = {
  id: "c1",
  code: "COSC 101",
  name: "Intro to CS",
  description: "A great course",
  term: "Fall",
  year: 2025,
  isActive: true,
  aiInstructions: "",
  instructorId: "user-instructor",
  department: "COSC",
  startDate: "2025-09-01",
  endDate: "2025-12-15",
  isPublished: true,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  instructor: { id: "user-instructor", name: "Dr. Instructor", email: "inst@test.com" },
  ragTopK: 4,
  ragSimilarityThreshold: 0.5,
  courseScopeGuardrailEnabled: false,
};

type ImportSummary = {
  totalRows: number;
  imported: number;
  alreadyEnrolled: number;
  failed: number;
  errors: { line: number; email: string | null; code: string; message: string }[];
};

let onRefreshEnrollments: Mock<() => Promise<void>>;

/**
 * Route the two requests this section makes: the self-enrollment link list on
 * mount, and the CSV import itself.
 */
function stubFetch(summary: ImportSummary) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/self-enroll")) {
      return { ok: true, json: async () => ({ links: [] }) } as Response;
    }
    if (url.includes("/enrollments/csv") && init?.method === "POST") {
      return { ok: true, json: async () => summary } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderView() {
  onRefreshEnrollments = vi.fn(async () => {});
  // `children` goes in the props object rather than as `createElement`'s third
  // argument because `PolicyProvider` declares it as a required prop.
  const view = createElement(CourseDetailManagerView, {
    course: COURSE,
    access: "admin" as const,
    topics: [],
    enrollments: [],
    materials: [],
    tas: [],
    courseInstructors: [],
    onFileSelect: vi.fn(),
    onCreateTopic: vi.fn(async () => {}),
    onDeleteTopic: vi.fn(async () => {}),
    onAddInstructor: vi.fn(async () => {}),
    onRemoveInstructor: vi.fn(async () => {}),
    onSetPrimaryInstructor: vi.fn(async () => {}),
    onAddTA: vi.fn(async () => {}),
    onRemoveTA: vi.fn(async () => {}),
    onEnrollStudent: vi.fn(async () => {}),
    onRemoveEnrollment: vi.fn(async () => {}),
    onRefreshEnrollments,
    courseId: "c1",
    currentUserId: "user-instructor",
  });
  render(
    createElement(MemoryRouter, {
      children: createElement(PolicyProvider, { policies: {}, children: view }),
    }),
  );
}

/** Pick a file and press Import CSV. */
function importFile() {
  const input = screen.getByLabelText("Import a roster CSV");
  fireEvent.change(input, {
    target: { files: [new File(["email\na@test.edu\n"], "roster.csv", { type: "text/csv" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: /import csv/i }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("CSV import refreshes the roster", () => {
  beforeEach(() => {
    stubFetch({
      totalRows: 100,
      imported: 97,
      alreadyEnrolled: 0,
      failed: 3,
      errors: [
        { line: 11, email: "bad", code: "INVALID_EMAIL", message: "bad email" },
        { line: 51, email: "bad", code: "INVALID_EMAIL", message: "bad email" },
        { line: 91, email: "bad", code: "INVALID_EMAIL", message: "bad email" },
      ],
    });
  });

  it("calls onRefreshEnrollments after a partially successful import", async () => {
    renderView();
    importFile();

    await waitFor(() => expect(onRefreshEnrollments).toHaveBeenCalledTimes(1));
  });

  it("renders the per-row summary with the failed line numbers", async () => {
    renderView();
    importFile();

    await waitFor(() => expect(screen.getByText(/Imported 97 of 100 rows/)).toBeTruthy());
    expect(screen.getByText(/Line 11:/)).toBeTruthy();
    expect(screen.getByText(/Line 51:/)).toBeTruthy();
    expect(screen.getByText(/Line 91:/)).toBeTruthy();
  });
});

describe("CSV import does not refresh when nothing was enrolled", () => {
  it("skips the refetch when every row failed", async () => {
    stubFetch({
      totalRows: 2,
      imported: 0,
      alreadyEnrolled: 0,
      failed: 2,
      errors: [
        { line: 2, email: "nope", code: "USER_NOT_FOUND", message: "no account" },
        { line: 3, email: "nope2", code: "USER_NOT_FOUND", message: "no account" },
      ],
    });
    renderView();
    importFile();

    // The summary still renders, so this is "finished, nothing to re-read",
    // not "the click did nothing".
    await waitFor(() => expect(screen.getByText(/Imported 0 of 2 rows/)).toBeTruthy());
    expect(onRefreshEnrollments).not.toHaveBeenCalled();
  });
});

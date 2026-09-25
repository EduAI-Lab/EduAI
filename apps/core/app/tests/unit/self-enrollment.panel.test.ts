/**
 * #1756 — the instructor-facing self-enrollment link panel.
 *
 * The minted URL is shown exactly once and cannot be re-read, so the two things
 * worth pinning here are both about not destroying it: revoking some OTHER link
 * must leave it on screen, and a section the caller has lost permission to use
 * must say so rather than offer a button that can only fail.
 *
 * Written with `createElement` rather than JSX so it can sit alongside the
 * other `self-enrollment*` unit tests as a `.ts` file, stubbing the heavy
 * nested feature components exactly as `enrollments-csv.refresh.test.ts` does.
 */
import { createElement } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

type LinkPayload = {
  id: string;
  status: "ACTIVE" | "REVOKED" | "EXPIRED" | "EXHAUSTED";
  expiresAt: string;
  revokedAt: string | null;
  maxRedemptions: number | null;
  redemptionCount: number;
  createdAt: string;
};

function link(id: string, overrides: Partial<LinkPayload> = {}): LinkPayload {
  return {
    id,
    status: "ACTIVE",
    expiresAt: "2026-12-01T00:00:00.000Z",
    revokedAt: null,
    maxRedemptions: null,
    redemptionCount: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const NEW_URL = "https://eduai.ok.ubc.ca/courses/self-enroll?token=fresh-token";

/**
 * A stand-in for the link API that actually holds state, so a revoke is
 * observable in the next list read the way it is in the real one.
 */
function stubLinkApi(initial: LinkPayload[]) {
  const links = [...initial];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!url.includes("/self-enroll")) {
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }
    if (init?.method === "POST") {
      const minted = link("new-link");
      links.unshift(minted);
      return {
        ok: true,
        status: 201,
        json: async () => ({ url: NEW_URL, link: minted }),
      } as Response;
    }
    if (init?.method === "DELETE") {
      const id = new URL(url, "http://localhost").searchParams.get("linkId");
      const target = links.find((l) => l.id === id);
      if (target) target.status = "REVOKED";
      return { ok: true, status: 204, json: async () => ({}) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ links }) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** A list read the server refuses — the case that used to fail silently. */
function stubForbiddenLinkApi() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/self-enroll")) {
      return { ok: false, status: 403, json: async () => ({ error: "Forbidden" }) } as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderView() {
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
    onRefreshEnrollments: vi.fn(async () => {}),
    courseId: "c1",
    currentUserId: "user-instructor",
  });
  render(
    createElement(MemoryRouter, {
      children: createElement(PolicyProvider, { policies: {}, children: view }),
    }),
  );
}

function mintedUrlField(): HTMLInputElement | null {
  return screen.queryByLabelText("Self-enrollment link") as HTMLInputElement | null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("self-enrollment panel — the minted URL survives unrelated revocations", () => {
  it("keeps the freshly minted URL when a DIFFERENT link is turned off", async () => {
    // The scenario: mint a link, then tidy up last term's link before copying
    // the new one. The new URL is unrecoverable, so clearing it here costs the
    // instructor a mint-and-revoke cycle for no reason.
    stubLinkApi([link("old-link")]);
    renderView();

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /turn off/i })).toHaveLength(1),
    );

    fireEvent.click(screen.getByRole("button", { name: /create link/i }));
    await waitFor(() => expect(mintedUrlField()?.value).toBe(NEW_URL));

    // Two active links now; the older one is last, newest first as the API lists them.
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /turn off/i })).toHaveLength(2),
    );
    fireEvent.click(screen.getAllByRole("button", { name: /turn off/i })[1]);

    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: /turn off/i })).toHaveLength(1),
    );
    expect(mintedUrlField()?.value).toBe(NEW_URL);
  });

  it("clears the URL when the link on screen is the one turned off", async () => {
    stubLinkApi([]);
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /create link/i }));
    await waitFor(() => expect(mintedUrlField()?.value).toBe(NEW_URL));

    fireEvent.click(await screen.findByRole("button", { name: /turn off/i }));

    await waitFor(() => expect(mintedUrlField()).toBeNull());
  });
});

describe("self-enrollment panel — a refused list read", () => {
  it("explains a 403 and stops offering a Create button that cannot work", async () => {
    // The same gate guards the list, the create and the revoke, so an empty
    // section plus a live button sends the instructor into a generic "please
    // try again" for something retrying will never fix.
    stubForbiddenLinkApi();
    renderView();

    await waitFor(() =>
      expect(
        screen.getByText(/no longer have permission to manage self-enrollment links/i),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: /create link/i })).toHaveProperty("disabled", true);
  });
});

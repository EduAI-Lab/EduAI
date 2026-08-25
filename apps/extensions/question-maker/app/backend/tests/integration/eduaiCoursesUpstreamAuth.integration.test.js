/**
 * Route-level regression for GET /api/eduai/courses across the REAL Core
 * boundary (review follow-up on #1569 / PR #1584).
 *
 * The sibling `eduaiRouteCoverage.integration.test.js` mocks
 * `courseListService.listCoursesForUser` directly, so it asserts the route's
 * catch translates a status-bearing error but never exercises the layers that
 * actually produce one. This file leaves `courseListService` AND
 * `coreApiService` real and stubs only the `fetch` boundary, so a Core 401/403
 * travels the true path: `fetch` → `coreApiService.listCoursesFromCore`
 * (`fetchFromCore` cookie-scoped) → `coreError` (`.status`) →
 * `courseListService.listCoursesForUser` (rethrows the auth failure) → the
 * `/courses` catch. The assertion is that the redacted upstream auth status
 * surfaces to the client instead of flattening to 500 or leaking Core detail.
 *
 * Only the session store (prisma), auth persistence, and settings are mocked —
 * everything from the Core HTTP client inward runs for real.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import request from "supertest";

const { mockCourseFindMany } = vi.hoisted(() => ({
  mockCourseFindMany: vi.fn(),
}));

vi.mock("../../src/services/authService.js", () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/config/settings.js", () => {
  const cfg = {
    coreUrl: "http://core.test",
    eduaiApiKey: "service-key",
    corsOrigins: ["*"],
    nodeEnv: "test",
    logLevel: "silent",
    maxQuestions: 50,
    qmGeneratePromptMaxChars: 20,
    qmAiRateLimitMax: 100,
    qmAiOperationDeadlineMs: 5000,
  };
  return { config: cfg, default: cfg };
});

vi.mock("../../src/config/database.js", () => ({
  prisma: {
    course: {
      findMany: (...args) => mockCourseFindMany(...args),
    },
  },
}));

// NOTE: courseListService.js and coreApiService.js are intentionally NOT
// mocked — that is the whole point of this file.

const { default: app } = await import("../../src/app.js");

const INSTRUCTOR = { id: "inst-1", role: "INSTRUCTOR", email: "i@t.co", name: "I" };

/** A linked local row so the non-ADMIN path issues its cookie-scoped Core list. */
const LINKED_COURSE = {
  id: 1,
  userId: INSTRUCTOR.id,
  coreCourseId: "c1",
  createdAt: new Date(0),
};

/**
 * Stub the ONLY network boundary: session validation succeeds, but every
 * `/api/courses` read from Core answers with the given auth status and an
 * opaque upstream body we assert never reaches the client.
 */
function stubCoreFetch(coursesStatus, coursesError) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/sessions/validate")) {
        return {
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({ user: INSTRUCTOR }),
        };
      }
      if (url.includes("/api/courses")) {
        return {
          ok: false,
          status: coursesStatus,
          headers: { get: () => null },
          json: async () => ({ error: coursesError }),
        };
      }
      throw new Error(`unexpected fetch to ${url}`);
    }),
  );
}

describe("GET /api/eduai/courses — real Core auth-failure boundary", () => {
  beforeEach(() => {
    mockCourseFindMany.mockResolvedValue([LINKED_COURSE]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("surfaces a Core 401 as a redacted 401 through the real client → service → route path", async () => {
    stubCoreFetch(401, "Unauthorized");

    const res = await request(app).get("/api/eduai/courses").set("Cookie", "session=stale");

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Not authorized to list courses");
    // Redaction: no upstream Core message, body, or status detail leaks.
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain("Unauthorized");
    expect(res.body.details).toBeUndefined();
  });

  it("surfaces a Core 403 as a redacted 403 through the real boundary", async () => {
    stubCoreFetch(403, "Forbidden");

    const res = await request(app).get("/api/eduai/courses").set("Cookie", "session=forbidden");

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Not authorized to list courses");
    expect(JSON.stringify(res.body)).not.toContain("Forbidden");
  });

  it("fails closed to an empty catalog on a non-auth Core 5xx (only 401/403 propagate)", async () => {
    // A non-auth upstream failure must NOT read as an auth error: the
    // cookie-scoped list catch swallows it and every row fails closed
    // (#1114), so the caller sees an empty visible set at 200 — never a
    // leaked upstream status or body.
    stubCoreFetch(502, "core exploded");

    const res = await request(app).get("/api/eduai/courses").set("Cookie", "session=v");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
    expect(JSON.stringify(res.body)).not.toContain("core exploded");
  });
});

// @vitest-environment node

import type { ActionFunctionArgs } from "react-router";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/request-session.server", () => ({ getRequestSession: vi.fn() }));

vi.mock("~/lib/auth/course-access.server", () => ({ resolveCourseAccessGate: vi.fn() }));

vi.mock("~/lib/courses/enrollments-csv.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/courses/enrollments-csv.server")>();
  // The parser stays real — the route's job is to hand it the body and map its
  // result onto status codes, and that mapping is only meaningful end to end.
  return { ...actual, importEnrollmentRows: vi.fn() };
});

vi.mock("~/lib/logging.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/logging.server")>();
  return { ...actual, logAuditAction: vi.fn(async () => {}) };
});

// getPolicy resolves to each flag's real code default unless a test overrides it.
vi.mock("~/lib/policy.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/policy.server")>();
  return {
    ...actual,
    getPolicy: vi.fn(
      async (key: keyof typeof actual.POLICY_FLAGS) => actual.POLICY_FLAGS[key].default,
    ),
    logPolicyDenial: vi.fn(),
  };
});

import { action } from "~/routes/api/courses.enrollments.csv";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import {
  importEnrollmentRows,
  MAX_CSV_BYTES,
  MAX_CSV_ROWS,
} from "~/lib/courses/enrollments-csv.server";
import { getPolicy, POLICY_FLAGS } from "~/lib/policy.server";
import { logAuditAction } from "~/lib/logging.server";
import type { CourseGateFixture } from "../helpers/route-fixtures";

const MOCK_COURSE: CourseGateFixture = { id: "course-1", isPublished: true, deletedAt: null };

type Access = { level: string; rank: number } | null;

function mockAccess(access: Access, course: CourseGateFixture | null = MOCK_COURSE) {
  vi.mocked(resolveCourseAccessGate).mockResolvedValue({
    course: course as never,
    access: access as never,
  });
}

const ROUTE_URL = "http://localhost/api/courses/course-1/enrollments/csv";

/** Wrap a request as the router would hand it to the action. */
function routeArgs(request: Request): ActionFunctionArgs {
  return {
    request,
    params: { id: "course-1" },
    url: new URL(request.url),
    pattern: "/api/courses/:id/enrollments/csv",
    // SAFETY: this route never reads the router context; a unit test has no
    // real one to build and the action would ignore it either way.
    context: {} as ActionFunctionArgs["context"],
  };
}

function makeArgs(body: string, { method = "POST", contentType = "text/csv" } = {}) {
  const init: RequestInit = { method, headers: { "Content-Type": contentType } };
  // `Request` rejects a body on GET, and the 405 test is the only caller that
  // sends one — so the body is attached only where it is legal.
  if (method === "POST") init.body = body;
  return routeArgs(new Request(ROUTE_URL, init));
}

const EMPTY_SUMMARY = {
  totalRows: 0,
  imported: 0,
  alreadyEnrolled: 0,
  failed: 0,
  errors: [],
  created: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRequestSession).mockResolvedValue({
    user: { id: "instructor-1", role: "INSTRUCTOR" },
  } as never);
  mockAccess({ level: "instructor", rank: 2 });
  vi.mocked(importEnrollmentRows).mockResolvedValue({ ...EMPTY_SUMMARY });
  // `clearAllMocks` clears calls but not implementations, so a test that turns
  // the policy flag off would otherwise leak into every test after it.
  vi.mocked(getPolicy).mockImplementation(async (key) => POLICY_FLAGS[key].default);
});

describe("POST /api/courses/:id/enrollments/csv — authorization", () => {
  it("405s a non-POST request", async () => {
    const res = await action(makeArgs("", { method: "GET" }));
    expect(res.status).toBe(405);
  });

  it("401s an anonymous request", async () => {
    vi.mocked(getRequestSession).mockResolvedValue(null);
    const res = await action(makeArgs("email\na@test.edu\n"));
    expect(res.status).toBe(401);
    expect(importEnrollmentRows).not.toHaveBeenCalled();
  });

  it("404s an unknown course", async () => {
    mockAccess({ level: "instructor", rank: 2 }, null);
    const res = await action(makeArgs("email\na@test.edu\n"));
    expect(res.status).toBe(404);
    expect(importEnrollmentRows).not.toHaveBeenCalled();
  });

  it("403s a TA (rank 1) — bulk import is rank >= 2 like the single-add path", async () => {
    mockAccess({ level: "ta", rank: 1 });
    const res = await action(makeArgs("email\na@test.edu\n"));
    expect(res.status).toBe(403);
    expect(importEnrollmentRows).not.toHaveBeenCalled();
  });

  it("403s when the manageEnrollments policy flag is off for instructors", async () => {
    vi.mocked(getPolicy).mockResolvedValue(false);
    const res = await action(makeArgs("email\na@test.edu\n"));
    expect(res.status).toBe(403);
    expect(importEnrollmentRows).not.toHaveBeenCalled();
  });

  it("hands the caller's own rank to the importer, never a hardcoded one", async () => {
    mockAccess({ level: "admin", rank: 4 });
    await action(makeArgs("email,role\nboss@test.edu,INSTRUCTOR\n"));
    expect(importEnrollmentRows).toHaveBeenCalledWith(
      "course-1",
      [{ line: 2, email: "boss@test.edu", role: "INSTRUCTOR" }],
      [],
      4,
    );
  });
});

describe("POST /api/courses/:id/enrollments/csv — body handling", () => {
  it("413s a body whose Content-Length exceeds the cap, without reading it", async () => {
    const request = new Request(ROUTE_URL, {
      method: "POST",
      headers: { "Content-Type": "text/csv", "Content-Length": String(MAX_CSV_BYTES + 1) },
      body: "email\na@test.edu\n",
    });
    const res = await action(routeArgs(request));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "FILE_TOO_LARGE" });
    expect(importEnrollmentRows).not.toHaveBeenCalled();
  });

  it("413s a file over the row cap", async () => {
    const lines = ["email"];
    for (let i = 0; i <= MAX_CSV_ROWS; i += 1) lines.push(`s${i}@test.edu`);
    const res = await action(makeArgs(lines.join("\n")));
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "TOO_MANY_ROWS" });
    expect(importEnrollmentRows).not.toHaveBeenCalled();
  });

  it("422s a file with no email column", async () => {
    const res = await action(makeArgs("name\nAlice\n"));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "MISSING_EMAIL_COLUMN" });
  });

  it("422s an empty upload", async () => {
    const res = await action(makeArgs("\n\n"));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "EMPTY_FILE" });
  });

  it("accepts a multipart upload with a `file` field", async () => {
    const form = new FormData();
    form.set("file", new File(["email\nalice@test.edu\n"], "roster.csv", { type: "text/csv" }));
    const request = new Request(ROUTE_URL, { method: "POST", body: form });
    const res = await action(routeArgs(request));
    expect(res.status).toBe(200);
    expect(importEnrollmentRows).toHaveBeenCalledWith(
      "course-1",
      [{ line: 2, email: "alice@test.edu", role: "STUDENT" }],
      [],
      2,
    );
  });

  it("413s an oversized body that declares no Content-Length", async () => {
    // The header precheck is a courtesy to honest clients. A chunked request
    // declares no length at all, so if the cap were only enforced there, this
    // payload would be buffered in full before anything objected to its size.
    const oversized = `email\n${"a@test.edu\n".repeat(40_000)}`;
    expect(new TextEncoder().encode(oversized).length).toBeGreaterThan(MAX_CSV_BYTES);

    const request = new Request(ROUTE_URL, {
      method: "POST",
      headers: { "Content-Type": "text/csv" },
      // A stream body makes this a chunked request: undici sets no
      // Content-Length for it, which is exactly the hole being closed.
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(oversized));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit);

    const res = await action(routeArgs(request));

    expect(request.headers.get("Content-Length")).toBeNull();
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: "FILE_TOO_LARGE" });
    expect(importEnrollmentRows).not.toHaveBeenCalled();
  });

  it("does not charge multipart framing against the CSV's own byte cap", async () => {
    // A browser posts the CSV wrapped in boundary markers, a
    // Content-Disposition header and CRLFs, so its Content-Length is the roster
    // PLUS that framing. Charging the total against MAX_CSV_BYTES rejects a
    // roster the parser would happily accept, with a message quoting a limit
    // the file is genuinely under.
    //
    // The declared length is the thing under test here, so it is set directly
    // rather than inferred: undici omits Content-Length for a FormData body.
    const boundary = "----EduAIFormBoundary1756";
    const multipart =
      `--${boundary}\r\n` +
      'Content-Disposition: form-data; name="file"; filename="roster.csv"\r\n' +
      "Content-Type: text/csv\r\n\r\n" +
      "email\nalice@test.edu\n" +
      `\r\n--${boundary}--\r\n`;

    const request = new Request(ROUTE_URL, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        // Just over the CSV cap, as a nearly-full roster plus framing would be,
        // and within the framing allowance the route adds for multipart.
        "Content-Length": String(MAX_CSV_BYTES + 200),
      },
      body: multipart,
    });

    const res = await action(routeArgs(request));

    expect(res.status).toBe(200);
    expect(importEnrollmentRows).toHaveBeenCalledWith(
      "course-1",
      [{ line: 2, email: "alice@test.edu", role: "STUDENT" }],
      [],
      2,
    );
  });

  it("still 413s a multipart request past the CSV cap plus its framing allowance", async () => {
    const request = new Request(ROUTE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "multipart/form-data; boundary=----EduAIFormBoundary1756",
        "Content-Length": String(MAX_CSV_BYTES + 64 * 1024),
      },
      body: "email\na@test.edu\n",
    });

    const res = await action(routeArgs(request));

    expect(res.status).toBe(413);
    expect(importEnrollmentRows).not.toHaveBeenCalled();
  });
});

describe("POST /api/courses/:id/enrollments/csv — result reporting", () => {
  it("returns 200 with the per-row summary when some rows fail", async () => {
    vi.mocked(importEnrollmentRows).mockResolvedValue({
      totalRows: 3,
      imported: 2,
      alreadyEnrolled: 0,
      failed: 1,
      errors: [{ line: 4, email: "ghost@test.edu", code: "USER_NOT_FOUND", message: "nope" }],
      created: [
        { enrollmentId: "enr-1", userId: "user-1", email: "a@test.edu", role: "STUDENT" },
        { enrollmentId: "enr-2", userId: "user-2", email: "b@test.edu", role: "STUDENT" },
      ],
    });

    const res = await action(makeArgs("email\na@test.edu\nb@test.edu\nghost@test.edu\n"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      totalRows: 3,
      imported: 2,
      alreadyEnrolled: 0,
      failed: 1,
      errors: [{ line: 4, email: "ghost@test.edu", code: "USER_NOT_FOUND", message: "nope" }],
    });
  });

  it("audit-logs every created enrollment plus one import summary", async () => {
    vi.mocked(importEnrollmentRows).mockResolvedValue({
      totalRows: 1,
      imported: 1,
      alreadyEnrolled: 0,
      failed: 0,
      errors: [],
      created: [{ enrollmentId: "enr-1", userId: "user-1", email: "a@test.edu", role: "STUDENT" }],
    });

    await action(makeArgs("email\na@test.edu\n"));

    const codes = vi.mocked(logAuditAction).mock.calls.map((call) => call[0].actionCode);
    expect(codes).toEqual(["ENROLLMENT_ADDED", "ENROLLMENT_CSV_IMPORTED"]);
    expect(vi.mocked(logAuditAction).mock.calls[0][0]).toMatchObject({
      entityId: "enr-1",
      details: { courseId: "course-1", role: "STUDENT", targetUserId: "user-1" },
    });
  });

  it("never echoes the uploaded file back to the client", async () => {
    const res = await action(makeArgs("email\nsecret@test.edu\n"));
    expect(JSON.stringify(await res.json())).not.toContain("secret@test.edu");
  });
});

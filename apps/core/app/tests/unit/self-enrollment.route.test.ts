// @vitest-environment node

import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/request-session.server", () => ({ getRequestSession: vi.fn() }));

vi.mock("~/lib/auth/course-access.server", () => ({ resolveCourseAccessGate: vi.fn() }));

// The route reads `authBaseURL` to build the share URL on the configured public
// origin rather than on `request.url`. Stubbed here — as the invitation service
// test does — so the suite does not pull in the real Better Auth module, and so
// the origin under test is deliberately NOT the request's.
vi.mock("~/lib/auth/server", () => ({ authBaseURL: "https://eduai.ok.ubc.ca" }));

vi.mock("~/lib/courses/self-enrollment.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/courses/self-enrollment.server")>();
  // `selfEnrollmentUrl` stays real — the share URL the instructor copies is
  // part of this route's contract, not an implementation detail behind it.
  return {
    ...actual,
    createSelfEnrollmentLink: vi.fn(),
    listSelfEnrollmentLinks: vi.fn(),
    revokeSelfEnrollmentLink: vi.fn(),
    previewSelfEnrollmentLink: vi.fn(),
    redeemSelfEnrollmentLink: vi.fn(),
  };
});

vi.mock("~/lib/logging.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/logging.server")>();
  return { ...actual, logAuditAction: vi.fn(async () => {}) };
});

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

import { action as apiAction, loader as apiLoader } from "~/routes/api/courses.self-enroll";
import { action as pageAction, loader as pageLoader } from "~/routes/courses.self-enroll";
import { getRequestSession } from "~/lib/auth/request-session.server";
import { resolveCourseAccessGate } from "~/lib/auth/course-access.server";
import {
  createSelfEnrollmentLink,
  listSelfEnrollmentLinks,
  previewSelfEnrollmentLink,
  redeemSelfEnrollmentLink,
  revokeSelfEnrollmentLink,
} from "~/lib/courses/self-enrollment.server";
import { getPolicy, POLICY_FLAGS } from "~/lib/policy.server";
import { logAuditAction } from "~/lib/logging.server";
import type { CourseGateFixture } from "../helpers/route-fixtures";

const MOCK_COURSE: CourseGateFixture = { id: "course-1", isPublished: true, deletedAt: null };
const API_URL = "http://localhost/api/courses/course-1/self-enroll";
const PAGE_URL = "http://localhost/courses/self-enroll";

const LINK_VIEW = {
  id: "link-1",
  status: "ACTIVE" as const,
  expiresAt: new Date("2026-10-16T00:00:00.000Z"),
  revokedAt: null,
  maxRedemptions: null,
  redemptionCount: 0,
  createdAt: new Date("2026-09-16T00:00:00.000Z"),
};

type Access = { level: string; rank: number } | null;

function mockAccess(access: Access, course: CourseGateFixture | null = MOCK_COURSE) {
  vi.mocked(resolveCourseAccessGate).mockResolvedValue({
    course: course as never,
    access: access as never,
  });
}

/** SAFETY: neither route reads the router context; a unit test has none to build. */
const ROUTER_CONTEXT = {} as ActionFunctionArgs["context"];

function apiArgs(request: Request): ActionFunctionArgs {
  return {
    request,
    params: { id: "course-1" },
    url: new URL(request.url),
    pattern: "/api/courses/:id/self-enroll",
    context: ROUTER_CONTEXT,
  };
}

function pageArgs(request: Request): ActionFunctionArgs {
  return {
    request,
    params: {},
    url: new URL(request.url),
    pattern: "/courses/self-enroll",
    context: ROUTER_CONTEXT,
  };
}

/**
 * The POST body this route accepts. `ttlDays` admits a string so the suite can
 * post a deliberately wrong-typed option and assert it is rejected rather than
 * silently dropped.
 */
type CreateLinkRequestBody = { ttlDays?: number | string; maxRedemptions?: number };

function jsonRequest(method: string, body?: CreateLinkRequestBody, url = API_URL) {
  const init: RequestInit = { method, headers: { "Content-Type": "application/json" } };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getRequestSession).mockResolvedValue({
    user: { id: "instructor-1", role: "INSTRUCTOR" },
  } as never);
  mockAccess({ level: "instructor", rank: 2 });
  vi.mocked(getPolicy).mockImplementation(async (key) => POLICY_FLAGS[key].default);
  vi.mocked(listSelfEnrollmentLinks).mockResolvedValue([LINK_VIEW]);
  vi.mocked(createSelfEnrollmentLink).mockResolvedValue({
    status: "201",
    token: "raw-token-xyz",
    link: LINK_VIEW,
  });
  vi.mocked(revokeSelfEnrollmentLink).mockResolvedValue({ status: "204", alreadyRevoked: false });
});

describe("/api/courses/:id/self-enroll — authorization", () => {
  it("401s an anonymous caller on both read and write", async () => {
    vi.mocked(getRequestSession).mockResolvedValue(null);
    expect((await apiLoader(apiArgs(new Request(API_URL)))).status).toBe(401);
    expect((await apiAction(apiArgs(jsonRequest("POST", {})))).status).toBe(401);
    expect(createSelfEnrollmentLink).not.toHaveBeenCalled();
  });

  it("404s an unknown course", async () => {
    mockAccess({ level: "instructor", rank: 2 }, null);
    expect((await apiAction(apiArgs(jsonRequest("POST", {})))).status).toBe(404);
  });

  it("403s a TA (rank 1) — minting a link is rank >= 2", async () => {
    mockAccess({ level: "ta", rank: 1 });
    expect((await apiAction(apiArgs(jsonRequest("POST", {})))).status).toBe(403);
    expect(createSelfEnrollmentLink).not.toHaveBeenCalled();
  });

  it("403s a student outright", async () => {
    mockAccess({ level: "student", rank: 0 });
    expect((await apiLoader(apiArgs(new Request(API_URL)))).status).toBe(403);
    expect(listSelfEnrollmentLinks).not.toHaveBeenCalled();
  });

  it("403s when the manageEnrollments policy flag is off for instructors", async () => {
    vi.mocked(getPolicy).mockResolvedValue(false);
    expect((await apiAction(apiArgs(jsonRequest("POST", {})))).status).toBe(403);
    expect(createSelfEnrollmentLink).not.toHaveBeenCalled();
  });

  it("405s an unsupported method", async () => {
    expect((await apiAction(apiArgs(jsonRequest("PATCH", {})))).status).toBe(405);
  });
});

describe("/api/courses/:id/self-enroll — link management", () => {
  it("mints a link and returns the shareable URL plus the raw token once", async () => {
    const res = await apiAction(apiArgs(jsonRequest("POST", { ttlDays: 14 })));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      token: "raw-token-xyz",
      url: "https://eduai.ok.ubc.ca/courses/self-enroll?token=raw-token-xyz",
      link: { id: "link-1", status: "ACTIVE" },
    });
    expect(createSelfEnrollmentLink).toHaveBeenCalledWith({
      courseId: "course-1",
      createdById: "instructor-1",
      ttlDays: 14,
      maxRedemptions: undefined,
    });
  });

  it("builds the share URL on the configured public origin, not the request's", async () => {
    // Behind the TLS-terminating proxy `request.url` stays `http://` (see
    // root.tsx), and this URL carries a bearer token. The request here is
    // `http://localhost/...` while `authBaseURL` is `https://eduai.ok.ubc.ca`,
    // so a share URL built from the request would be caught by this.
    const res = await apiAction(apiArgs(jsonRequest("POST", {})));
    const body = (await res.json()) as { url: string };
    expect(new URL(body.url).origin).toBe("https://eduai.ok.ubc.ca");
    expect(body.url.startsWith("http://")).toBe(false);
  });

  it("passes an explicit redemption cap through", async () => {
    await apiAction(apiArgs(jsonRequest("POST", { maxRedemptions: 40 })));
    expect(createSelfEnrollmentLink).toHaveBeenCalledWith(
      expect.objectContaining({ maxRedemptions: 40 }),
    );
  });

  it("422s a non-numeric option instead of silently ignoring it", async () => {
    const res = await apiAction(apiArgs(jsonRequest("POST", { ttlDays: "forever" })));
    expect(res.status).toBe(422);
    expect(createSelfEnrollmentLink).not.toHaveBeenCalled();
  });

  it("surfaces the library's own 422 for an out-of-range window", async () => {
    vi.mocked(createSelfEnrollmentLink).mockResolvedValue({
      status: "422",
      error: "VALIDATION_ERROR",
      fields: { ttlDays: "too long" },
    });
    const res = await apiAction(apiArgs(jsonRequest("POST", { ttlDays: 9999 })));
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ error: "VALIDATION_ERROR" });
  });

  it("lists links without ever exposing a token or its hash", async () => {
    const res = await apiLoader(apiArgs(new Request(API_URL)));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("link-1");
    expect(body).not.toContain("tokenHash");
    expect(body).not.toContain("raw-token");
  });

  it("revokes a link and 204s", async () => {
    const res = await apiAction(
      apiArgs(new Request(`${API_URL}?linkId=link-1`, { method: "DELETE" })),
    );
    expect(res.status).toBe(204);
    expect(revokeSelfEnrollmentLink).toHaveBeenCalledWith("course-1", "link-1");
  });

  it("400s a revoke with no linkId", async () => {
    const res = await apiAction(apiArgs(new Request(API_URL, { method: "DELETE" })));
    expect(res.status).toBe(400);
    expect(revokeSelfEnrollmentLink).not.toHaveBeenCalled();
  });

  it("404s a revoke for a link the course does not own", async () => {
    vi.mocked(revokeSelfEnrollmentLink).mockResolvedValue({ status: "404" });
    const res = await apiAction(
      apiArgs(new Request(`${API_URL}?linkId=other`, { method: "DELETE" })),
    );
    expect(res.status).toBe(404);
  });

  it("audit-logs both minting and revoking", async () => {
    await apiAction(apiArgs(jsonRequest("POST", {})));
    await apiAction(apiArgs(new Request(`${API_URL}?linkId=link-1`, { method: "DELETE" })));
    expect(vi.mocked(logAuditAction).mock.calls.map((call) => call[0].actionCode)).toEqual([
      "SELF_ENROLLMENT_LINK_CREATED",
      "SELF_ENROLLMENT_LINK_REVOKED",
    ]);
  });

  it("never writes the raw token into the audit log", async () => {
    await apiAction(apiArgs(jsonRequest("POST", {})));
    const logged = JSON.stringify(vi.mocked(logAuditAction).mock.calls[0][0]);
    expect(logged).not.toContain("raw-token-xyz");
  });
});

describe("/courses/self-enroll — redemption page", () => {
  beforeEach(() => {
    vi.mocked(getRequestSession).mockResolvedValue({
      user: { id: "student-1", role: "STUDENT" },
    } as never);
    vi.mocked(previewSelfEnrollmentLink).mockResolvedValue({
      ok: true,
      alreadyEnrolled: false,
      courseId: "course-1",
      courseCode: "COSC 111",
      courseName: "Intro to CS",
    });
    vi.mocked(redeemSelfEnrollmentLink).mockResolvedValue({
      status: "201",
      courseId: "course-1",
      enrollmentId: "enr-1",
      linkId: "link-1",
      alreadyEnrolled: false,
    });
  });

  it("sends an anonymous visitor to login and back again afterwards", async () => {
    vi.mocked(getRequestSession).mockResolvedValue(null);
    const res = await pageLoader(
      pageArgs(new Request(`${PAGE_URL}?token=abc`)) as LoaderFunctionArgs,
    );
    expect(res).toBeInstanceOf(Response);
    const redirectTo = (res as Response).headers.get("Location") ?? "";
    expect((res as Response).status).toBe(302);
    expect(redirectTo).toContain("/auth/login");
    // The token must survive the login round trip or the student loses the link
    // for good. Asserted by PARAMETER NAME, not by substring: `routes/auth/
    // login.tsx` reads `?redirect=` and nothing else, so a value parked under
    // any other key is silently dropped and the student lands on /dashboard.
    const loginUrl = new URL(redirectTo, "http://localhost");
    expect(loginUrl.searchParams.get("redirect")).toBe("/courses/self-enroll?token=abc");
    expect(previewSelfEnrollmentLink).not.toHaveBeenCalled();
  });

  it("previews the course for a signed-in student without redeeming", async () => {
    const result = await pageLoader(
      pageArgs(new Request(`${PAGE_URL}?token=abc`)) as LoaderFunctionArgs,
    );
    expect(result).toEqual({
      ok: true,
      token: "abc",
      courseId: "course-1",
      courseCode: "COSC 111",
      courseName: "Intro to CS",
    });
    expect(redeemSelfEnrollmentLink).not.toHaveBeenCalled();
  });

  it("asks the preview on behalf of the signed-in student, not anonymously", async () => {
    // The viewer is what lets the preview apply the already-enrolled allowance;
    // dropping it silently restores the error page this test guards against.
    await pageLoader(pageArgs(new Request(`${PAGE_URL}?token=abc`)) as LoaderFunctionArgs);
    expect(previewSelfEnrollmentLink).toHaveBeenCalledWith("abc", "student-1");
  });

  it("sends an already-enrolled student straight into the course", async () => {
    // The redeem path answers 200 for this student, but they only reach it by
    // pressing Join — and Join is not rendered on an error page. A link that has
    // filled up, been revoked or expired must not turn a returning student away
    // from a course they are already in.
    vi.mocked(previewSelfEnrollmentLink).mockResolvedValue({
      ok: true,
      alreadyEnrolled: true,
      courseId: "course-1",
      courseCode: "COSC 111",
      courseName: "Intro to CS",
    });

    const res = await pageLoader(
      pageArgs(new Request(`${PAGE_URL}?token=abc`)) as LoaderFunctionArgs,
    );

    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(302);
    expect((res as Response).headers.get("Location")).toBe("/courses/course-1");
    // A loader must stay read-only: nothing was redeemed on a GET.
    expect(redeemSelfEnrollmentLink).not.toHaveBeenCalled();
  });

  it("reports a missing token without a database read", async () => {
    const result = await pageLoader(pageArgs(new Request(PAGE_URL)) as LoaderFunctionArgs);
    expect(result).toMatchObject({ ok: false, error: "MISSING_TOKEN" });
    expect(previewSelfEnrollmentLink).not.toHaveBeenCalled();
  });

  it("turns each rejection code into a message the student can act on", async () => {
    for (const error of ["LINK_EXPIRED", "LINK_REVOKED", "COURSE_NOT_PUBLISHED"] as const) {
      vi.mocked(previewSelfEnrollmentLink).mockResolvedValue({ ok: false, error });
      const result = await pageLoader(
        pageArgs(new Request(`${PAGE_URL}?token=abc`)) as LoaderFunctionArgs,
      );
      expect(result).toMatchObject({ ok: false, error, message: expect.any(String) });
    }
  });

  it("redeems on submit and redirects into the course", async () => {
    const form = new FormData();
    form.set("token", "abc");
    const res = await pageAction(pageArgs(new Request(PAGE_URL, { method: "POST", body: form })));
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).headers.get("Location")).toBe("/courses/course-1");
    expect(redeemSelfEnrollmentLink).toHaveBeenCalledWith({
      token: "abc",
      userId: "student-1",
    });
  });

  it("redirects into the course when the student was already enrolled", async () => {
    vi.mocked(redeemSelfEnrollmentLink).mockResolvedValue({
      status: "200",
      courseId: "course-1",
      enrollmentId: "enr-1",
      linkId: "link-1",
      alreadyEnrolled: true,
    });
    const form = new FormData();
    form.set("token", "abc");
    const res = await pageAction(pageArgs(new Request(PAGE_URL, { method: "POST", body: form })));
    expect((res as Response).headers.get("Location")).toBe("/courses/course-1");
  });

  it("re-renders with the error when redemption is refused", async () => {
    vi.mocked(redeemSelfEnrollmentLink).mockResolvedValue({
      status: "410",
      error: "LINK_EXPIRED",
    });
    const form = new FormData();
    form.set("token", "abc");
    const result = await pageAction(
      pageArgs(new Request(PAGE_URL, { method: "POST", body: form })),
    );
    expect(result).toMatchObject({ ok: false, error: "LINK_EXPIRED" });
  });

  it("refuses to redeem for an anonymous poster", async () => {
    vi.mocked(getRequestSession).mockResolvedValue(null);
    const form = new FormData();
    form.set("token", "abc");
    const res = await pageAction(pageArgs(new Request(PAGE_URL, { method: "POST", body: form })));
    expect((res as Response).status).toBe(302);
    expect(redeemSelfEnrollmentLink).not.toHaveBeenCalled();
  });

  it("audits the enrollment it creates, naming the link as the source", async () => {
    // Without this, a roster built from a shared link is the one enrollment
    // path invisible to "who joined this course, and how?" — the single-add
    // route and the CSV import both log ENROLLMENT_ADDED.
    const form = new FormData();
    form.set("token", "abc");
    await pageAction(pageArgs(new Request(PAGE_URL, { method: "POST", body: form })));

    expect(logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({
        actionCode: "ENROLLMENT_ADDED",
        category: "ENROLLMENT",
        entityType: "Enrollment",
        entityId: "enr-1",
        details: expect.objectContaining({
          courseId: "course-1",
          role: "STUDENT",
          targetUserId: "student-1",
          source: "SELF_ENROLLMENT_LINK",
          linkId: "link-1",
        }),
      }),
    );
  });

  it("never puts the raw token in the audit entry", async () => {
    const form = new FormData();
    form.set("token", "super-secret-token");
    await pageAction(pageArgs(new Request(PAGE_URL, { method: "POST", body: form })));

    expect(JSON.stringify(vi.mocked(logAuditAction).mock.calls)).not.toContain(
      "super-secret-token",
    );
  });

  it("logs nothing when the student was already enrolled — that request wrote nothing", async () => {
    vi.mocked(redeemSelfEnrollmentLink).mockResolvedValue({
      status: "200",
      courseId: "course-1",
      enrollmentId: "enr-1",
      linkId: "link-1",
      alreadyEnrolled: true,
    });
    const form = new FormData();
    form.set("token", "abc");
    await pageAction(pageArgs(new Request(PAGE_URL, { method: "POST", body: form })));

    expect(logAuditAction).not.toHaveBeenCalled();
  });
});

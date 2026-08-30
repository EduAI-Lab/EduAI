/**
 * GET /api/auth/me — the bug-report triage flag is now role-based (§11, #311
 * item 5): ADMIN-only, replacing the previous BUG_REPORT_ADMIN_EMAILS allowlist
 * (and dropping UNIT_ADMIN). No DB: session validation + findOrCreateUser mocked.
 */
import { vi, describe, it, expect, afterEach } from "vitest";
import request from "supertest";

vi.mock("../../src/services/authService.js", () => ({
  findOrCreateUser: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../src/config/settings.js", () => {
  const cfg = {
    coreUrl: "http://core.test",
    eduaiApiKey: "k",
    corsOrigins: ["*"],
    nodeEnv: "test",
    logLevel: "silent",
    // An allowlist that, under the old behavior, would have granted bug-admin —
    // it must now be ignored.
    bugReportAdminEmails: ["inst@test.com"],
  };
  return { config: cfg, default: cfg };
});

const { default: app } = await import("../../src/app.js");

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  };
}

function authAs(user, courses = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/sessions/validate")) return Promise.resolve(jsonResponse({ user }));
      if (url.includes("/api/courses")) {
        return Promise.resolve(
          jsonResponse({ data: courses, total: courses.length, page: 1, pageSize: 100 }),
        );
      }
      return Promise.reject(new Error(`Unexpected Core request: ${url}`));
    }),
  );
}

afterEach(() => vi.restoreAllMocks());

describe("GET /api/auth/me isBugReportAdmin (role-only, ADMIN)", () => {
  it("is true for ADMIN", async () => {
    authAs({ id: "a", email: "admin@test.com", role: "ADMIN", name: "A" });
    const res = await request(app).get("/api/auth/me").set("Cookie", "session=v");
    expect(res.status).toBe(200);
    expect(res.body.user.isBugReportAdmin).toBe(true);
  });

  it.each(["UNIT_ADMIN", "INSTRUCTOR", "TA", "STUDENT"])("is false for %s", async (role) => {
    authAs({ id: "u", email: "inst@test.com", role, name: "U" });
    const res = await request(app).get("/api/auth/me").set("Cookie", "session=v");
    expect(res.status).toBe(200);
    // Even though inst@test.com is in the legacy allowlist, role-only gating wins.
    expect(res.body.user.isBugReportAdmin).toBe(false);
  });

  it("marks a platform student as a TA only when Core reports a live TA enrollment", async () => {
    authAs({ id: "ta", email: "ta@test.com", role: "STUDENT", name: "T" }, [
      { id: "course-1", callerEnrollmentRole: "TA" },
    ]);
    const res = await request(app).get("/api/auth/me").set("Cookie", "session=v");
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ role: "STUDENT", questionMakerRole: "TA" });
  });

  it("fails closed when Core cannot verify a student's course role", async () => {
    authAs({ id: "s", email: "student@test.com", role: "STUDENT", name: "S" });
    fetch.mockImplementationOnce(() =>
      Promise.resolve(
        jsonResponse({
          user: { id: "s", email: "student@test.com", role: "STUDENT", name: "S" },
        }),
      ),
    );
    fetch.mockRejectedValueOnce(new Error("Core unavailable"));
    const res = await request(app).get("/api/auth/me").set("Cookie", "session=v");
    expect(res.status).toBe(503);
    expect(res.body.user).toBeUndefined();
  });
});

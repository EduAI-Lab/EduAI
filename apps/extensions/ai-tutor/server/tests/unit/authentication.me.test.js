/**
 * Unit tests for GET /api/me effective-role resolution (AI Tutor server).
 *
 * Core dropped the platform-level UserRole.TA (#664): a course TA is a
 * STUDENT-platform user with Enrollment(role=TA). `/api/me` surfaces an
 * effective TA role so the client RBAC (which keys its view off a single role
 * string) still routes course TAs into the teaching shell after the migration.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

vi.mock("../../src/services/eduaiClient.js", () => ({
  listEduAiCourses: vi.fn(),
}));

vi.mock("../../src/services/importTaughtCoursesService.js", () => ({
  // The shared mirror runner now lives here (unified contract) — the route
  // delegates the throttle + fire-and-forget to it, so tests observe
  // runCoreMirror rather than the two underlying import functions.
  runCoreMirror: vi.fn(),
  resetCoreMirrorThrottleForTests: vi.fn(),
  userHasCoreTaEnrollment: vi.fn(),
}));

const { listEduAiCourses } = await import("../../src/services/eduaiClient.js");
const { runCoreMirror, userHasCoreTaEnrollment } =
  await import("../../src/services/importTaughtCoursesService.js");
const authModule = await import("../../src/routes/authentication.js");
const authRouter = authModule.default;

process.env.CORE_URL = "http://core.test";
process.env.CORE_PUBLIC_ORIGIN = "http://core-public.test";
process.env.EDUAI_API_KEY = "test-service-key";
const originalCoreAuthTimeoutMs = process.env.CORE_AUTH_TIMEOUT_MS;

function appFor(user) {
  const app = express();
  app.use((req, _res, next) => {
    req.user = user;
    next();
  });
  app.use("/api", authRouter);
  return app;
}

const student = { id: "u-1", name: "Sam", email: "sam@test.com", role: "STUDENT" };
const coreCourses = [
  { id: "core-1", callerEnrollmentRole: "STUDENT" },
  { id: "core-2", callerEnrollmentRole: "TA" },
];

describe("GET /api/me effective TA role", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEduAiCourses.mockResolvedValue(coreCourses);
  });

  it("fetches Core courses once and passes the list to import + TA resolution", async () => {
    userHasCoreTaEnrollment.mockResolvedValue(true);

    const res = await request(appFor(student)).get("/api/me");

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("TA");
    expect(listEduAiCourses).toHaveBeenCalledOnce();
    expect(runCoreMirror).toHaveBeenCalledWith(student, "", { coreCourses });
    expect(userHasCoreTaEnrollment).toHaveBeenCalledWith("", coreCourses);
  });

  it("keeps role STUDENT when Core reports no TA enrollment", async () => {
    userHasCoreTaEnrollment.mockResolvedValue(false);

    const res = await request(appFor(student)).get("/api/me");

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("STUDENT");
  });

  it("falls back to the platform role when the TA check throws", async () => {
    userHasCoreTaEnrollment.mockRejectedValue(new Error("Core unavailable"));

    const res = await request(appFor(student)).get("/api/me");

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("STUDENT");
  });

  it("skips TA resolution when the Core course list fetch fails", async () => {
    listEduAiCourses.mockRejectedValue(new Error("Core unavailable"));

    const res = await request(appFor(student)).get("/api/me");

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("STUDENT");
    expect(userHasCoreTaEnrollment).not.toHaveBeenCalled();
    expect(runCoreMirror).toHaveBeenCalledWith(student, "", {});
  });

  it("does not run the TA check for non-STUDENT platform roles", async () => {
    const instructor = { ...student, role: "INSTRUCTOR" };

    const res = await request(appFor(instructor)).get("/api/me");

    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe("INSTRUCTOR");
    expect(userHasCoreTaEnrollment).not.toHaveBeenCalled();
  });
});

describe("POST /api/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    if (originalCoreAuthTimeoutMs === undefined) {
      delete process.env.CORE_AUTH_TIMEOUT_MS;
    } else {
      process.env.CORE_AUTH_TIMEOUT_MS = originalCoreAuthTimeoutMs;
    }
  });

  it("proxies sign-out to Core and reports success only after Core succeeds", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", mockFetch);

    const res = await request(appFor(null)).post("/api/logout").set("Cookie", "session=valid");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("http://core.test/api/auth/sign-out");
    expect(options.headers.cookie).toBe("session=valid");
    expect(options.headers.origin).toBe("http://core-public.test");
    expect(options.headers.authorization).toBe("Bearer test-service-key");
  });

  it("returns 503 instead of ok:true when Core rejects logout with a 5xx", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(appFor(null)).post("/api/logout");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, error: "Logout service unavailable" });
  });

  it("returns 503 instead of ok:true when Core is unreachable during logout", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(appFor(null)).post("/api/logout");

    expect(res.status).toBe(503);
    expect(res.body).toEqual({ ok: false, error: "Logout service unavailable" });
  });

  it("returns 504 when Core logout never responds before the configured deadline", async () => {
    process.env.CORE_AUTH_TIMEOUT_MS = "5";
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      ),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await request(appFor(null)).post("/api/logout");

    expect(res.status).toBe(504);
    expect(res.body).toEqual({ ok: false, error: "Logout service timed out" });
  });
});

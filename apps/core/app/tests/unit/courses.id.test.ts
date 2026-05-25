import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  enforceAdminIfApiKey: vi.fn().mockResolvedValue({ response: null, session: null }),
  requireServiceKey: vi.fn(),
}));

vi.mock("~/lib/courses/server", () => ({
  getCourse: vi.fn(),
  handleCourseRequest: vi.fn(),
}));

import { loader } from "~/routes/api/courses.id";
import { auth } from "~/lib/auth/server";
import { requireServiceKey } from "~/lib/auth/guards.server";
import { getCourse } from "~/lib/courses/server";

const VALID_KEY = "test-service-key";
const COURSE = {
  id: "course-1",
  name: "Algorithms",
  code: "COSC 101",
  deletedAt: null,
};

function makeArgs(id?: string, authorization?: string) {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  return {
    request: new Request(`http://localhost/api/courses/${id ?? ""}`, { headers }),
    params: id !== undefined ? { id } : {},
    context: {} as never,
  };
}

describe("GET /api/courses/:id loader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EDUAI_API_KEY", VALID_KEY);
    vi.mocked(requireServiceKey).mockResolvedValue(null);
    vi.mocked(auth.api.getSession).mockResolvedValue(null);
    vi.mocked(getCourse).mockResolvedValue(COURSE as never);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("returns 400 when id is missing", async () => {
    const res = await loader(makeArgs() as never);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "COURSE_ID_REQUIRED" });
    expect(getCourse).not.toHaveBeenCalled();
  });

  it("returns 401 when no Bearer header and no session", async () => {
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(getCourse).not.toHaveBeenCalled();
  });

  it("returns 403 when Bearer token fails requireServiceKey", async () => {
    vi.mocked(requireServiceKey).mockResolvedValue(
      new Response(JSON.stringify({ error: "INVALID_SERVICE_KEY" }), { status: 403 }),
    );
    const res = await loader(makeArgs("course-1", "Bearer wrong"));
    expect(res.status).toBe(403);
    expect(getCourse).not.toHaveBeenCalled();
  });

  it("returns 200 via service key without session", async () => {
    const res = await loader(makeArgs("course-1", `Bearer ${VALID_KEY}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(COURSE);
    expect(getCourse).toHaveBeenCalledWith("course-1");
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });

  it("returns 404 COURSE_NOT_FOUND when getCourse returns null", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "ADMIN" },
    } as never);
    vi.mocked(getCourse).mockResolvedValue(null);
    const res = await loader(makeArgs("missing"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "COURSE_NOT_FOUND" });
  });

  it("returns 200 with flat course JSON when authenticated", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    const res = await loader(makeArgs("course-1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(COURSE);
    expect(getCourse).toHaveBeenCalledWith("course-1");
  });
});

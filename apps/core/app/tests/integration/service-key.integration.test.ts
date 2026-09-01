import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn().mockResolvedValue(null) } },
}));

vi.mock("~/lib/courses/server", () => ({
  // The topics route reads the provenance-carrying variant (#1624); topics
  // here have no generated sources, so the projection is empty.
  getCourseTopicsWithSources: vi.fn().mockResolvedValue([
    { id: "topic-cuid-1", name: "Arrays & Hashing", deletedAt: null, sources: [], sourceCount: 0 },
    { id: "topic-cuid-2", name: "Two Pointers", deletedAt: null, sources: [], sourceCount: 0 },
  ]),
  getCourseTopicWithSources: vi.fn(),
  createCourseTopic: vi.fn(),
  deleteCourseTopic: vi.fn(),
}));

import { loader } from "~/routes/api/courses.topics.$";
import { getCourseTopicsWithSources } from "~/lib/courses/server";

const VALID_KEY = "integration-test-service-key-xyz";
const COURSE_ID = "course-cuid-abc";

function makeArgs(authorization?: string) {
  const headers = new Headers();
  if (authorization) headers.set("Authorization", authorization);
  return {
    request: new Request(`http://localhost/api/courses/${COURSE_ID}/topics`, {
      method: "GET",
      headers,
    }),
    params: { courseId: COURSE_ID },
    context: {} as never,
  } as any;
}

describe("GET /api/courses/:id/topics — requireServiceKey guard (integration)", () => {
  beforeEach(() => {
    vi.stubEnv("EDUAI_API_KEY", VALID_KEY);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns 403 INVALID_SERVICE_KEY and never calls getCourseTopicsWithSources for a wrong key", async () => {
    const response = await loader(makeArgs("Bearer wrong-key-here"));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "INVALID_SERVICE_KEY" });
    expect(getCourseTopicsWithSources).not.toHaveBeenCalled();
  });

  it("returns 200 with topics and calls getCourseTopicsWithSources when the correct service key is provided", async () => {
    const response = await loader(makeArgs(`Bearer ${VALID_KEY}`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveProperty("topics");
    expect(body.topics).toHaveLength(2);
    expect(getCourseTopicsWithSources).toHaveBeenCalledOnce();
    expect(getCourseTopicsWithSources).toHaveBeenCalledWith(COURSE_ID, false);
  });

  it("returns 401 Unauthorized (session path) when no Authorization header is sent", async () => {
    const response = await loader(makeArgs());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(getCourseTopicsWithSources).not.toHaveBeenCalled();
  });
});

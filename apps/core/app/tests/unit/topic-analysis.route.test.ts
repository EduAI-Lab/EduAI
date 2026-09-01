import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveCourseAccessGate = vi.hoisted(() => vi.fn());
const getRequestSession = vi.hoisted(() => vi.fn());
const review = vi.hoisted(() => ({
  latestTopicAnalysisForCourse: vi.fn(),
  approveGeneratedTopic: vi.fn(),
  dismissGeneratedTopic: vi.fn(),
  mergeGeneratedTopic: vi.fn(),
  retryTopicAnalysis: vi.fn(),
}));

vi.mock("~/lib/auth/course-access.server", () => ({ resolveCourseAccessGate }));
vi.mock("~/lib/auth/request-session.server", () => ({ getRequestSession }));
vi.mock("~/lib/topics/review.server", () => review);
vi.mock("~/lib/logging.server", () => ({ fireAndForget: vi.fn(), logAuditAction: vi.fn() }));
vi.mock("~/lib/request-context.server", () => ({
  getActorContext: () => ({}),
  getRequestContext: () => ({}),
}));

const { loader, action } = await import("~/routes/api/courses.topic-analysis.$");

const COURSE = { id: "course-1", isPublished: true };
const SESSION = { user: { id: "user-1", role: "INSTRUCTOR" } };
const PARAMS = { courseId: "course-1" };

/** The bodies this route accepts, plus the malformed ones under test. */
type ReviewBody =
  | { action: string; topicId?: string; intoTopicId?: string }
  | Record<string, never>;

function post(body: ReviewBody, method: "POST" | "PATCH" = "POST") {
  return new Request("https://eduai.test/api/courses/course-1/topic-analysis", {
    method,
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function get() {
  return new Request("https://eduai.test/api/courses/course-1/topic-analysis");
}

beforeEach(() => {
  vi.clearAllMocks();
  getRequestSession.mockResolvedValue(SESSION);
  resolveCourseAccessGate.mockResolvedValue({
    course: COURSE,
    access: { level: "instructor", rank: 2 },
  });
  review.latestTopicAnalysisForCourse.mockResolvedValue({ job: null, pendingSuggestions: 0 });
  review.approveGeneratedTopic.mockResolvedValue({
    status: "200",
    topic: { id: "topic-1", name: "Recursion" },
  });
});

describe("GET /api/courses/:courseId/topic-analysis", () => {
  it("returns the status for staff", async () => {
    review.latestTopicAnalysisForCourse.mockResolvedValue({
      job: { id: "job-1", status: "COMPLETED" },
      pendingSuggestions: 3,
    });

    const response = await loader({ request: get(), params: PARAMS } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ pendingSuggestions: 3 });
  });

  it("401s an anonymous caller", async () => {
    getRequestSession.mockResolvedValue(null);
    const response = await loader({ request: get(), params: PARAMS } as never);
    expect(response.status).toBe(401);
  });

  it("404s an unknown course without leaking its existence", async () => {
    resolveCourseAccessGate.mockResolvedValue({ course: null, access: null });
    const response = await loader({ request: get(), params: PARAMS } as never);
    expect(response.status).toBe(404);
  });

  it("403s a student — provenance is a staff concern", async () => {
    resolveCourseAccessGate.mockResolvedValue({
      course: COURSE,
      access: { level: "student", rank: 0 },
    });
    const response = await loader({ request: get(), params: PARAMS } as never);
    expect(response.status).toBe(403);
  });

  it("allows a TA to read the status", async () => {
    resolveCourseAccessGate.mockResolvedValue({ course: COURSE, access: { level: "ta", rank: 1 } });
    const response = await loader({ request: get(), params: PARAMS } as never);
    expect(response.status).toBe(200);
  });
});

describe("POST /api/courses/:courseId/topic-analysis", () => {
  it("approves a suggestion", async () => {
    const response = await action({
      request: post({ action: "approve", topicId: "t1" }),
      params: PARAMS,
    } as never);

    expect(response.status).toBe(200);
    expect(review.approveGeneratedTopic).toHaveBeenCalledWith("course-1", "t1");
  });

  it("dismisses a suggestion, attributing the actor", async () => {
    review.dismissGeneratedTopic.mockResolvedValue({
      status: "200",
      topic: { id: "t1", name: "Recursion" },
    });

    await action({ request: post({ action: "dismiss", topicId: "t1" }), params: PARAMS } as never);

    expect(review.dismissGeneratedTopic).toHaveBeenCalledWith("course-1", "t1", "user-1");
  });

  it("merges into another topic", async () => {
    review.mergeGeneratedTopic.mockResolvedValue({
      status: "200",
      topic: { id: "t2", name: "Recursion" },
    });

    await action({
      request: post({ action: "merge", topicId: "t1", intoTopicId: "t2" }),
      params: PARAMS,
    } as never);

    expect(review.mergeGeneratedTopic).toHaveBeenCalledWith("course-1", "t1", "t2", "user-1");
  });

  it("retries a failed analysis", async () => {
    review.retryTopicAnalysis.mockResolvedValue({ jobId: "job-2" });

    const response = await action({ request: post({ action: "retry" }), params: PARAMS } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ jobId: "job-2" });
  });

  it("409s a retry on a course with nothing to analyse", async () => {
    review.retryTopicAnalysis.mockResolvedValue(null);

    const response = await action({ request: post({ action: "retry" }), params: PARAMS } as never);

    expect(response.status).toBe(409);
  });

  it("403s a TA — merging repoints every question on a topic", async () => {
    resolveCourseAccessGate.mockResolvedValue({ course: COURSE, access: { level: "ta", rank: 1 } });

    const response = await action({
      request: post({ action: "approve", topicId: "t1" }),
      params: PARAMS,
    } as never);

    expect(response.status).toBe(403);
    expect(review.approveGeneratedTopic).not.toHaveBeenCalled();
  });

  it("405s a non-POST method", async () => {
    const response = await action({
      request: post({ action: "retry" }, "PATCH"),
      params: PARAMS,
    } as never);
    expect(response.status).toBe(405);
  });

  it("400s an unknown action", async () => {
    const response = await action({
      request: post({ action: "delete-everything", topicId: "t1" }),
      params: PARAMS,
    } as never);
    expect(response.status).toBe(400);
  });

  it("400s a merge that targets the topic being merged", async () => {
    const response = await action({
      request: post({ action: "merge", topicId: "t1", intoTopicId: "t1" }),
      params: PARAMS,
    } as never);

    expect(response.status).toBe(400);
    expect(review.mergeGeneratedTopic).not.toHaveBeenCalled();
  });

  it("400s a merge with no target", async () => {
    const response = await action({
      request: post({ action: "merge", topicId: "t1" }),
      params: PARAMS,
    } as never);
    expect(response.status).toBe(400);
  });

  it("400s a malformed JSON body", async () => {
    const request = new Request("https://eduai.test/api/courses/course-1/topic-analysis", {
      method: "POST",
      body: "not json",
      headers: { "Content-Type": "application/json" },
    });

    const response = await action({ request, params: PARAMS } as never);
    expect(response.status).toBe(400);
  });

  it("passes a service-layer 404 through with its code", async () => {
    review.approveGeneratedTopic.mockResolvedValue({
      status: "404",
      error: "TOPIC_NOT_FOUND",
    });

    const response = await action({
      request: post({ action: "approve", topicId: "human-topic" }),
      params: PARAMS,
    } as never);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "TOPIC_NOT_FOUND" });
  });
});

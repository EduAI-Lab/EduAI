// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";

const getSession = vi.hoisted(() => vi.fn());
const requireServiceKey = vi.hoisted(() => vi.fn());
const findFirst = vi.hoisted(() => vi.fn());
const getQueuePosition = vi.hoisted(() => vi.fn());

vi.mock("~/lib/auth/server", () => ({ auth: { api: { getSession } } }));
vi.mock("~/lib/auth/guards.server", () => ({ requireServiceKey }));
vi.mock("~/lib/prisma.server", () => ({ default: { aiJob: { findFirst } } }));
vi.mock("~/lib/queue/queue-stats.server", () => ({ getQueuePosition }));

import { loader } from "~/routes/api.ai-jobs.$jobId";

const job = {
  id: "job-1",
  kind: "question-generation",
  type: "background",
  source: "question-maker",
  status: "PENDING",
  result: null,
  errorMessage: null,
  attempts: 0,
  startedAt: null,
  completedAt: null,
  createdAt: new Date("2026-08-11T00:00:00.000Z"),
  updatedAt: new Date("2026-08-11T00:00:00.000Z"),
  userId: "user-1",
  queueName: "ai-jobs-chat",
};

function request() {
  return new Request("http://localhost/api/ai-jobs/job-1");
}

beforeEach(() => {
  vi.clearAllMocks();
  getSession.mockResolvedValue({ user: { id: "user-1" } });
  requireServiceKey.mockResolvedValue(new Response(null, { status: 401 }));
  findFirst.mockResolvedValue(job);
  getQueuePosition.mockResolvedValue(3);
});

describe("GET /api/ai-jobs/:jobId", () => {
  it("returns a live owner-scoped queue position", async () => {
    const response = await loader({
      request: request(),
      params: { jobId: "job-1" },
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      job: { id: "job-1", status: "PENDING", queuePosition: 3 },
    });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "job-1", userId: "user-1" },
    });
    expect(getQueuePosition).toHaveBeenCalledWith(job);
  });

  it("does not reveal another user's job", async () => {
    findFirst.mockResolvedValue(null);

    const response = await loader({
      request: request(),
      params: { jobId: "job-1" },
    } as never);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "AI job not found" });
    expect(getQueuePosition).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    getSession.mockResolvedValue(null);

    const response = await loader({
      request: request(),
      params: { jobId: "job-1" },
    } as never);

    expect(response.status).toBe(401);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("allows a valid service key to poll service-owned jobs", async () => {
    getSession.mockResolvedValue(null);
    requireServiceKey.mockResolvedValue(null);
    findFirst.mockResolvedValue({ ...job, userId: "service" });

    const response = await loader({
      request: request(),
      params: { jobId: "job-1" },
    } as never);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      job: { id: "job-1", queuePosition: 3 },
    });
    expect(requireServiceKey).toHaveBeenCalledWith(expect.any(Request));
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: "job-1", userId: "service" },
    });
  });

  it("returns the service-key guard response for an invalid service key", async () => {
    getSession.mockResolvedValue(null);
    const guardResponse = new Response(
      JSON.stringify({ error: "INVALID_SERVICE_KEY" }),
      { status: 403 },
    );
    requireServiceKey.mockResolvedValue(guardResponse);

    const response = await loader({
      request: request(),
      params: { jobId: "job-1" },
    } as never);

    expect(response).toBe(guardResponse);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("does not expose internal errors from the status lookup", async () => {
    const internalMessage = "Prisma connection string leaked";
    findFirst.mockRejectedValue(new Error(internalMessage));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const response = await loader({
        request: request(),
        params: { jobId: "job-1" },
      } as never);

      expect(response.status).toBe(500);
      const body = await response.json();
      expect(body).toEqual({ error: "Unexpected server error" });
      expect(JSON.stringify(body)).not.toContain(internalMessage);
    } finally {
      consoleError.mockRestore();
    }
  });
});

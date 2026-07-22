// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JobPayload } from "~/lib/queue/job-schema";

const prismaMock = vi.hoisted(() => ({
  aiJob: { create: vi.fn(), update: vi.fn(), findUnique: vi.fn(), delete: vi.fn() },
}));

const queueAdd = vi.hoisted(() => vi.fn());
const getQueueMock = vi.hoisted(() => vi.fn(() => ({ add: queueAdd })));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));
vi.mock("~/lib/queue/queues.server", () => ({ getQueue: getQueueMock }));
vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logSystemError: vi.fn(),
}));

import { enqueue } from "~/lib/queue/enqueue.server";

const job: JobPayload = {
  kind: "question-generation",
  type: "background",
  source: "question-maker",
  userId: "user_1",
  courseId: "course_1",
  input: { kind: "question-generation", courseId: "course_1", prompt: "5 qs", count: 5 },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.aiJob.create.mockResolvedValue({ id: "aijob_1" });
  prismaMock.aiJob.update.mockResolvedValue({});
  prismaMock.aiJob.findUnique.mockResolvedValue(null);
  prismaMock.aiJob.delete.mockResolvedValue({});
  queueAdd.mockResolvedValue({ id: "bull_1" });
});

describe("enqueue", () => {
  it("creates a PENDING AiJob, enqueues, persists bullJobId, and returns the DB id", async () => {
    const result = await enqueue(job);

    expect(result).toEqual({ jobId: "aijob_1" });

    expect(prismaMock.aiJob.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "PENDING", kind: "question-generation", source: "question-maker" }),
      }),
    );
    // background → chat pool (heavy pool unset in v1), low priority (10), BullMQ name = kind.
    expect(getQueueMock).toHaveBeenCalledWith("ai-jobs:chat");
    expect(queueAdd).toHaveBeenCalledWith("question-generation", job, { jobId: undefined, priority: 10 });
    expect(prismaMock.aiJob.update).toHaveBeenCalledWith({
      where: { id: "aijob_1" },
      data: { bullJobId: "bull_1" },
    });
  });

  it("enqueues interactive work at high priority", async () => {
    await enqueue({ ...job, type: "interactive" });
    expect(getQueueMock).toHaveBeenCalledWith("ai-jobs:chat");
    expect(queueAdd).toHaveBeenCalledWith("question-generation", expect.anything(), expect.objectContaining({ priority: 1 }));
  });

  it("passes idempotencyKey through as the BullMQ jobId", async () => {
    await enqueue({ ...job, idempotencyKey: "idem-9" });
    expect(prismaMock.aiJob.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { bullJobId: "idem-9" } }),
    );
    expect(queueAdd).toHaveBeenCalledWith(
      "question-generation",
      expect.anything(),
      expect.objectContaining({ jobId: "idem-9" }),
    );
  });

  it("returns the existing row for a repeated idempotencyKey without creating a new one", async () => {
    prismaMock.aiJob.findUnique.mockResolvedValueOnce({ id: "aijob_existing" });

    const result = await enqueue({ ...job, idempotencyKey: "idem-9" });

    expect(result).toEqual({ jobId: "aijob_existing" });
    expect(prismaMock.aiJob.create).not.toHaveBeenCalled();
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it("rejects an invalid payload before touching the DB", async () => {
    await expect(enqueue({ ...job, kind: "nope" } as unknown as JobPayload)).rejects.toThrow();
    expect(prismaMock.aiJob.create).not.toHaveBeenCalled();
  });

  it("throws and leaves the row without bullJobId when the queue add fails", async () => {
    queueAdd.mockRejectedValueOnce(new Error("redis down"));
    await expect(enqueue(job)).rejects.toThrow("redis down");
    expect(prismaMock.aiJob.create).toHaveBeenCalled();
    expect(prismaMock.aiJob.update).not.toHaveBeenCalled();
  });
});

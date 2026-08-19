// @vitest-environment node
import { describe, expect, it } from "vitest";
import type { AiJob } from "@prisma/client";
import { serializeAiJob } from "~/lib/queue/serialize.server";

const job = {
  id: "job-1",
  kind: "question-generation",
  type: "background",
  source: "question-maker",
  status: "COMPLETED",
  result: { output: { content: "Q1?" } },
  errorMessage: null,
  attempts: 1,
  startedAt: new Date("2026-08-01T00:00:00.000Z"),
  completedAt: new Date("2026-08-01T00:01:00.000Z"),
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  updatedAt: new Date("2026-08-01T00:01:00.000Z"),
} as unknown as AiJob;

describe("serializeAiJob", () => {
  it("maps timestamps to ISO strings and defaults queue metadata to null", () => {
    expect(serializeAiJob(job)).toEqual({
      id: "job-1",
      kind: "question-generation",
      type: "background",
      source: "question-maker",
      status: "COMPLETED",
      queuePosition: null,
      etaSeconds: null,
      result: { output: { content: "Q1?" } },
      errorMessage: null,
      attempts: 1,
      startedAt: "2026-08-01T00:00:00.000Z",
      completedAt: "2026-08-01T00:01:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:01:00.000Z",
    });
  });

  it("passes through an explicit queuePosition", () => {
    expect(serializeAiJob(job, { queuePosition: 4 })).toMatchObject({
      queuePosition: 4,
    });
  });

  it("passes through an explicit ETA", () => {
    expect(serializeAiJob(job, { etaSeconds: 90 })).toMatchObject({
      etaSeconds: 90,
    });
  });

  it("nulls out unset startedAt/completedAt and defaults a null result", () => {
    const pending = {
      ...job,
      status: "PENDING",
      result: null,
      startedAt: null,
      completedAt: null,
    } as unknown as AiJob;

    expect(serializeAiJob(pending)).toMatchObject({
      result: null,
      startedAt: null,
      completedAt: null,
    });
  });
});

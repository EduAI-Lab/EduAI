// @vitest-environment node

import { describe, it, expect } from "vitest";
import { ZodError, z } from "zod";
import { Prisma } from "@prisma/client";
import {
  QueueUnavailableError,
  httpStatusForEnqueueError,
  isInfrastructureError,
  toQueueUnavailable,
} from "~/lib/queue/errors.server";

describe("queue errors (#1112)", () => {
  it("classifies Redis connection failures as infrastructure", () => {
    expect(isInfrastructureError(new Error("connect ECONNREFUSED 127.0.0.1:6379"))).toBe(true);
    expect(isInfrastructureError(new Error("Redis connection lost"))).toBe(true);
  });

  it("classifies Prisma DB-unreachable codes as infrastructure", () => {
    const err = new Prisma.PrismaClientKnownRequestError("cant reach database", {
      code: "P1001",
      clientVersion: "6",
    });
    expect(isInfrastructureError(err)).toBe(true);
  });

  it("does not treat validation / app errors as infrastructure", () => {
    expect(isInfrastructureError(new Error("Invalid course id"))).toBe(false);
    expect(isInfrastructureError(new ZodError([]))).toBe(false);
  });

  it("maps enqueue failures to the correct HTTP status", () => {
    expect(httpStatusForEnqueueError(new ZodError([]))).toBe(400);
    expect(httpStatusForEnqueueError(new QueueUnavailableError())).toBe(503);
    expect(httpStatusForEnqueueError(new Error("ECONNREFUSED"))).toBe(503);
    expect(httpStatusForEnqueueError(new Error("boom"))).toBe(500);
  });

  it("wraps unknown errors as QueueUnavailableError with cause", () => {
    const cause = new Error("socket hang up");
    const wrapped = toQueueUnavailable(cause);
    expect(wrapped).toBeInstanceOf(QueueUnavailableError);
    expect(wrapped.status).toBe(503);
    expect(wrapped.cause).toBe(cause);
  });

  it("keeps Zod schemas distinct from QueueUnavailableError", () => {
    const schema = z.object({ x: z.string() });
    try {
      schema.parse({});
    } catch (error) {
      expect(httpStatusForEnqueueError(error)).toBe(400);
    }
  });
});

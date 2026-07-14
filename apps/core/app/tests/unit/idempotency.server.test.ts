// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

const prismaMock = vi.hoisted(() => ({
  idempotencyRecord: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
    deleteMany: vi.fn(),
  },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: prismaMock,
}));

import {
  hashRequestBody,
  extractIdempotencyKey,
  bodyForIdempotencyHash,
  claimIdempotency,
  completeIdempotency,
  releaseIdempotency,
  withIdempotency,
} from "~/lib/idempotency.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hashRequestBody", () => {
  it("is stable regardless of object key order", () => {
    expect(hashRequestBody({ a: 1, b: 2 })).toBe(hashRequestBody({ b: 2, a: 1 }));
  });

  it("excludes idempotencyKey from hash via bodyForIdempotencyHash", () => {
    const a = hashRequestBody(bodyForIdempotencyHash({ email: "a@b.c", idempotencyKey: "k1" }));
    const b = hashRequestBody(bodyForIdempotencyHash({ email: "a@b.c", idempotencyKey: "k2" }));
    expect(a).toBe(b);
  });
});

describe("extractIdempotencyKey", () => {
  it("prefers Idempotency-Key header over body", () => {
    const req = new Request("http://localhost/api/users", {
      headers: { "Idempotency-Key": "header-key" },
    });
    expect(extractIdempotencyKey(req, { idempotencyKey: "body-key" })).toBe("header-key");
  });

  it("falls back to body idempotencyKey", () => {
    const req = new Request("http://localhost/api/users");
    expect(extractIdempotencyKey(req, { idempotencyKey: "body-key" })).toBe("body-key");
  });
});

describe("claimIdempotency", () => {
  it("returns claimed on fresh insert", async () => {
    prismaMock.idempotencyRecord.create.mockResolvedValue({});
    const result = await claimIdempotency({
      key: "k1",
      route: "POST /api/users",
      actorId: "admin-1",
      requestHash: "abc",
    });
    expect(result).toEqual({ kind: "claimed" });
  });

  it("returns replay when COMPLETED with matching hash", async () => {
    prismaMock.idempotencyRecord.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    prismaMock.idempotencyRecord.findUnique.mockResolvedValue({
      key: "k1",
      route: "POST /api/users",
      actorId: "admin-1",
      requestHash: "abc",
      status: "COMPLETED",
      statusCode: 201,
      responseBody: { id: "u1" },
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await claimIdempotency({
      key: "k1",
      route: "POST /api/users",
      actorId: "admin-1",
      requestHash: "abc",
    });
    expect(result).toEqual({
      kind: "replay",
      statusCode: 201,
      responseBody: { id: "u1" },
    });
  });

  it("returns mismatch when hash differs", async () => {
    prismaMock.idempotencyRecord.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    prismaMock.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: "other",
      status: "COMPLETED",
      statusCode: 201,
      responseBody: {},
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await claimIdempotency({
      key: "k1",
      route: "POST /api/users",
      actorId: "admin-1",
      requestHash: "abc",
    });
    expect(result).toEqual({ kind: "mismatch" });
  });

  it("returns in_progress when PROCESSING", async () => {
    prismaMock.idempotencyRecord.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    prismaMock.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: "abc",
      status: "PROCESSING",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await claimIdempotency({
      key: "k1",
      route: "POST /api/users",
      actorId: "admin-1",
      requestHash: "abc",
    });
    expect(result).toEqual({ kind: "in_progress" });
  });
});

describe("withIdempotency", () => {
  it("skips idempotency when no key is provided", async () => {
    const handler = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const request = new Request("http://localhost/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "a@b.c" }),
    });

    const res = await withIdempotency(
      { request, route: "POST /api/users", actorId: "admin-1" },
      handler,
    );
    expect(handler).toHaveBeenCalledOnce();
    expect(res.status).toBe(200);
    expect(prismaMock.idempotencyRecord.create).not.toHaveBeenCalled();
  });

  it("returns IDEMPOTENCY_KEY_MISMATCH on body hash conflict", async () => {
    prismaMock.idempotencyRecord.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    prismaMock.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: "other-hash",
      status: "COMPLETED",
      statusCode: 201,
      responseBody: {},
      expiresAt: new Date(Date.now() + 60_000),
    });

    const request = new Request("http://localhost/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-1",
      },
      body: JSON.stringify({ email: "a@b.c" }),
    });

    const res = await withIdempotency(
      { request, route: "POST /api/users", actorId: "admin-1" },
      vi.fn(),
    );
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toBe("IDEMPOTENCY_KEY_MISMATCH");
  });

  it("completes record on successful handler response", async () => {
    prismaMock.idempotencyRecord.create.mockResolvedValue({});
    prismaMock.idempotencyRecord.update.mockResolvedValue({});

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "u1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = new Request("http://localhost/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-ok",
      },
      body: JSON.stringify({ email: "a@b.c", name: "A", role: "STUDENT" }),
    });

    const res = await withIdempotency(
      { request, route: "POST /api/users", actorId: "admin-1" },
      handler,
    );
    expect(res.status).toBe(201);
    expect(completeIdempotency).toBeDefined();
    expect(prismaMock.idempotencyRecord.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "COMPLETED",
          statusCode: 201,
        }),
      }),
    );
  });

  it("scopes the same key to distinct routes (e.g. per-course enrollments)", async () => {
    prismaMock.idempotencyRecord.create.mockResolvedValue({});

    const body = { userId: "u9", role: "STUDENT" };
    const requestHash = hashRequestBody(body);

    const courseOne = await claimIdempotency({
      key: "enroll-shared",
      route: "POST /api/courses/course-1/enrollments",
      actorId: "admin-1",
      requestHash,
    });
    const courseTwo = await claimIdempotency({
      key: "enroll-shared",
      route: "POST /api/courses/course-2/enrollments",
      actorId: "admin-1",
      requestHash,
    });

    expect(courseOne).toEqual({ kind: "claimed" });
    expect(courseTwo).toEqual({ kind: "claimed" });
    expect(prismaMock.idempotencyRecord.create).toHaveBeenCalledTimes(2);
  });

  it("releases claim on non-2xx handler response", async () => {
    prismaMock.idempotencyRecord.create.mockResolvedValue({});
    prismaMock.idempotencyRecord.deleteMany.mockResolvedValue({ count: 1 });

    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "VALIDATION_ERROR" }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const request = new Request("http://localhost/api/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "idem-fail",
      },
      body: JSON.stringify({}),
    });

    await withIdempotency(
      { request, route: "POST /api/users", actorId: "admin-1" },
      handler,
    );
    expect(prismaMock.idempotencyRecord.deleteMany).toHaveBeenCalled();
  });

  it("does not replay another actor's response for the same key", async () => {
    // Same key+route already completed for a different actor must not be reused.
    prismaMock.idempotencyRecord.create.mockResolvedValue({});
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "new-row" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const request = new Request("http://localhost/api/questions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "shared-key",
      },
      body: JSON.stringify({ courseId: "course-1", text: "Question" }),
    });

    const response = await withIdempotency(
      { request, route: "POST /api/questions", actorId: "instructor-2" },
      handler,
    );

    expect(response.status).toBe(201);
    expect(handler).toHaveBeenCalledOnce();
    expect(prismaMock.idempotencyRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ actorId: "instructor-2", key: "shared-key" }),
    });
    // Never looks up another actor's completed record for replay.
    expect(prismaMock.idempotencyRecord.findUnique).not.toHaveBeenCalled();
  });

  it("keeps a successful mutation claimed when completion persistence fails", async () => {
    prismaMock.idempotencyRecord.create.mockResolvedValue({});
    prismaMock.idempotencyRecord.update.mockRejectedValue(new Error("database unavailable"));
    const handler = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "q1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const request = new Request("http://localhost/api/questions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "question-create",
      },
      body: JSON.stringify({ courseId: "course-1", text: "Question" }),
    });

    await expect(
      withIdempotency(
        { request, route: "POST /api/questions", actorId: "instructor-1" },
        handler,
      ),
    ).rejects.toThrow("database unavailable");
    expect(prismaMock.idempotencyRecord.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.idempotencyRecord.deleteMany).not.toHaveBeenCalled();
  });
});

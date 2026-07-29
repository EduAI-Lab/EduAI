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
  requestUrlFromIdempotencyRoute,
  runIdempotentAdminMutation,
} from "~/lib/agent-tools/idempotent-admin-mutation.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("requestUrlFromIdempotencyRoute (#1110)", () => {
  it("strips METHOD prefix and builds a valid absolute URL", () => {
    const url = requestUrlFromIdempotencyRoute("POST /api/users");
    expect(url.href).toBe("http://localhost/api/users");
    expect(() => new Request(url, { method: "POST" })).not.toThrow();
  });

  it("handles parameterized paths used as composite keys", () => {
    expect(requestUrlFromIdempotencyRoute("POST /api/courses/:id/enrollments").pathname).toBe(
      "/api/courses/:id/enrollments",
    );
  });

  it("preserves query strings on the path", () => {
    const url = requestUrlFromIdempotencyRoute("GET /api/users?page=1");
    expect(url.pathname).toBe("/api/users");
    expect(url.search).toBe("?page=1");
  });

  it("accepts a bare path with no method prefix", () => {
    expect(requestUrlFromIdempotencyRoute("/api/admin/cron-jobs").href).toBe(
      "http://localhost/api/admin/cron-jobs",
    );
  });

  it("still produces a valid URL for unusual HTTP methods", () => {
    const url = requestUrlFromIdempotencyRoute("PROPFIND /api/dav");
    expect(url.href).toBe("http://localhost/api/dav");
  });

  it("throws on empty route", () => {
    expect(() => requestUrlFromIdempotencyRoute("")).toThrow(/must not be empty/);
    expect(() => requestUrlFromIdempotencyRoute("   ")).toThrow(/must not be empty/);
  });

  it("throws when there is no path component starting with /", () => {
    expect(() => requestUrlFromIdempotencyRoute("POST")).toThrow(/path starting with \//);
    expect(() => requestUrlFromIdempotencyRoute("POST api/users")).toThrow(
      /path starting with \//,
    );
  });

  it("rejects protocol-relative paths that would retarget the origin", () => {
    expect(() => requestUrlFromIdempotencyRoute("POST //evil.example/api")).toThrow(
      /path starting with \//,
    );
  });

  it("does not produce the pre-fix invalid URL shape", () => {
    // Regression: `http://localhost${"POST /api/users"}` → Invalid URL
    expect(() => new Request(`http://localhostPOST /api/users`)).toThrow();
    expect(() =>
      new Request(requestUrlFromIdempotencyRoute("POST /api/users"), { method: "POST" }),
    ).not.toThrow();
  });
});

describe("runIdempotentAdminMutation (#1110)", () => {
  const routes = [
    "POST /api/users",
    "POST /api/courses/:id/enrollments",
    "POST /api/admin/cron-jobs",
  ] as const;

  it.each(routes)("constructs a valid Request for %s and runs the mutation", async (route) => {
    prismaMock.idempotencyRecord.create.mockResolvedValue({});
    prismaMock.idempotencyRecord.update.mockResolvedValue({});

    const mutation = vi.fn().mockResolvedValue({ ok: true, route });
    const result = await runIdempotentAdminMutation(
      "admin-1",
      route,
      `key-${route}`,
      { sample: true },
      mutation,
    );

    expect(result).toEqual({ ok: true, route });
    expect(mutation).toHaveBeenCalledOnce();
    expect(prismaMock.idempotencyRecord.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          key: `key-${route}`,
          route,
          actorId: "admin-1",
          status: "PROCESSING",
        }),
      }),
    );
  });

  it("replays a cached COMPLETED response without re-running the mutation", async () => {
    prismaMock.idempotencyRecord.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const cached = { writeSucceeded: true, id: "u-cached" };
    // Hash must match bodyForIdempotencyHash({ email: "a@b.c" })
    const { hashRequestBody, bodyForIdempotencyHash } = await import(
      "~/lib/idempotency.server"
    );
    const requestHash = hashRequestBody(bodyForIdempotencyHash({ email: "a@b.c" }));
    prismaMock.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash,
      status: "COMPLETED",
      statusCode: 200,
      responseBody: cached,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const mutation = vi.fn().mockResolvedValue({ shouldNot: "run" });
    const result = await runIdempotentAdminMutation(
      "admin-1",
      "POST /api/users",
      "replay-key",
      { email: "a@b.c" },
      mutation,
    );

    expect(result).toEqual(cached);
    expect(mutation).not.toHaveBeenCalled();
  });

  it("only runs the mutation once when the second call replays", async () => {
    prismaMock.idempotencyRecord.create
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError("dup", {
          code: "P2002",
          clientVersion: "test",
        }),
      );
    prismaMock.idempotencyRecord.update.mockResolvedValue({});

    const mutation = vi.fn().mockResolvedValue({ id: "u1", writeSucceeded: true });
    const body = { name: "A", email: "a@test.com", role: "STUDENT" };

    const first = await runIdempotentAdminMutation(
      "admin-1",
      "POST /api/users",
      "once-key",
      body,
      mutation,
    );
    expect(first).toEqual({ id: "u1", writeSucceeded: true });
    expect(mutation).toHaveBeenCalledOnce();

    const { hashRequestBody, bodyForIdempotencyHash } = await import(
      "~/lib/idempotency.server"
    );
    prismaMock.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: hashRequestBody(bodyForIdempotencyHash(body)),
      status: "COMPLETED",
      statusCode: 200,
      responseBody: { id: "u1", writeSucceeded: true },
      expiresAt: new Date(Date.now() + 60_000),
    });

    const second = await runIdempotentAdminMutation(
      "admin-1",
      "POST /api/users",
      "once-key",
      body,
      mutation,
    );
    expect(second).toEqual({ id: "u1", writeSucceeded: true });
    expect(mutation).toHaveBeenCalledOnce();
  });

  it("does not run the mutation when a concurrent twin is still PROCESSING", async () => {
    prismaMock.idempotencyRecord.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("dup", {
        code: "P2002",
        clientVersion: "test",
      }),
    );
    const { hashRequestBody, bodyForIdempotencyHash } = await import(
      "~/lib/idempotency.server"
    );
    const body = { jobName: "cleanup" };
    prismaMock.idempotencyRecord.findUnique.mockResolvedValue({
      requestHash: hashRequestBody(bodyForIdempotencyHash(body)),
      status: "PROCESSING",
      statusCode: null,
      responseBody: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const mutation = vi.fn().mockResolvedValue({ shouldNot: "run" });
    // Wrapper surfaces the 409 envelope as JSON (same as REST), not a thrown error.
    const result = await runIdempotentAdminMutation(
      "admin-1",
      "POST /api/admin/cron-jobs",
      "concurrent-key",
      body,
      mutation,
    );
    expect(result).toMatchObject({ error: "IDEMPOTENCY_IN_PROGRESS" });
    expect(mutation).not.toHaveBeenCalled();
  });
});

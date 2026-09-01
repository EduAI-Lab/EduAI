/**
 * Covers the shared error hierarchy (`@eduai/types`) and Core's route-boundary
 * mapper (#1279).
 *
 * The hierarchy lives in packages/types, which has no test harness of its own;
 * it is exercised here because Core is its main TypeScript consumer.
 */
import { describe, expect, it, vi } from "vitest";

import {
  AppError,
  AuthError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
  isAppError,
  normalizeError,
} from "@eduai/types";

import type { ErrorEnvelope } from "@eduai/types";

import { errorResponse, withErrorResponse } from "~/lib/errors.server";
import { QueueUnavailableError } from "~/lib/queue/errors.server";

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logSystemError: vi.fn(async () => undefined),
}));

async function bodyOf(response: Response): Promise<ErrorEnvelope> {
  return JSON.parse(await response.text());
}

describe("AppError hierarchy", () => {
  it("gives each subclass its status and stable code", () => {
    expect(new ValidationError()).toMatchObject({ status: 422, code: "VALIDATION_ERROR" });
    expect(new AuthError()).toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    expect(new ForbiddenError()).toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(new NotFoundError()).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(new ConflictError()).toMatchObject({ status: 409, code: "CONFLICT" });
    expect(new ServiceUnavailableError()).toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("names each error after its own class, so logs identify it", () => {
    expect(new NotFoundError().name).toBe("NotFoundError");
    expect(new ConflictError().name).toBe("ConflictError");
  });

  it("exposes subclass messages but withholds a bare AppError's", () => {
    expect(normalizeError(new NotFoundError("Course not found")).message).toBe("Course not found");
    // Constructed directly, without opting in: the message is for logs only.
    expect(normalizeError(new AppError(500, "connection string leaked here")).message).toBe(
      "Internal server error",
    );
  });

  it("keeps the cause for logs without putting it on the wire", async () => {
    const cause = new Error("upstream detail");
    const error = new ServiceUnavailableError("Queue unavailable", { cause });

    expect(error.cause).toBe(cause);
    expect(await bodyOf(errorResponse(error))).toEqual({ error: "SERVICE_UNAVAILABLE" });
  });

  it("recognises an AppError structurally, across module realms", () => {
    // A second copy of the class (tracked dist/ plus workspace symlinks can put
    // two realms in one process) is not `instanceof` ours but must still map.
    const foreign = Object.assign(new Error("nope"), {
      status: 404,
      code: "NOT_FOUND",
      expose: true,
    });

    expect(isAppError(foreign)).toBe(true);
    expect(normalizeError(foreign)).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});

describe("normalizeError", () => {
  it("reports an unrecognised error as a generic 500", () => {
    expect(normalizeError(new Error("Prisma: column User.secret does not exist"))).toEqual({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
      exposed: false,
    });
  });

  it("handles thrown non-errors", () => {
    for (const value of ["a string", null, undefined, 42, { nope: true }]) {
      expect(normalizeError(value)).toMatchObject({ status: 500, code: "INTERNAL_ERROR" });
    }
  });

  it("maps Prisma unique-constraint violations to 409 without echoing Prisma's text", () => {
    const prismaError = Object.assign(new Error("Unique constraint failed on the fields"), {
      name: "PrismaClientKnownRequestError",
      code: "P2002",
      meta: { target: ["email"] },
    });

    const normalized = normalizeError(prismaError);
    expect(normalized).toMatchObject({
      status: 409,
      code: "CONFLICT",
      message: "Resource already exists",
    });
    // `meta.target` is the violated constraint's database column list. It must
    // never reach the client, or a 409 discloses internal schema identifiers.
    expect(JSON.stringify(normalized)).not.toContain("email");
  });

  it("maps Prisma connectivity codes to 503", () => {
    const unreachable = Object.assign(new Error("Can't reach database server"), {
      name: "PrismaClientKnownRequestError",
      code: "P1001",
    });

    expect(normalizeError(unreachable)).toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("maps a Prisma initialization failure to 503", () => {
    // A real `PrismaClientInitializationError` — the client could not connect at
    // startup. Unlike a known-request error it carries the connectivity code on
    // `errorCode` and has NO `code`, so the known-request guard misses it. Left
    // unhandled this returned 500/INTERNAL_ERROR even though the database being
    // unreachable is a 503.
    const initError = Object.assign(
      new Error("Can't reach database server at `db.internal:5432`"),
      { name: "PrismaClientInitializationError", errorCode: "P1001" },
    );

    expect(normalizeError(initError)).toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
    // The raw message embeds the host:port — it must not reach the client.
    const normalized = normalizeError(initError);
    expect(JSON.stringify(normalized)).not.toContain("db.internal");
  });

  it("maps a Prisma initialization failure with no errorCode to 503", () => {
    // Some initialization failures (bad DATABASE_URL, auth rejected) arrive with
    // no `errorCode` at all — still a dependency that could not be reached.
    const initError = Object.assign(new Error("Authentication failed against database"), {
      name: "PrismaClientInitializationError",
    });

    expect(normalizeError(initError)).toMatchObject({
      status: 503,
      code: "SERVICE_UNAVAILABLE",
    });
  });

  it("withholds the message for an unmapped Prisma code", () => {
    const other = Object.assign(new Error("internal prisma detail"), {
      name: "PrismaClientKnownRequestError",
      code: "P2037",
    });

    expect(normalizeError(other)).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  });

  it("turns a Zod error into 422 with per-field messages", () => {
    const zodError = Object.assign(new Error("invalid"), {
      name: "ZodError",
      issues: [
        { path: ["title"], message: "Required" },
        { path: ["nested", "count"], message: "Expected number" },
      ],
    });

    expect(normalizeError(zodError)).toEqual({
      status: 422,
      code: "VALIDATION_ERROR",
      message: "Validation failed",
      fields: { title: "Required", "nested.count": "Expected number" },
      exposed: true,
    });
  });

  it("honours a legacy err.status, keeping 4xx messages and withholding 5xx", () => {
    const legacy4xx = Object.assign(new Error("Course not found"), { status: 404 });
    const legacy5xx = Object.assign(new Error("socket path /var/run/db.sock"), { status: 500 });

    expect(normalizeError(legacy4xx)).toMatchObject({
      status: 404,
      code: "NOT_FOUND",
      message: "Course not found",
    });
    expect(normalizeError(legacy5xx)).toMatchObject({
      status: 500,
      message: "Internal server error",
    });
  });

  it("does not let a transport error's `code` reach the client", () => {
    // ECONNREFUSED and friends carry a string `code` but never a 4xx status,
    // so they must fall through to the generic 500.
    const transport = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:6379"), {
      code: "ECONNREFUSED",
    });

    expect(normalizeError(transport)).toMatchObject({
      status: 500,
      code: "INTERNAL_ERROR",
      message: "Internal server error",
    });
  });
});

describe("Core errorResponse", () => {
  it("keeps the existing envelope: `error` holds the CODE", async () => {
    const response = errorResponse(new NotFoundError("Course not found"));

    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await bodyOf(response)).toEqual({ error: "NOT_FOUND" });
  });

  it("includes per-field messages when the error carries them", async () => {
    const response = errorResponse(
      new ValidationError("Invalid", { fields: { email: "Required" } }),
    );

    expect(response.status).toBe(422);
    expect(await bodyOf(response)).toEqual({
      error: "VALIDATION_ERROR",
      fields: { email: "Required" },
    });
  });

  it("never puts an unrecognised error's message on the wire", async () => {
    const response = errorResponse(new Error("DATABASE_URL=postgres://user:pw@host/db"));

    expect(response.status).toBe(500);
    expect(await response.clone().text()).not.toContain("postgres://");
    expect(await bodyOf(response)).toEqual({ error: "INTERNAL_ERROR" });
  });
});

describe("QueueUnavailableError", () => {
  it("still satisfies the #1112 contract now that it extends AppError", async () => {
    const error = new QueueUnavailableError();

    expect(error).toBeInstanceOf(AppError);
    expect(error.status).toBe(503);
    expect(error.code).toBe("QUEUE_UNAVAILABLE");
    expect(error.name).toBe("QueueUnavailableError");
    // Routes must map this to 503, never 400.
    expect(errorResponse(error).status).toBe(503);
    expect(await bodyOf(errorResponse(error))).toEqual({ error: "QUEUE_UNAVAILABLE" });
  });
});

describe("withErrorResponse extra headers", () => {
  // #1560/#1621: /api/chat has to hand the client back the id of a chat it
  // already persisted, even when the turn then blows up — the boundary owns the
  // body, so the route contributes only the header.
  it("attaches the route's headers to the mapped error response", async () => {
    const response = (await withErrorResponse(
      async () => {
        throw new Error("boom");
      },
      { headers: () => ({ "X-Chat-Id": "chat-1" }) },
    )) as Response;

    expect(response.status).toBe(500);
    expect(response.headers.get("X-Chat-Id")).toBe("chat-1");
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(await bodyOf(response)).toEqual({ error: "INTERNAL_ERROR" });
  });

  it("omits a header whose value is undefined", async () => {
    const response = (await withErrorResponse(
      async () => {
        throw new Error("boom");
      },
      { headers: () => ({ "X-Chat-Id": undefined }) },
    )) as Response;

    expect(response.headers.has("X-Chat-Id")).toBe(false);
  });

  it("does not let a throwing headers thunk mask the original error", async () => {
    const response = (await withErrorResponse(
      async () => {
        throw new NotFoundError("Course not found");
      },
      {
        headers: () => {
          throw new Error("thunk exploded");
        },
      },
    )) as Response;

    expect(response.status).toBe(404);
    expect(await bodyOf(response)).toEqual({ error: "NOT_FOUND" });
  });

  it("leaves a thrown Response untouched", async () => {
    const redirect = new Response(null, { status: 302, headers: { Location: "/login" } });

    await expect(
      withErrorResponse(
        async () => {
          throw redirect;
        },
        { headers: () => ({ "X-Chat-Id": "chat-1" }) },
      ),
    ).rejects.toBe(redirect);
  });
});

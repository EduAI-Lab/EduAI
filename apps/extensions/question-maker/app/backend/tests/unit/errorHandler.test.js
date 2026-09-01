/**
 * Unit tests for errorHandler middleware.
 * Tests what each error type SHOULD produce — not what the code happens to return.
 * A failing test here means the handler is misclassifying an error.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Prisma } from "@eduai/question-maker-prisma-client";
import { notFound, errorHandler } from "../../src/middleware/errorHandler.js";

const { logger } = vi.hoisted(() => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../../src/utils/logger.js", () => ({ logger }));

const { forgetUserRow } = vi.hoisted(() => ({ forgetUserRow: vi.fn() }));
vi.mock("../../src/services/authService.js", () => ({ forgetUserRow }));

function prismaError(code, meta) {
  return new Prisma.PrismaClientKnownRequestError("Prisma error", {
    code,
    clientVersion: "6.19.3",
    meta,
  });
}

function makeReq(url = "/test-path") {
  return { originalUrl: url, method: "GET", url, path: url, query: {} };
}

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (code) => {
    res._status = code;
    return res;
  };
  res.json = (body) => {
    res._body = body;
    return res;
  };
  return res;
}

describe("notFound middleware", () => {
  it("calls next() with a 404 error that includes the request URL", () => {
    const req = makeReq("/some/unknown/route");
    let capturedError;
    const next = (err) => {
      capturedError = err;
    };

    notFound(req, makeRes(), next);

    expect(capturedError).toBeInstanceOf(Error);
    expect(capturedError.status).toBe(404);
    expect(capturedError.message).toContain("/some/unknown/route");
  });

  it("does not send a response — that is the error handler's job", () => {
    const req = makeReq("/foo");
    const res = makeRes();
    notFound(req, res, () => {});
    expect(res._status).toBeNull();
    expect(res._body).toBeNull();
  });
});

describe("errorHandler middleware", () => {
  let originalEnv;
  beforeEach(() => {
    originalEnv = process.env.NODE_ENV;
    logger.error.mockReset();
    logger.warn.mockReset();
  });
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  it("returns 500 for a generic error with no specific type", () => {
    const res = makeRes();
    errorHandler(new Error("something went wrong"), makeReq(), res, () => {});
    expect(res._status).toBe(500);
    expect(res._body.success).toBe(false);
    expect(res._body.error).toBeTruthy();
  });

  it("returns 500 when the error has no message — falls back to a generic message", () => {
    const res = makeRes();
    const err = new Error();
    err.message = "";
    errorHandler(err, makeReq(), res, () => {});
    expect(res._status).toBe(500);
    expect(res._body.error).toBeTruthy();
  });

  it("uses the error's own .status when set (e.g. a manually thrown 403)", () => {
    const res = makeRes();
    const err = Object.assign(new Error("Forbidden"), { status: 403 });
    errorHandler(err, makeReq(), res, () => {});
    expect(res._status).toBe(403);
  });

  it('maps a Prisma P2025 (record not found) error to 404 with "Resource not found"', () => {
    const res = makeRes();
    const err = prismaError("P2025");
    errorHandler(err, makeReq(), res, () => {});
    expect(res._status).toBe(404);
    expect(res._body.error).toBe("Resource not found");
  });

  it("maps a Prisma P2002 (unique constraint) error to 409 naming the conflicting fields", () => {
    const res = makeRes();
    const err = prismaError("P2002", { target: ["email"] });
    errorHandler(err, makeReq(), res, () => {});
    expect(res._status).toBe(409);
    expect(res._body.error).toBe("A record with this email already exists");
  });

  it("maps a Prisma P2003 (foreign key constraint) error to 400", () => {
    const res = makeRes();
    const err = prismaError("P2003");
    errorHandler(err, makeReq(), res, () => {});
    expect(res._status).toBe(400);
    expect(res._body.error).toBe("Referenced resource does not exist");
  });

  // #1388: a cache hit skips the upsert, so a local user row wiped out of band
  // (seed/restore) only surfaces here, as an FK violation on the first
  // dependent write. Evicting the memo is what bounds that to a single failed
  // request instead of the whole TTL window.
  it("evicts the caller's memoized user row on P2003 so the next request re-upserts", () => {
    forgetUserRow.mockClear();
    const res = makeRes();
    const req = { ...makeReq(), user: { id: "u1" } };

    errorHandler(prismaError("P2003"), req, res, () => {});

    expect(res._status).toBe(400);
    expect(forgetUserRow).toHaveBeenCalledWith("u1");
  });

  it("does not evict anything on P2003 when the request has no authenticated user", () => {
    forgetUserRow.mockClear();
    const res = makeRes();

    errorHandler(prismaError("P2003"), makeReq(), res, () => {});

    expect(res._status).toBe(400);
    expect(forgetUserRow).toHaveBeenCalledWith(undefined);
  });

  it("leaves the memoized user row alone for FK-unrelated Prisma errors", () => {
    forgetUserRow.mockClear();
    const req = { ...makeReq(), user: { id: "u1" } };

    errorHandler(prismaError("P2025"), req, makeRes(), () => {});
    errorHandler(prismaError("P2002", { target: ["email"] }), req, makeRes(), () => {});

    expect(forgetUserRow).not.toHaveBeenCalled();
  });

  it('maps a JsonWebTokenError to 401 with "Invalid token"', () => {
    const res = makeRes();
    const err = Object.assign(new Error("jwt malformed"), { name: "JsonWebTokenError" });
    errorHandler(err, makeReq(), res, () => {});
    expect(res._status).toBe(401);
    expect(res._body.error).toBe("Invalid token");
  });

  it('maps a TokenExpiredError to 401 with "Token expired"', () => {
    const res = makeRes();
    const err = Object.assign(new Error("jwt expired"), { name: "TokenExpiredError" });
    errorHandler(err, makeReq(), res, () => {});
    expect(res._status).toBe(401);
    expect(res._body.error).toBe("Token expired");
  });

  it("never includes a stack trace, even in development mode", () => {
    process.env.NODE_ENV = "development";
    const secretCanary = "DB_STACK_SECRET_CANARY";
    const err = new Error(secretCanary);
    err.stack = `Error: ${secretCanary}\n    at Test.fn`;
    const res = makeRes();
    errorHandler(err, makeReq(), res, () => {});
    expect(res._body.stack).toBeUndefined();
    expect(JSON.stringify(res._body)).not.toContain(secretCanary);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secretCanary);
  });

  it("does NOT include the stack trace in production mode", () => {
    process.env.NODE_ENV = "production";
    const err = new Error("silent failure");
    err.stack = "Error: silent failure\n    at line 1";
    const res = makeRes();
    errorHandler(err, makeReq(), res, () => {});
    expect(res._body.stack).toBeUndefined();
  });

  it("always includes success: false in the response body", () => {
    const res = makeRes();
    errorHandler(new Error("anything"), makeReq(), res, () => {});
    expect(res._body.success).toBe(false);
  });

  it("returns a stable generic error and safe metadata for an internal canary", () => {
    const secretCanary = "PRISMA_PROVIDER_SECRET_CANARY";
    const err = new Error(secretCanary);
    err.stack = `Error: ${secretCanary}`;
    const res = makeRes();

    errorHandler(err, makeReq(), res, () => {});

    expect(res._status).toBe(500);
    expect(res._body.error).toBe("Request failed");
    expect(JSON.stringify(res._body)).not.toContain(secretCanary);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secretCanary);
  });

  it("does not trust raw Axios/provider response bodies at the global boundary", () => {
    const secretCanary = "AXIOS_RESPONSE_SECRET_CANARY";
    const err = Object.assign(new Error(secretCanary), {
      response: {
        status: 502,
        data: { error: secretCanary, stack: secretCanary },
      },
      code: "ERR_BAD_RESPONSE",
    });
    const res = makeRes();

    errorHandler(err, makeReq(), res, () => {});

    expect(res._status).toBe(500);
    expect(res._body.error).toBe("Request failed");
    expect(JSON.stringify(res._body)).not.toContain(secretCanary);
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(secretCanary);
  });
});

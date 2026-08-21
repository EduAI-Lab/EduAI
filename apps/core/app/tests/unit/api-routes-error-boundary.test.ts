/**
 * Proves the Core route-boundary mapper (#1279) is on the production request
 * path, not just unit-tested in isolation.
 *
 * These resource routes already answer every anticipated case with
 * `apiError(...)`. What they did not have was a boundary for the unanticipated
 * ones — a Prisma failure mid-transaction, a dropped connection — which
 * escaped the loader/action and were rendered by React Router instead of by
 * this API's envelope. Each test throws such an error from the handler the
 * route delegates to and asserts the route answers `{ error: "CODE" }` with
 * nothing internal in it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const handleUsersApiRequest = vi.fn();
const handleAiModelsApiRequest = vi.fn();
const handleAiProvidersApiRequest = vi.fn();
const requireInviter = vi.fn();
const listInvitations = vi.fn();
const logSystemError = vi.fn();

vi.mock("~/lib/api/users-api.server", () => ({ handleUsersApiRequest }));
vi.mock("~/lib/api/ai-models-api.server", () => ({ handleAiModelsApiRequest }));
vi.mock("~/lib/api/ai-providers-api.server", () => ({ handleAiProvidersApiRequest }));
vi.mock("~/lib/auth/guards.server", () => ({ requireInviter }));
vi.mock("~/lib/invitations/service.server", () => ({
  listInvitations,
  createInvitation: vi.fn(),
  resendInvitation: vi.fn(),
  revokeInvitation: vi.fn(),
}));
// The boundary must log unanticipated failures — once it maps them into the
// envelope, React Router's server `onError` hook never sees them. Keep
// `fireAndForget` a real passthrough so the `logSystemError` call still fires.
vi.mock("~/lib/logging.server", () => ({
  logSystemError,
  fireAndForget: (p: Promise<unknown>) => void Promise.resolve(p).catch(() => {}),
}));

function request(url = "https://core.test/api/x"): Request {
  return new Request(url);
}

async function bodyOf(response: Response): Promise<unknown> {
  return JSON.parse(await response.text());
}

/** What a real Prisma connectivity failure looks like when it escapes a handler. */
function unreachableDatabase(): Error {
  return Object.assign(new Error("Can't reach database server at `db.internal:5432`"), {
    name: "PrismaClientKnownRequestError",
    code: "P1001",
  });
}

/**
 * A real `PrismaClientInitializationError` — the client failed to connect at
 * startup. Distinct shape from a known-request error: the code is on `errorCode`
 * and there is no `code`. The boundary must still answer 503, not 500.
 */
function unreachableAtStartup(): Error {
  return Object.assign(new Error("Can't reach database server at `db.internal:5432`"), {
    name: "PrismaClientInitializationError",
    errorCode: "P1001",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Core API routes are wrapped by the #1279 mapper", () => {
  it("maps an unhandled failure in /api/users to the error envelope", async () => {
    handleUsersApiRequest.mockRejectedValue(unreachableDatabase());
    const { loader } = await import("~/routes/api/users.$");

    const response = (await loader({
      request: request(),
      params: {},
      context: {},
    } as never)) as Response;

    expect(response.status).toBe(503);
    expect(await bodyOf(response)).toEqual({ error: "SERVICE_UNAVAILABLE" });
    // The failure is logged with route/request context before being mapped —
    // otherwise a DB outage vanishes from operational logs.
    expect(logSystemError).toHaveBeenCalledTimes(1);
    expect(logSystemError).toHaveBeenCalledWith(
      expect.objectContaining({
        source: "API",
        code: "SERVICE_UNAVAILABLE",
        statusCode: 503,
        routePath: "/api/x",
        httpMethod: "GET",
      }),
    );
  });

  it("maps a Prisma initialization failure (P1001 on errorCode) to 503, not 500", async () => {
    handleUsersApiRequest.mockRejectedValue(unreachableAtStartup());
    const { loader } = await import("~/routes/api/users.$");

    const response = (await loader({
      request: request(),
      params: {},
      context: {},
    } as never)) as Response;

    expect(response.status).toBe(503);
    expect(await bodyOf(response)).toEqual({ error: "SERVICE_UNAVAILABLE" });
  });

  it("maps an unhandled failure in /api/ai-models to the error envelope", async () => {
    handleAiModelsApiRequest.mockRejectedValue(
      new Error("DATABASE_URL=postgres://core:pw@db.internal/eduai"),
    );
    const { action } = await import("~/routes/api/ai-models.$");

    const response = (await action({
      request: request(),
      params: {},
      context: {},
    } as never)) as Response;

    expect(response.status).toBe(500);
    // The envelope carries the code only, so no internal text can ride along.
    const raw = await response.text();
    expect(JSON.parse(raw)).toEqual({ error: "INTERNAL_ERROR" });
    expect(raw).not.toContain("db.internal");
  });

  it("maps an unhandled failure in /api/ai-providers to the error envelope", async () => {
    handleAiProvidersApiRequest.mockRejectedValue(unreachableDatabase());
    const { action } = await import("~/routes/api/ai-providers.$");

    const response = (await action({
      request: request(),
      params: {},
      context: {},
    } as never)) as Response;

    expect(response.status).toBe(503);
    expect(await bodyOf(response)).toEqual({ error: "SERVICE_UNAVAILABLE" });
  });

  it("maps an unhandled failure in /api/invitations to the error envelope", async () => {
    requireInviter.mockResolvedValue({
      response: null,
      session: { user: { id: "u1", role: "ADMIN", name: "A" } },
    });
    listInvitations.mockRejectedValue(unreachableDatabase());
    const { loader } = await import("~/routes/api/invitations");

    const response = (await loader({
      request: request("https://core.test/api/invitations"),
      params: {},
      context: {},
    } as never)) as Response;

    expect(response.status).toBe(503);
    expect(await bodyOf(response)).toEqual({ error: "SERVICE_UNAVAILABLE" });
  });

  it("still lets a thrown Response (redirect, 404) through untouched", async () => {
    const redirect = new Response(null, { status: 302, headers: { Location: "/login" } });
    handleUsersApiRequest.mockRejectedValue(redirect);
    const { loader } = await import("~/routes/api/users.$");

    await expect(loader({ request: request(), params: {}, context: {} } as never)).rejects.toBe(
      redirect,
    );
    // A deliberate control-flow throw is not a failure — it must not be logged.
    expect(logSystemError).not.toHaveBeenCalled();
  });
});

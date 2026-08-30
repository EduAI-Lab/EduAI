// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getChatDailyLimitSettings: vi.fn(),
  setChatDailyLimitSettings: vi.fn(),
  fireAndForget: vi.fn(),
  logAuditAction: vi.fn(),
  // A real (not mocked) Error subclass so `error instanceof
  // ChatDailyLimitSettingsUnavailableError` in the route works against the
  // exact same class reference the test throws (#1557 review).
  ChatDailyLimitSettingsUnavailableError: class extends Error {
    constructor(message = "Local chatbot daily cap settings are unavailable") {
      super(message);
      this.name = "ChatDailyLimitSettingsUnavailableError";
    }
  },
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("~/lib/chat-daily-limits.server", () => ({
  getChatDailyLimitSettings: mocks.getChatDailyLimitSettings,
  setChatDailyLimitSettings: mocks.setChatDailyLimitSettings,
  ChatDailyLimitSettingsUnavailableError: mocks.ChatDailyLimitSettingsUnavailableError,
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: mocks.fireAndForget,
  logAuditAction: mocks.logAuditAction,
}));

vi.mock("~/lib/request-context.server", () => ({
  getActorContext: vi.fn(() => ({ actorId: "admin-1" })),
  getRequestContext: vi.fn(() => ({ routePath: "/api/admin/chat-daily-limits" })),
}));

import type { RouteRequestBody } from "../helpers/route-fixtures";
import { action, loader } from "~/routes/api/admin.chat-daily-limits";

const settings = { studentLimit: 50, instructorLimit: 200 };

function makeArgs(method = "GET", body?: RouteRequestBody) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return {
    request: new Request("http://localhost/api/admin/chat-daily-limits", init),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({
    response: null,
    session: { user: { id: "admin-1", role: "ADMIN" } },
  });
  mocks.getChatDailyLimitSettings.mockResolvedValue(settings);
  mocks.setChatDailyLimitSettings.mockResolvedValue(settings);
  mocks.logAuditAction.mockResolvedValue(undefined);
});

describe("admin chat daily limits API", () => {
  it("returns the persisted settings to an administrator", async () => {
    const res = await loader(makeArgs());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ settings });
  });

  // #1557 review: a cold cache + Postgres unreachable makes
  // getChatDailyLimitSettings throw, which /api/chat already maps to a 503 —
  // this loader previously let it propagate as an unhandled loader error
  // instead of the same documented outage response.
  it("maps a cold-cache settings outage to the documented 503, not an unhandled error", async () => {
    mocks.getChatDailyLimitSettings.mockRejectedValue(
      new mocks.ChatDailyLimitSettingsUnavailableError(),
    );

    const res = await loader(makeArgs());

    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toMatchObject({
      error: "Daily message limits could not be loaded. Please try again shortly.",
    });
  });

  it("re-throws an unrelated loader error instead of treating it as the settings outage", async () => {
    mocks.getChatDailyLimitSettings.mockRejectedValue(new Error("boom"));

    await expect(loader(makeArgs())).rejects.toThrow("boom");
  });

  it("forwards the administrator guard response", async () => {
    mocks.requireAdmin.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
      }),
      session: null,
    });

    const res = await loader(makeArgs());
    expect(res.status).toBe(403);
    expect(mocks.getChatDailyLimitSettings).not.toHaveBeenCalled();
  });

  it("rejects a non-admin PATCH", async () => {
    mocks.requireAdmin.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Forbidden: Admins only" }), {
        status: 403,
      }),
      session: null,
    });

    const res = await action(makeArgs("PATCH", settings));
    expect(res.status).toBe(403);
    expect(mocks.setChatDailyLimitSettings).not.toHaveBeenCalled();
  });

  it("persists a valid settings update", async () => {
    const next = { studentLimit: 40, instructorLimit: 180 };
    mocks.setChatDailyLimitSettings.mockResolvedValue(next);
    const res = await action(makeArgs("PATCH", next));

    expect(res.status).toBe(200);
    expect(mocks.setChatDailyLimitSettings).toHaveBeenCalledWith(next, "admin-1");
    expect(mocks.fireAndForget).toHaveBeenCalledOnce();
    await expect(res.json()).resolves.toEqual({ settings: next });
  });

  it("rejects unsupported methods and malformed input", async () => {
    expect((await action(makeArgs("POST", {}))).status).toBe(405);
    expect(
      (await action(makeArgs("PATCH", { studentLimit: -1, instructorLimit: 200 }))).status,
    ).toBe(400);
    expect(mocks.setChatDailyLimitSettings).not.toHaveBeenCalled();
  });
});

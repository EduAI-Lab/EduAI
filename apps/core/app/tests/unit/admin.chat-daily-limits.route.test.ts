// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getChatDailyLimitSettings: vi.fn(),
  setChatDailyLimitSettings: vi.fn(),
  fireAndForget: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("~/lib/chat-daily-limits.server", () => ({
  getChatDailyLimitSettings: mocks.getChatDailyLimitSettings,
  setChatDailyLimitSettings: mocks.setChatDailyLimitSettings,
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: mocks.fireAndForget,
  logAuditAction: mocks.logAuditAction,
}));

vi.mock("~/lib/request-context.server", () => ({
  getActorContext: vi.fn(() => ({ actorId: "admin-1" })),
  getRequestContext: vi.fn(() => ({ routePath: "/api/admin/chat-daily-limits" })),
}));

import { action, loader } from "~/routes/api/admin.chat-daily-limits";

const settings = { studentLimit: 50, instructorLimit: 200 };

function makeArgs(method = "GET", body?: unknown) {
  return {
    request: new Request("http://localhost/api/admin/chat-daily-limits", {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
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

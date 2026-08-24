// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getBedrockOverflowSettings: vi.fn(),
  setBedrockOverflowSettings: vi.fn(),
  fireAndForget: vi.fn(),
  logAuditAction: vi.fn(),
  isBedrockTokenConfigured: vi.fn(),
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("~/lib/ai/routing/bedrock/bedrock-settings.server", () => ({
  getBedrockOverflowSettings: mocks.getBedrockOverflowSettings,
  setBedrockOverflowSettings: mocks.setBedrockOverflowSettings,
}));

vi.mock("~/lib/ai/routing/bedrock/overflow.server", () => ({
  isBedrockTokenConfigured: mocks.isBedrockTokenConfigured,
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: mocks.fireAndForget,
  logAuditAction: mocks.logAuditAction,
}));

vi.mock("~/lib/request-context.server", () => ({
  getActorContext: vi.fn(() => ({ actorId: "admin-1" })),
  getRequestContext: vi.fn(() => ({ routePath: "/api/admin/bedrock-settings" })),
}));

import { action, loader } from "~/routes/api/admin.bedrock-settings";
import { defaultBedrockOverflowSettings } from "~/lib/ai/routing/bedrock/bedrock-settings";

const settings = {
  ...defaultBedrockOverflowSettings(),
  enabled: true,
  resourceLimit: 4,
};

function makeArgs(method = "GET", body?: unknown) {
  // A GET carries no body at all, so neither the body nor its content type is
  // set unless the caller passed one.
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return {
    request: new Request("http://localhost/api/admin/bedrock-settings", init),
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
  mocks.getBedrockOverflowSettings.mockResolvedValue(settings);
  mocks.setBedrockOverflowSettings.mockResolvedValue(settings);
  mocks.isBedrockTokenConfigured.mockReturnValue(true);
  mocks.logAuditAction.mockResolvedValue(undefined);
});

describe("admin bedrock settings API", () => {
  it("returns the persisted settings to an administrator", async () => {
    const res = await loader(makeArgs());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      settings,
      tokenConfigured: true,
    });
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
    expect(mocks.getBedrockOverflowSettings).not.toHaveBeenCalled();
  });

  it("persists a valid settings update and returns fresh settings", async () => {
    const res = await action(makeArgs("PATCH", settings));

    expect(res.status).toBe(200);
    expect(mocks.setBedrockOverflowSettings).toHaveBeenCalledWith(settings, "admin-1");
    expect(mocks.fireAndForget).toHaveBeenCalledOnce();
    await expect(res.json()).resolves.toEqual({
      settings,
      tokenConfigured: true,
    });
  });

  it("rejects unsupported methods and malformed input", async () => {
    expect((await action(makeArgs("POST", {}))).status).toBe(405);
    expect((await action(makeArgs("PATCH", { enabled: true, resourceLimit: -1 }))).status).toBe(
      400,
    );
    expect(mocks.setBedrockOverflowSettings).not.toHaveBeenCalled();
  });
});

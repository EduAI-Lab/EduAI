// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  getRoutingModelSettings: vi.fn(),
  setRoutingModelSetting: vi.fn(),
  fireAndForget: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock("~/lib/auth/guards.server", () => ({
  requireAdmin: mocks.requireAdmin,
}));

vi.mock("~/lib/routing-model-settings.server", () => ({
  getRoutingModelSettings: mocks.getRoutingModelSettings,
  setRoutingModelSetting: mocks.setRoutingModelSetting,
}));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: mocks.fireAndForget,
  logAuditAction: mocks.logAuditAction,
}));

vi.mock("~/lib/request-context.server", () => ({
  getActorContext: vi.fn(() => ({ actorId: "admin-1" })),
  getRequestContext: vi.fn(() => ({ routePath: "/api/routing-model-settings" })),
}));

import {
  action,
  loader,
} from "~/routes/api/routing-model-settings";

const settings = {
  autoLlmEnabled: true,
  autoRulesEnabled: false,
};

function makeArgs(method = "GET", body?: unknown) {
  return {
    request: new Request("http://localhost/api/routing-model-settings", {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    params: {},
    context: {} as never,
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAdmin.mockResolvedValue({
    response: null,
    session: { user: { id: "admin-1", role: "ADMIN" } },
  });
  mocks.getRoutingModelSettings.mockResolvedValue(settings);
  mocks.setRoutingModelSetting.mockResolvedValue(undefined);
  mocks.logAuditAction.mockResolvedValue(undefined);
});

describe("routing model settings API", () => {
  it("returns the persisted settings and definitions to an administrator", async () => {
    const res = await loader(makeArgs());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      settings,
      definitions: expect.arrayContaining([
        expect.objectContaining({ key: "autoLlmEnabled", name: "Auto" }),
        expect.objectContaining({
          key: "autoRulesEnabled",
          name: "Auto (rules)",
        }),
      ]),
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
    expect(mocks.getRoutingModelSettings).not.toHaveBeenCalled();
  });

  it("persists a valid routing switch update and returns fresh settings", async () => {
    const res = await action(
      makeArgs("PATCH", { key: "autoRulesEnabled", value: true }),
    );

    expect(res.status).toBe(200);
    expect(mocks.setRoutingModelSetting).toHaveBeenCalledWith(
      "autoRulesEnabled",
      true,
      "admin-1",
    );
    expect(mocks.fireAndForget).toHaveBeenCalledOnce();
    await expect(res.json()).resolves.toEqual({ settings });
  });

  it("rejects unsupported methods, malformed input, and unknown keys", async () => {
    expect((await action(makeArgs("POST", {}))).status).toBe(405);
    expect(
      (
        await action(
          makeArgs("PATCH", { key: "autoLlmEnabled", value: "yes" }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await action(
          makeArgs("PATCH", { key: "unknownRoutingMode", value: true }),
        )
      ).status,
    ).toBe(404);
    expect(mocks.setRoutingModelSetting).not.toHaveBeenCalled();
  });
});

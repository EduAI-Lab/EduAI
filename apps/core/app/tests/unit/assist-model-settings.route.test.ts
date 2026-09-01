// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  resolveActiveChatModel: vi.fn(),
  getAssistModelId: vi.fn(),
  setAssistModelId: vi.fn(),
  fireAndForget: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock("~/lib/auth/guards.server", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("~/lib/ai/providers.server", () => ({
  resolveActiveChatModel: mocks.resolveActiveChatModel,
}));
vi.mock("~/lib/assist-model-settings.server", () => ({
  getAssistModelId: mocks.getAssistModelId,
  setAssistModelId: mocks.setAssistModelId,
}));
vi.mock("~/lib/logging.server", () => ({
  fireAndForget: mocks.fireAndForget,
  logAuditAction: mocks.logAuditAction,
}));
vi.mock("~/lib/request-context.server", () => ({
  getActorContext: vi.fn(() => ({ actorId: "admin-1" })),
  getRequestContext: vi.fn(() => ({ routePath: "/api/assist-model-settings" })),
}));

import { action, loader } from "~/routes/api/assist-model-settings";
import type { RouteRequestBody } from "../helpers/route-fixtures";

function makeArgs(method = "GET", body?: RouteRequestBody) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return {
    request: new Request("http://localhost/api/assist-model-settings", init),
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
  mocks.getAssistModelId.mockResolvedValue(null);
  mocks.resolveActiveChatModel.mockResolvedValue({ name: "GPT-4o" });
  mocks.setAssistModelId.mockResolvedValue(undefined);
});

describe("Assist model settings API", () => {
  it("returns the configured model to an administrator", async () => {
    mocks.getAssistModelId.mockResolvedValue("openai:gpt-4o");

    const response = await loader(makeArgs());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ modelId: "openai:gpt-4o" });
  });

  it("forwards the administrator guard response", async () => {
    mocks.requireAdmin.mockResolvedValue({
      response: new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
      session: null,
    });

    const response = await loader(makeArgs());

    expect(response.status).toBe(403);
    expect(mocks.getAssistModelId).not.toHaveBeenCalled();
  });

  it("saves a valid active chat model and emits an audit event", async () => {
    const response = await action(makeArgs("PUT", { modelId: "openai:gpt-4o" }));

    expect(response.status).toBe(200);
    expect(mocks.resolveActiveChatModel).toHaveBeenCalledWith("openai:gpt-4o");
    expect(mocks.setAssistModelId).toHaveBeenCalledWith("openai:gpt-4o", "admin-1");
    expect(mocks.fireAndForget).toHaveBeenCalledOnce();
  });

  it("accepts null to restore the selected chat model fallback", async () => {
    const response = await action(makeArgs("PATCH", { modelId: null }));

    expect(response.status).toBe(200);
    expect(mocks.resolveActiveChatModel).not.toHaveBeenCalled();
    expect(mocks.setAssistModelId).toHaveBeenCalledWith(null, "admin-1");
  });

  it("rejects malformed or inactive model ids", async () => {
    expect((await action(makeArgs("PATCH", { modelId: "" }))).status).toBe(400);

    mocks.resolveActiveChatModel.mockResolvedValue(null);
    expect((await action(makeArgs("PATCH", { modelId: "inactive:model" }))).status).toBe(404);
    expect(mocks.setAssistModelId).not.toHaveBeenCalled();
  });
});

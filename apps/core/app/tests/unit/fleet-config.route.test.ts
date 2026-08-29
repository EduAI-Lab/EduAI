// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  loadFleetConfigFile: vi.fn(),
  saveFleetConfigFile: vi.fn(),
  getAllFleetServers: vi.fn(),
  resetFleetRegistryCache: vi.fn(),
  getServerHealth: vi.fn(),
  resetFleetHealthCache: vi.fn(),
  fireAndForget: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock("~/lib/auth/guards.server", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("~/lib/ai/routing/fleet/config-file", () => ({
  FleetConfigError: class FleetConfigError extends Error {},
  loadFleetConfigFile: mocks.loadFleetConfigFile,
  saveFleetConfigFile: mocks.saveFleetConfigFile,
}));
vi.mock("~/lib/ai/routing/fleet/registry", () => ({
  getAllFleetServers: mocks.getAllFleetServers,
  resetFleetRegistryCache: mocks.resetFleetRegistryCache,
}));
vi.mock("~/lib/ai/routing/fleet/health", () => ({
  getServerHealth: mocks.getServerHealth,
  resetFleetHealthCache: mocks.resetFleetHealthCache,
}));
vi.mock("~/lib/logging.server", () => ({
  fireAndForget: mocks.fireAndForget,
  logAuditAction: mocks.logAuditAction,
}));
vi.mock("~/lib/request-context.server", () => ({
  getActorContext: vi.fn(() => ({ actorId: "admin-1" })),
  getRequestContext: vi.fn(() => ({ routePath: "/api/fleet-config" })),
}));

import { action, loader } from "~/routes/api/fleet-config";
import type { RouteRequestBody } from "../helpers/route-fixtures";

const servers = [
  {
    id: "cmps01",
    baseUrl: "http://cmps01.ok.ubc.ca:8001",
    jobTypes: ["interactive"],
    models: [],
  },
];

function makeArgs(method = "GET", body?: RouteRequestBody) {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body);
  }
  return {
    request: new Request("http://localhost/api/fleet-config", init),
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
  mocks.saveFleetConfigFile.mockReturnValue({ servers });
  mocks.getServerHealth.mockResolvedValue({
    ok: true,
    modelIds: ["qwen2.5-7b-instruct", "qwen2.5-32b-instruct"],
  });
});

describe("fleet config API", () => {
  it("tests every saved server and returns the fetched model ids", async () => {
    const response = await action(makeArgs("PUT", { servers }));

    expect(response.status).toBe(200);
    expect(mocks.resetFleetRegistryCache).toHaveBeenCalledOnce();
    expect(mocks.resetFleetHealthCache).toHaveBeenCalledOnce();
    expect(mocks.getServerHealth).toHaveBeenCalledWith(servers[0].baseUrl);
    await expect(response.json()).resolves.toMatchObject({
      configured: true,
      connectionTest: {
        servers: [
          {
            serverId: "cmps01",
            connected: true,
            models: ["qwen2.5-7b-instruct", "qwen2.5-32b-instruct"],
          },
        ],
      },
    });
  });

  it("returns a useful per-server failure when a connection test fails", async () => {
    mocks.getServerHealth.mockResolvedValue({
      ok: false,
      modelIds: null,
      error: "HTTP 503",
    });

    const response = await action(makeArgs("PATCH", { servers }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      connectionTest: {
        servers: [{ serverId: "cmps01", connected: false, models: [], error: "HTTP 503" }],
      },
    });
  });

  it("does not test or save when the administrator guard rejects the request", async () => {
    mocks.requireAdmin.mockResolvedValue({
      response: new Response("Forbidden", { status: 403 }),
      session: null,
    });

    const response = await action(makeArgs("PUT", { servers }));

    expect(response.status).toBe(403);
    expect(mocks.saveFleetConfigFile).not.toHaveBeenCalled();
    expect(mocks.getServerHealth).not.toHaveBeenCalled();
  });

  it("includes no connection test on a read-only config load", async () => {
    mocks.loadFleetConfigFile.mockReturnValue({ servers });

    const response = await loader(makeArgs());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      configured: true,
      source: "file",
      servers,
    });
    expect(mocks.getServerHealth).not.toHaveBeenCalled();
  });
});

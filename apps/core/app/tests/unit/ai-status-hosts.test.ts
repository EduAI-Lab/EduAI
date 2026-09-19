// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const fleetRoutingEnabledMock = vi.hoisted(() => vi.fn());
const getAllFleetServersMock = vi.hoisted(() => vi.fn());
const resolveUbcBaseUrlsMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/ai/routing/fleet/registry", () => ({
  fleetRoutingEnabled: fleetRoutingEnabledMock,
  getAllFleetServers: getAllFleetServersMock,
  serverIdFromUrl: (url: string) => new URL(url).hostname.split(".")[0],
}));

vi.mock("~/lib/ai/service-status.server", () => ({
  resolveUbcBaseUrls: resolveUbcBaseUrlsMock,
}));

const { resolveStatusHosts } = await import("~/lib/ai/status/hosts.server");

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveStatusHosts", () => {
  it("returns fleet servers when fleet routing is enabled", () => {
    fleetRoutingEnabledMock.mockReturnValue(true);
    getAllFleetServersMock.mockReturnValue([
      { id: "cmps01", baseUrl: "http://cmps01.ok.ubc.ca:8001", models: ["qwen3.5-2b-instruct"] },
    ]);

    expect(resolveStatusHosts()).toEqual([
      {
        serverId: "cmps01",
        baseUrl: "http://cmps01.ok.ubc.ca:8001",
        configuredModels: ["qwen3.5-2b-instruct"],
      },
    ]);
  });

  it("falls back to the legacy single-URL vars when there is no fleet", () => {
    fleetRoutingEnabledMock.mockReturnValue(false);
    resolveUbcBaseUrlsMock.mockReturnValue({
      vllm: "http://localhost:8000",
      ollama: "http://localhost:11434",
    });

    const hosts = resolveStatusHosts();

    expect(hosts.map((h) => h.serverId)).toEqual(["localhost", "localhost"]);
    expect(hosts.map((h) => h.baseUrl)).toEqual([
      "http://localhost:8000",
      "http://localhost:11434",
    ]);
  });

  it("returns an empty list when nothing is configured", () => {
    fleetRoutingEnabledMock.mockReturnValue(false);
    resolveUbcBaseUrlsMock.mockReturnValue({});

    expect(resolveStatusHosts()).toEqual([]);
  });
});

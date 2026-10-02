// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

const resolveStatusHostsMock = vi.hoisted(() => vi.fn());
const getServerHealthMock = vi.hoisted(() => vi.fn());
const probeVllmLoadMock = vi.hoisted(() => vi.fn());
const createManyMock = vi.hoisted(() => vi.fn());
const deleteManyMock = vi.hoisted(() => vi.fn());
const findManyMock = vi.hoisted(() => vi.fn());
const findScheduleOverrideMock = vi.hoisted(() => vi.fn());

vi.mock("~/lib/ai/status/hosts.server", () => ({ resolveStatusHosts: resolveStatusHostsMock }));
vi.mock("~/lib/ai/routing/fleet/health", () => ({ getServerHealth: getServerHealthMock }));
vi.mock("~/lib/ai/ollama-url.server", () => ({
  ollamaTagsUrl: (base: string) => `${base}/api/tags`,
}));
vi.mock("~/lib/ai/service-status/vllm-metrics.server", () => ({
  probeVllmLoad: probeVllmLoadMock,
}));
vi.mock("~/lib/prisma.server", () => ({
  default: {
    aiServiceSample: {
      createMany: createManyMock,
      deleteMany: deleteManyMock,
      findMany: findManyMock,
    },
    cronJobScheduleOverride: { findUnique: findScheduleOverrideMock },
  },
}));

const { runAiStatusProbe, resetStatusProbeCaches } = await import("~/lib/ai/status-probe.server");

beforeEach(() => {
  vi.clearAllMocks();
  // The down-host model list is memoised across ticks on purpose; without this
  // one test's cached answer would be served to the next.
  resetStatusProbeCaches();
  createManyMock.mockResolvedValue({ count: 0 });
  deleteManyMock.mockResolvedValue({ count: 0 });
  findManyMock.mockResolvedValue([]);
  findScheduleOverrideMock.mockResolvedValue(null);
  probeVllmLoadMock.mockResolvedValue({ waiting: 0, cacheUsage: 0.1 });
});

describe("runAiStatusProbe", () => {
  it("writes one OPERATIONAL row per advertised model on a reachable host", async () => {
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps01", baseUrl: "http://cmps01:8001", configuredModels: [] },
    ]);
    getServerHealthMock.mockResolvedValue({
      ok: true,
      modelIds: ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"],
      checkedAt: Date.now(),
    });

    await runAiStatusProbe();

    const rows = createManyMock.mock.calls[0][0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      serverId: "cmps01",
      modelId: "qwen3.5-2b-instruct",
      state: "OPERATIONAL",
      reachable: true,
      waiting: 0,
      cacheUsage: 0.1,
      intervalMinutes: 15,
    });
  });

  it("writes OUTAGE rows for the models last observed on an unreachable host", async () => {
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps02", baseUrl: "http://cmps02:8001", configuredModels: ["from-config"] },
    ]);
    getServerHealthMock.mockResolvedValue({
      ok: false,
      modelIds: null,
      checkedAt: Date.now(),
      error: "connect ETIMEDOUT",
    });
    // History wins over the (globally applied, often wrong) configured list.
    findManyMock.mockResolvedValue([{ serverId: "cmps02", modelId: "qwen3.8-27b-instruct" }]);

    await runAiStatusProbe();

    const rows = createManyMock.mock.calls[0][0].data;
    expect(rows).toEqual([
      expect.objectContaining({
        serverId: "cmps02",
        modelId: "qwen3.8-27b-instruct",
        state: "OUTAGE",
        reachable: false,
      }),
    ]);
  });

  it("falls back to configured models when a host has no history", async () => {
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps03", baseUrl: "http://cmps03:8001", configuredModels: ["seed-model"] },
    ]);
    getServerHealthMock.mockResolvedValue({ ok: false, modelIds: null, checkedAt: 0, error: "x" });
    findManyMock.mockResolvedValue([]);

    await runAiStatusProbe();

    expect(createManyMock.mock.calls[0][0].data).toEqual([
      expect.objectContaining({ modelId: "seed-model", state: "OUTAGE" }),
    ]);
  });

  it("records a configuration fault as UNKNOWN, not OUTAGE", async () => {
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps01", baseUrl: "http://cmps01:8001", configuredModels: ["m"] },
    ]);
    getServerHealthMock.mockResolvedValue({
      ok: false,
      modelIds: null,
      checkedAt: 0,
      error: "VLLM_API_KEY not configured",
    });
    findManyMock.mockResolvedValue([]);

    await runAiStatusProbe();

    expect(createManyMock.mock.calls[0][0].data[0]).toMatchObject({ state: "UNKNOWN" });
  });

  it("records a malformed /v1/models response as OUTAGE, not UNKNOWN", async () => {
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps01", baseUrl: "http://cmps01:8001", configuredModels: ["m"] },
    ]);
    getServerHealthMock.mockResolvedValue({
      ok: false,
      modelIds: null,
      checkedAt: 0,
      error: "invalid /v1/models response",
    });
    findManyMock.mockResolvedValue([]);

    await runAiStatusProbe();

    expect(createManyMock.mock.calls[0][0].data[0]).toMatchObject({ state: "OUTAGE" });
  });

  it("does not mix the unknown-model sentinel with real model ids on a later outage", async () => {
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps01", baseUrl: "http://cmps01:8001", configuredModels: [] },
    ]);
    getServerHealthMock.mockResolvedValue({
      ok: false,
      modelIds: null,
      checkedAt: 0,
      error: "connect ETIMEDOUT",
    });
    findManyMock.mockResolvedValue([
      { serverId: "cmps01", modelId: "__unknown__" },
      { serverId: "cmps01", modelId: "qwen3.5-9b-instruct" },
    ]);

    await runAiStatusProbe();

    const rows = createManyMock.mock.calls[0][0].data;
    expect(rows).toEqual([
      expect.objectContaining({ modelId: "qwen3.5-9b-instruct", state: "OUTAGE" }),
    ]);
  });

  it("writes waiting and cacheUsage as a pair, both null when load is unknown", async () => {
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps01", baseUrl: "http://cmps01:8001", configuredModels: [] },
    ]);
    getServerHealthMock.mockResolvedValue({ ok: true, modelIds: ["m"], checkedAt: 0 });
    probeVllmLoadMock.mockResolvedValue(null);

    await runAiStatusProbe();

    expect(createManyMock.mock.calls[0][0].data[0]).toMatchObject({
      waiting: null,
      cacheUsage: null,
    });
  });

  it("prunes beyond the retention window and reports what it did", async () => {
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps01", baseUrl: "http://cmps01:8001", configuredModels: [] },
    ]);
    getServerHealthMock.mockResolvedValue({ ok: true, modelIds: ["m"], checkedAt: 0 });
    deleteManyMock.mockResolvedValue({ count: 12 });

    const result = await runAiStatusProbe();

    expect(deleteManyMock).toHaveBeenCalledWith({
      where: { observedAt: { lt: expect.any(Date) } },
    });
    expect(result.message).toBe("1 hosts, 1 models: 1 up, 0 outage, 0 unknown; pruned 12");
  });

  // `intervalMinutes` exists so the READER never depends on env; stamping
  // `pollMinutes()` made the WRITER depend on it, so an admin retuning the job
  // left every row claiming the old cadence and the chip flapped to `unknown`
  // for 45 minutes of every hour.
  it("stamps the admin's schedule override, not the env default", async () => {
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps01", baseUrl: "http://cmps01:8001", configuredModels: [] },
    ]);
    getServerHealthMock.mockResolvedValue({ ok: true, modelIds: ["m"], checkedAt: 0 });
    findScheduleOverrideMock.mockResolvedValue({ schedule: "0 */1 * * *" });

    await runAiStatusProbe();

    expect(findScheduleOverrideMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { jobName: "ai-status-probe" } }),
    );
    expect(createManyMock.mock.calls[0][0].data[0].intervalMinutes).toBe(60);
  });

  it("stamps a sub-hour override too", async () => {
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps01", baseUrl: "http://cmps01:8001", configuredModels: [] },
    ]);
    getServerHealthMock.mockResolvedValue({ ok: true, modelIds: ["m"], checkedAt: 0 });
    findScheduleOverrideMock.mockResolvedValue({ schedule: "*/5 * * * *" });

    await runAiStatusProbe();

    expect(createManyMock.mock.calls[0][0].data[0].intervalMinutes).toBe(5);
  });

  it("falls back to the env default for a schedule that is not a fixed period", async () => {
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps01", baseUrl: "http://cmps01:8001", configuredModels: [] },
    ]);
    getServerHealthMock.mockResolvedValue({ ok: true, modelIds: ["m"], checkedAt: 0 });
    findScheduleOverrideMock.mockResolvedValue({ schedule: "0 9,17 * * 1-5" });

    await runAiStatusProbe();

    expect(createManyMock.mock.calls[0][0].data[0].intervalMinutes).toBe(15);
  });

  it("still samples when the override table cannot be read", async () => {
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps01", baseUrl: "http://cmps01:8001", configuredModels: [] },
    ]);
    getServerHealthMock.mockResolvedValue({ ok: true, modelIds: ["m"], checkedAt: 0 });
    findScheduleOverrideMock.mockRejectedValue(new Error("relation does not exist"));

    await runAiStatusProbe();

    expect(createManyMock.mock.calls[0][0].data[0].intervalMinutes).toBe(15);
  });

  it("records a reachable host that advertises no models instead of letting it vanish", async () => {
    // Writing no rows dropped the host from the fleet entirely, so the chip
    // read green over the survivors — the aggregate degrades on `up < total`
    // and this host counted in neither.
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps01", baseUrl: "http://cmps01:8001", configuredModels: [] },
    ]);
    getServerHealthMock.mockResolvedValue({ ok: true, modelIds: [], checkedAt: 0 });

    await runAiStatusProbe();

    const rows = createManyMock.mock.calls[0][0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      serverId: "cmps01",
      state: "OUTAGE",
      reachable: false,
      detail: "host reachable but advertising no models",
    });
  });

  it("writes nothing and says so when no UBC inference is configured", async () => {
    resolveStatusHostsMock.mockReturnValue([]);

    const result = await runAiStatusProbe();

    expect(createManyMock).not.toHaveBeenCalled();
    expect(result.message).toBe("No UBC-hosted inference configured; nothing sampled");
  });

  it("does not let one host's unexpected throw abort the batch", async () => {
    resolveStatusHostsMock.mockReturnValue([
      { serverId: "cmps01", baseUrl: "http://cmps01:8001", configuredModels: [] },
      { serverId: "cmps02", baseUrl: "http://cmps02:8001", configuredModels: ["m2"] },
    ]);
    getServerHealthMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({ ok: true, modelIds: ["m2"], checkedAt: 0 });
    findManyMock.mockResolvedValue([]);

    await runAiStatusProbe();

    const rows = createManyMock.mock.calls[0][0].data;
    // cmps01 recorded UNKNOWN (we could not tell), cmps02 recorded normally.
    expect(rows).toHaveLength(2);
    expect(rows.find((r: { serverId: string }) => r.serverId === "cmps01")).toMatchObject({
      state: "UNKNOWN",
    });
  });
});

/** One legacy-mode Ollama host, the shape `resolveStatusHosts` returns for it. */
function ollamaHost() {
  return [
    {
      serverId: "localhost",
      baseUrl: "http://localhost:11434",
      kind: "ollama",
      configuredModels: [],
    },
  ];
}

describe("runAiStatusProbe — Ollama hosts", () => {
  it("probes an Ollama host at /api/tags rather than through the vLLM check", async () => {
    resolveStatusHostsMock.mockReturnValue(ollamaHost());
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [{ name: "llama3:8b" }, { name: "qwen2.5:7b" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await runAiStatusProbe();

    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:11434/api/tags");
    // The vLLM check is what demands VLLM_API_KEY; an Ollama host must not go
    // near it, or an Ollama-only deployment records UNKNOWN forever.
    expect(getServerHealthMock).not.toHaveBeenCalled();

    const rows = createManyMock.mock.calls[0][0].data;
    expect(rows).toEqual([
      expect.objectContaining({ modelId: "llama3:8b", state: "OPERATIONAL", reachable: true }),
      expect.objectContaining({ modelId: "qwen2.5:7b", state: "OPERATIONAL", reachable: true }),
    ]);
  });

  it("records an Ollama host's load as unknown — it serves no vLLM metrics", async () => {
    resolveStatusHostsMock.mockReturnValue(ollamaHost());
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({ ok: true, json: async () => ({ models: [{ name: "llama3:8b" }] }) }),
    );

    await runAiStatusProbe();

    expect(probeVllmLoadMock).not.toHaveBeenCalled();
    expect(createManyMock.mock.calls[0][0].data[0]).toMatchObject({
      waiting: null,
      cacheUsage: null,
    });
  });

  it("writes OUTAGE, not UNKNOWN, for an unreachable Ollama host", async () => {
    resolveStatusHostsMock.mockReturnValue(ollamaHost());
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));

    await runAiStatusProbe();

    expect(createManyMock.mock.calls[0][0].data[0]).toMatchObject({
      state: "OUTAGE",
      reachable: false,
      detail: "connect ECONNREFUSED",
    });
  });

  it("treats an unreadable /api/tags body as unreachable", async () => {
    resolveStatusHostsMock.mockReturnValue(ollamaHost());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));

    await runAiStatusProbe();

    expect(createManyMock.mock.calls[0][0].data[0]).toMatchObject({
      state: "OUTAGE",
      detail: "invalid /api/tags response",
    });
  });
});

describe("runAiStatusProbe — down-host model lookup", () => {
  const downHost = [
    { serverId: "cmps01", baseUrl: "http://cmps01:8001", kind: "vllm", configuredModels: [] },
  ];

  beforeEach(() => {
    getServerHealthMock.mockResolvedValue({
      ok: false,
      modelIds: null,
      checkedAt: 0,
      error: "connect ETIMEDOUT",
    });
    findManyMock.mockResolvedValue([{ serverId: "cmps01", modelId: "qwen3.5-9b-instruct" }]);
  });

  it("asks the database once while a host stays down", async () => {
    resolveStatusHostsMock.mockReturnValue(downHost);

    await runAiStatusProbe();
    await runAiStatusProbe();
    await runAiStatusProbe();

    // The answer cannot change while the host is down, so the repeat ticks
    // must not re-run the query.
    expect(findManyMock).toHaveBeenCalledTimes(1);
    expect(createManyMock.mock.calls[2][0].data).toEqual([
      expect.objectContaining({ modelId: "qwen3.5-9b-instruct", state: "OUTAGE" }),
    ]);
  });

  it("re-reads once the host comes back, so a changed model list is picked up", async () => {
    resolveStatusHostsMock.mockReturnValue(downHost);

    await runAiStatusProbe();

    getServerHealthMock.mockResolvedValue({ ok: true, modelIds: ["new-model"], checkedAt: 0 });
    await runAiStatusProbe();

    getServerHealthMock.mockResolvedValue({
      ok: false,
      modelIds: null,
      checkedAt: 0,
      error: "connect ETIMEDOUT",
    });
    findManyMock.mockResolvedValue([{ serverId: "cmps01", modelId: "new-model" }]);
    await runAiStatusProbe();

    expect(findManyMock).toHaveBeenCalledTimes(2);
    expect(createManyMock.mock.calls[2][0].data).toEqual([
      expect.objectContaining({ modelId: "new-model", state: "OUTAGE" }),
    ]);
  });
});

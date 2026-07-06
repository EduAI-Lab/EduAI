import { afterEach, describe, expect, it, vi } from "vitest";
import { measureTurnEnergy } from "~/lib/ai/energy/measurement.server";

describe("measureTurnEnergy sidecar override", () => {
  const originalSidecar = process.env.ENERGY_SIDECAR_URL;

  afterEach(() => {
    if (originalSidecar === undefined) delete process.env.ENERGY_SIDECAR_URL;
    else process.env.ENERGY_SIDECAR_URL = originalSidecar;
    vi.restoreAllMocks();
  });

  it("uses fleet sidecar URL override instead of global ENERGY_SIDECAR_URL", async () => {
    process.env.ENERGY_SIDECAR_URL = "http://cmps01.ok.ubc.ca:8001/energy";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          energyJoules: 42,
          carbonGramsCO2: 1.2,
          source: "NVML_GPU",
        }),
        { status: 200 },
      ),
    );

    const result = await measureTurnEnergy(
      {
        registryModelId: "vllm:qwen2.5-7b-instruct",
        promptTokens: 10,
        completionTokens: 20,
        durationMs: 500,
        estEnergyJoulesPerToken: null,
        averageCarbonGramsPerToken: null,
      },
      { sidecarBaseUrl: "http://cmps02.ok.ubc.ca:8001/energy" },
    );

    expect(result.energyJoules).toBe(42);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://cmps02.ok.ubc.ca:8001/energy/measure",
    );
  });
});

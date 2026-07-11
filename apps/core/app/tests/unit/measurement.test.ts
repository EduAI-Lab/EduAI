import { afterEach, describe, expect, it, vi } from "vitest";
import {
  measureTurnEnergy,
  startSidecarMeasurement,
  stopSidecarMeasurement,
} from "~/lib/ai/energy/measurement.server";

const baseInput = {
  registryModelId: "vllm:qwen2.5-7b-instruct",
  promptTokens: 10,
  completionTokens: 20,
  durationMs: 500,
  estEnergyJoulesPerToken: 0.5,
  averageCarbonGramsPerToken: 0.01,
};

describe("measureTurnEnergy", () => {
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

    const result = await measureTurnEnergy(baseInput, {
      sidecarTag: "turn-1",
      sidecarBaseUrl: "http://cmps02.ok.ubc.ca:8001/energy",
    });

    expect(result.energyJoules).toBe(42);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://cmps02.ok.ubc.ca:8001/energy/measure-stop",
    );
  });

  it("does not call legacy /measure when no session tag is provided", async () => {
    process.env.ENERGY_SIDECAR_URL = "http://cmps01.ok.ubc.ca:8001/energy";
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await measureTurnEnergy(baseInput);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      energyJoules: 15,
      carbonGramsCO2: 0.3,
      energySource: "ESTIMATED_FROM_TOKENS",
    });
  });

  it("falls back to token estimate when measure-stop returns null joules", async () => {
    process.env.ENERGY_SIDECAR_URL = "http://cmps01.ok.ubc.ca:8001/energy";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ energyJoules: null }), { status: 200 }),
    );

    const result = await measureTurnEnergy(baseInput, {
      sidecarTag: "turn-2",
      sidecarBaseUrl: "http://cmps01.ok.ubc.ca:8001/energy",
    });

    expect(result).toEqual({
      energyJoules: 15,
      carbonGramsCO2: 0.3,
      energySource: "ESTIMATED_FROM_TOKENS",
    });
  });
});

describe("startSidecarMeasurement", () => {
  const originalSidecar = process.env.ENERGY_SIDECAR_URL;

  afterEach(() => {
    if (originalSidecar === undefined) delete process.env.ENERGY_SIDECAR_URL;
    else process.env.ENERGY_SIDECAR_URL = originalSidecar;
    vi.restoreAllMocks();
  });

  it("returns null when sidecar fetch fails instead of throwing", async () => {
    process.env.ENERGY_SIDECAR_URL = "http://cmps01.ok.ubc.ca:8001/energy";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(startSidecarMeasurement("turn-1")).resolves.toBeNull();
  });
});

describe("stopSidecarMeasurement", () => {
  const originalSidecar = process.env.ENERGY_SIDECAR_URL;

  afterEach(() => {
    if (originalSidecar === undefined) delete process.env.ENERGY_SIDECAR_URL;
    else process.env.ENERGY_SIDECAR_URL = originalSidecar;
    vi.restoreAllMocks();
  });

  it("returns null when sidecar fetch fails instead of throwing", async () => {
    process.env.ENERGY_SIDECAR_URL = "http://cmps01.ok.ubc.ca:8001/energy";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(stopSidecarMeasurement("turn-1")).resolves.toBeNull();
  });
});

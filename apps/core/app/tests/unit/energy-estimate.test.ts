import { describe, expect, it } from "vitest";
import { estimateTurnEnergy } from "~/lib/ai/energy/estimate.server";

const baseInput = {
  promptTokens: 10,
  completionTokens: 20,
  estEnergyJoulesPerToken: 0.5,
  averageCarbonGramsPerToken: 0.01,
};

describe("estimateTurnEnergy", () => {
  it("estimates energy and carbon from split token counts", () => {
    expect(estimateTurnEnergy(baseInput)).toEqual({
      energyJoules: 15,
      carbonGramsCO2: 0.3,
      energySource: "ESTIMATED_FROM_TOKENS",
    });
  });

  it("uses totalTokens when split usage is unavailable", () => {
    expect(
      estimateTurnEnergy({
        ...baseInput,
        promptTokens: null,
        completionTokens: null,
        totalTokens: 40,
      }),
    ).toEqual({
      energyJoules: 20,
      carbonGramsCO2: 0.4,
      energySource: "ESTIMATED_FROM_TOKENS",
    });
  });

  it("prefers complete split usage over a conflicting total", () => {
    expect(estimateTurnEnergy({ ...baseInput, totalTokens: 999 }).energyJoules).toBe(
      15,
    );
  });

  it("returns null energy and carbon when the model has no energy constant", () => {
    expect(
      estimateTurnEnergy({
        ...baseInput,
        estEnergyJoulesPerToken: null,
      }),
    ).toEqual({
      energyJoules: null,
      carbonGramsCO2: null,
      energySource: null,
    });
  });

  it("does not report carbon when energy can be estimated but carbon cannot", () => {
    expect(
      estimateTurnEnergy({
        ...baseInput,
        averageCarbonGramsPerToken: null,
      }),
    ).toEqual({
      energyJoules: 15,
      carbonGramsCO2: null,
      energySource: "ESTIMATED_FROM_TOKENS",
    });
  });
});

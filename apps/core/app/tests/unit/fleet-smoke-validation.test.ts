import { describe, expect, it } from "vitest";
import {
  missingExpectedFleetModels,
  hostScopedMissingModels,
} from "../../../scripts/lib/fleet-smoke-validation.mjs";

describe("fleet smoke model coverage", () => {
  it("fails when healthy hosts collectively omit an expected default", () => {
    expect(
      missingExpectedFleetModels(
        [
          { ok: true, modelIds: ["qwen2.5-32b-instruct"] },
          { ok: false, modelIds: ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"] },
        ],
        ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"],
      ),
    ).toEqual(["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"]);
  });

  it("accepts defaults distributed across healthy hosts", () => {
    expect(
      missingExpectedFleetModels(
        [
          { ok: true, modelIds: ["qwen3.5-2b-instruct"] },
          { ok: true, modelIds: ["qwen3.5-9b-instruct", "qwen2.5-32b-instruct"] },
        ],
        ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"],
      ),
    ).toEqual([]);
  });
});

describe("fleet smoke host-scoped model coverage (#1529 review)", () => {
  const declaredHostModels = {
    cmps01: ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"],
    cmps02: ["qwen2.5-32b-instruct"],
  };

  it("fails when the host declared to serve the Assist model is down, even if other hosts are healthy", () => {
    // Reviewer repro: cmps01 + cmps03 healthy, cmps02 (the only host declared
    // to serve the retained Assist model) is down. The union of healthy
    // hosts never advertises qwen2.5-32b-instruct at all here, but this test
    // pins the specific "host-down" reason a host-aware check must report.
    const results = [
      { id: "cmps01", ok: true, modelIds: ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"] },
      { id: "cmps02", ok: false, modelIds: [] },
      { id: "cmps03", ok: true, modelIds: [] },
    ];
    const violations = hostScopedMissingModels(
      results,
      ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct", "qwen2.5-32b-instruct"],
      declaredHostModels,
    );
    expect(violations).toEqual([
      { modelId: "qwen2.5-32b-instruct", hostId: "cmps02", reason: "host-down" },
    ]);
  });

  it("fails when the declared host is healthy but does not actually advertise the model", () => {
    const results = [
      { id: "cmps01", ok: true, modelIds: ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"] },
      { id: "cmps02", ok: true, modelIds: ["some-other-model"] },
    ];
    const violations = hostScopedMissingModels(
      results,
      ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct", "qwen2.5-32b-instruct"],
      declaredHostModels,
    );
    expect(violations).toEqual([
      { modelId: "qwen2.5-32b-instruct", hostId: "cmps02", reason: "not-advertised" },
    ]);
  });

  it("passes when every declared host is healthy and advertises its declared model", () => {
    const results = [
      { id: "cmps01", ok: true, modelIds: ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"] },
      { id: "cmps02", ok: true, modelIds: ["qwen2.5-32b-instruct"] },
    ];
    expect(
      hostScopedMissingModels(
        results,
        ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct", "qwen2.5-32b-instruct"],
        declaredHostModels,
      ),
    ).toEqual([]);
  });

  it("falls back to the union check for a model with no declared host (legacy env-var mode)", () => {
    const results = [{ id: "cmps01", ok: true, modelIds: ["qwen3.5-2b-instruct"] }];
    expect(
      hostScopedMissingModels(results, ["qwen3.5-2b-instruct", "qwen3.5-9b-instruct"], {}),
    ).toEqual([{ modelId: "qwen3.5-9b-instruct", hostId: null, reason: "missing-everywhere" }]);
  });
});

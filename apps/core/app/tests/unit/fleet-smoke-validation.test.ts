import { describe, expect, it } from "vitest";
import { missingExpectedFleetModels } from "../../../scripts/lib/fleet-smoke-validation.mjs";

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

import { describe, it, expect } from "vitest";
import {
  parseCarbonPolicyMode,
  resolveCarbonPolicyMode,
  tieBreakForTier,
} from "~/lib/ai/routing/carbon-policy";

describe("carbon-policy", () => {
  it("parses greener and quality modes", () => {
    expect(parseCarbonPolicyMode("greener")).toBe("greener");
    expect(parseCarbonPolicyMode("quality")).toBe("quality");
    expect(parseCarbonPolicyMode("invalid")).toBe("balanced");
  });

  it("course override wins over global", () => {
    expect(
      resolveCarbonPolicyMode({
        globalMode: "balanced",
        courseCode: "COSC 315",
        byCourse: { "COSC 315": "greener" },
      }),
    ).toBe("greener");
  });

  it("balanced uses carbon for tier 2+", () => {
    expect(tieBreakForTier(1, "balanced")).toBe("energy");
    expect(tieBreakForTier(2, "balanced")).toBe("carbon");
  });
});

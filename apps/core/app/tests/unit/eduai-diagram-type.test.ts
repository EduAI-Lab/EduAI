// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildEduaiDiagramFence,
  resolveEduaiDiagramTypeId,
} from "~/lib/ai/eduai-diagram-type";

describe("resolveEduaiDiagramTypeId", () => {
  it("defaults to process-flow", () => {
    expect(resolveEduaiDiagramTypeId({})).toBe("process-flow");
    expect(
      resolveEduaiDiagramTypeId({
        userText: "draw a diagram of photosynthesis",
      }),
    ).toBe("process-flow");
  });

  it("routes specialized topics", () => {
    expect(
      resolveEduaiDiagramTypeId({
        userText: "animate gradient descent for me",
      }),
    ).toBe("gradient-descent");
    expect(
      resolveEduaiDiagramTypeId({
        userText: "show the hierarchy of this taxonomy",
      }),
    ).toBe("hierarchy");
    expect(
      resolveEduaiDiagramTypeId({
        userText: "compare supervised versus unsupervised",
      }),
    ).toBe("compare");
  });

  it("honors explicit type ids and aliases", () => {
    expect(resolveEduaiDiagramTypeId({ explicitTypeId: "gd" })).toBe(
      "gradient-descent",
    );
    expect(resolveEduaiDiagramTypeId({ explicitTypeId: "tree" })).toBe(
      "hierarchy",
    );
    expect(resolveEduaiDiagramTypeId({ explicitTypeId: "steps" })).toBe(
      "process-flow",
    );
  });

  it("builds a legacy type-only fence", () => {
    expect(buildEduaiDiagramFence("mystery")).toContain("process-flow");
    expect(buildEduaiDiagramFence("gradient-descent")).toBe(
      ["```eduai-diagram", "gradient-descent", "```"].join("\n"),
    );
  });
});

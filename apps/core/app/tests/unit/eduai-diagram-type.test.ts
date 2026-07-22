// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  matchExplicitDiagramTypeId,
  resolveEduaiDiagramTypeId,
  hasEduaiDiagramFence,
} from "~/lib/ai/eduai-diagram-type";
import { buildEduaiDiagramFence } from "~/lib/ai/eduai-diagram-payload";

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
});

describe("matchExplicitDiagramTypeId", () => {
  it("returns null for bare stage labels", () => {
    expect(matchExplicitDiagramTypeId("Start")).toBeNull();
    expect(matchExplicitDiagramTypeId("Introduce")).toBeNull();
  });

  it("matches canonical ids and aliases", () => {
    expect(matchExplicitDiagramTypeId("gradient-descent")).toBe(
      "gradient-descent",
    );
    expect(matchExplicitDiagramTypeId("gd")).toBe("gradient-descent");
  });
});

describe("hasEduaiDiagramFence", () => {
  it("detects catalog fences", () => {
    expect(hasEduaiDiagramFence("```eduai-diagram\ngd\n```")).toBe(true);
    expect(hasEduaiDiagramFence("```text\nx\n```")).toBe(false);
  });
});

describe("buildEduaiDiagramFence (payload)", () => {
  it("emits labeled default stages even for bare type ids", () => {
    const fence = buildEduaiDiagramFence({ typeId: "gradient-descent" });
    expect(fence).toContain("gradient-descent");
    expect(fence).toContain("Start point:");
    expect(fence).toContain("Step downhill:");
  });
});

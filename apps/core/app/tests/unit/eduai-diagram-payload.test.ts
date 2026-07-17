// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  buildEduaiDiagramFence,
  extractStagesFromDraft,
  parseEduaiDiagramBody,
} from "~/lib/ai/eduai-diagram-payload";

describe("parseEduaiDiagramBody", () => {
  it("parses type-only legacy fences with default stages", () => {
    const payload = parseEduaiDiagramBody("process-flow");
    expect(payload.typeId).toBe("process-flow");
    expect(payload.stages.length).toBeGreaterThanOrEqual(3);
    expect(payload.stages[0]?.label).toBe("Start");
  });

  it("parses titled labeled stages", () => {
    const payload = parseEduaiDiagramBody(`process-flow
title: How a bill becomes law
Introduce bill: Member files the proposal
Committee review: Experts study and amend
Floor vote: Full chamber decides
Become law: President signs`);
    expect(payload.typeId).toBe("process-flow");
    expect(payload.title).toBe("How a bill becomes law");
    expect(payload.stages.map((s) => s.label)).toEqual([
      "Introduce bill",
      "Committee review",
      "Floor vote",
      "Become law",
    ]);
    expect(payload.stages[0]?.detail).toContain("Member files");
  });

  it("parses compare and hierarchy", () => {
    expect(
      parseEduaiDiagramBody(`compare
title: Learning styles
Supervised: Labeled examples
Unsupervised: Find structure`).stages.map((s) => s.label),
    ).toEqual(["Supervised", "Unsupervised"]);

    expect(
      parseEduaiDiagramBody(`hierarchy
title: Neuron
Neuron: Whole cell
Dendrites: Receive signals
Axon: Sends signals
Synapse: Connects cells`).stages[0]?.label,
    ).toBe("Neuron");
  });
});

describe("extractStagesFromDraft", () => {
  it("pulls numbered Step ladder items", () => {
    const draft = `**Top summary**
- Overview

### Step ladder
1. Introduce bill: File the proposal
2. Committee review: Study and amend
3. Floor vote: Chamber decides
4. Become law: Sign or wait

**Next?** More?`;
    const stages = extractStagesFromDraft(draft);
    expect(stages.map((s) => s.label)).toEqual([
      "Introduce bill",
      "Committee review",
      "Floor vote",
      "Become law",
    ]);
  });

  it("falls back to Top summary bullets", () => {
    const draft = `**Top summary**
- **Light reactions** capture sunlight
- **Calvin cycle** builds sugar
- **Oxygen** is released

**Next?** More?`;
    const stages = extractStagesFromDraft(draft);
    expect(stages[0]?.label).toBe("Light reactions");
    expect(stages.length).toBeGreaterThanOrEqual(3);
  });
});

describe("buildEduaiDiagramFence", () => {
  it("emits labeled stages from draft bullets", () => {
    const fence = buildEduaiDiagramFence({
      typeId: "process-flow",
      userText: "draw how a bill becomes law",
      draftText: `**Top summary**
- **Introduce bill** — file it
- **Committee** — review it
- **Vote** — decide
- **Law** — sign it

**Next?** More?`,
    });
    expect(fence).toContain("process-flow");
    expect(fence).toContain("title:");
    expect(fence).toContain("Introduce bill:");
    expect(fence).toContain("```");
  });

  it("emits labeled stages for gradient-descent like other catalog types", () => {
    const fence = buildEduaiDiagramFence({
      typeId: "gradient-descent",
      userText: "explain gradient descent",
    });
    expect(fence).toContain("gradient-descent");
    expect(fence).toContain("title:");
    expect(fence).toContain("Start point:");
    expect(fence).toContain("Step downhill:");
  });
});

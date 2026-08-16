// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  hasEduaiDiagramBlock,
  splitEduaiDiagrams,
} from "~/components/chat/diagrams/split-eduai-diagrams";
import {
  normalizeEduaiDiagramTypeId,
  resolveEduaiDiagramComponent,
} from "~/components/chat/diagrams/eduai-diagram";
import { transformAssistiveDisplayCopy } from "~/components/chat/assistive-display-transform";

describe("splitEduaiDiagrams", () => {
  it("splits markdown around eduai-diagram fences", () => {
    const input = `**Top summary**
- A

\`\`\`eduai-diagram
gradient-descent
\`\`\`

**Next?** More?`;

    const parts = splitEduaiDiagrams(input);
    expect(
      parts.some(
        (p) => p.kind === "diagram" && p.payload.typeId === "gradient-descent",
      ),
    ).toBe(true);
    expect(
      parts.filter((p) => p.kind === "markdown").length,
    ).toBeGreaterThanOrEqual(2);
    const joinedMd = parts
      .filter(
        (p): p is { kind: "markdown"; text: string } => p.kind === "markdown",
      )
      .map((p) => p.text)
      .join("");
    expect(joinedMd).toContain("**Top summary**");
    expect(joinedMd).toContain("**Next?**");
    expect(joinedMd).not.toContain("```eduai-diagram");
  });

  it("parses multi-line labeled process-flow payloads", () => {
    const input = `\`\`\`eduai-diagram
process-flow
title: Bill to law
Introduce: File bill
Committee: Review
Vote: Decide
Law: Sign
\`\`\``;
    const parts = splitEduaiDiagrams(input);
    const diagram = parts.find((p) => p.kind === "diagram");
    expect(diagram?.kind).toBe("diagram");
    if (diagram?.kind !== "diagram") return;
    expect(diagram.payload.title).toBe("Bill to law");
    expect(diagram.payload.stages.map((s) => s.label)).toEqual([
      "Introduce",
      "Committee",
      "Vote",
      "Law",
    ]);
  });

  it("returns a single markdown segment when no fence", () => {
    const parts = splitEduaiDiagrams("Just prose.");
    expect(parts).toEqual([{ kind: "markdown", text: "Just prose." }]);
  });

  it("keeps the transformed Assist diagram renderable and leaves Continue after it", () => {
    const stored = `**Top summary**
- **Light reactions** capture sunlight
- **Calvin cycle** builds sugar

### Step ladder
Start here: follow the light (~5 min)
1. Light reactions — why it matters: energy enters the process
2. Calvin cycle — why it matters: sugar is built

\`\`\`eduai-diagram
process-flow
title: Photosynthesis
Light reactions: Capture sunlight
Calvin cycle: Build sugar
\`\`\`

**Next?** Ready to try one yourself?`;

    const displayed = transformAssistiveDisplayCopy(stored);
    const parts = splitEduaiDiagrams(displayed);
    const diagram = parts.find((part) => part.kind === "diagram");

    expect(displayed.startsWith("### Step ladder")).toBe(true);
    expect(displayed).toContain("**TLDR**");
    expect(displayed).toContain("**Continue**");
    expect(diagram?.kind).toBe("diagram");
    if (diagram?.kind !== "diagram") return;
    expect(diagram.payload.typeId).toBe("process-flow");
    expect(diagram.payload.stages.map((stage) => stage.label)).toEqual([
      "Light reactions",
      "Calvin cycle",
      "Start",
    ]);
    expect(displayed.indexOf("```eduai-diagram")).toBeLessThan(
      displayed.indexOf("**Continue**"),
    );
  });
});

describe("hasEduaiDiagramBlock", () => {
  it("detects eduai-diagram fences", () => {
    expect(
      hasEduaiDiagramBlock("```eduai-diagram\ngradient-descent\n```"),
    ).toBe(true);
    expect(hasEduaiDiagramBlock("```text\nx\n```")).toBe(false);
  });
});

describe("eduai diagram registry", () => {
  it("resolves known types and falls back unknown to process-flow", () => {
    expect(normalizeEduaiDiagramTypeId("Gradient_Descent")).toBe(
      "gradient-descent",
    );
    expect(normalizeEduaiDiagramTypeId("mystery")).toBe("process-flow");
    expect(resolveEduaiDiagramComponent("gradient-descent")).toBeTruthy();
    expect(resolveEduaiDiagramComponent("hierarchy")).toBeTruthy();
    expect(resolveEduaiDiagramComponent("compare")).toBeTruthy();
    expect(resolveEduaiDiagramComponent("unknown-type")).toBeTruthy();
  });
});

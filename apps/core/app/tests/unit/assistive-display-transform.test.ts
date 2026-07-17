// @vitest-environment node
import { describe, it, expect } from "vitest";
import { transformAssistiveDisplayCopy } from "~/components/chat/assistive-display-transform";

describe("transformAssistiveDisplayCopy", () => {
  it("relabels Top summary and Next? for display only", () => {
    const stored = `**Top summary**
- One bullet

**Next?** Want more detail?`;

    const displayed = transformAssistiveDisplayCopy(stored);

    expect(displayed).toContain("**TLDR**");
    expect(displayed).toContain("**Continue**");
    expect(displayed).not.toContain("**Top summary**");
    expect(displayed).not.toContain("**Next?**");
  });

  it("leaves non-assistive content unchanged", () => {
    const text = "Gradient descent minimizes the loss.";
    expect(transformAssistiveDisplayCopy(text)).toBe(text);
  });

  it("handles case-insensitive Top summary", () => {
    expect(transformAssistiveDisplayCopy("**top summary**")).toBe("**TLDR**");
  });

  it("orders Step ladder → body → TLDR → Continue (#1060)", () => {
    const stored = `**Top summary**
- Gradient descent steps downhill on the loss
- Smaller steps near the minimum

### Step ladder
1. Pick a starting point — *why:* need an initial guess
2. Compute the gradient — *why:* tells the downhill direction
3. Take a small step — *why:* avoid overshooting

**Next?** Want me to expand step 2?`;

    const displayed = transformAssistiveDisplayCopy(stored);
    const tldrAt = displayed.indexOf("**TLDR**");
    const stepAt = displayed.indexOf("### Step ladder");
    const continueAt = displayed.indexOf("**Continue**");

    expect(tldrAt).toBeGreaterThan(-1);
    expect(stepAt).toBeGreaterThan(-1);
    expect(continueAt).toBeGreaterThan(-1);
    expect(stepAt).toBeLessThan(tldrAt);
    expect(tldrAt).toBeLessThan(continueAt);
    expect(displayed).toContain("---\n\n**TLDR**");
    expect(displayed).toContain("- Gradient descent steps downhill on the loss");
    expect(displayed.trim().startsWith("### Step ladder")).toBe(true);
    expect(displayed).not.toContain("**Top summary**");
    expect(displayed).not.toContain("**Next?**");
  });

  it("orders Step ladder → diagram → TLDR → Continue for diagram replies", () => {
    const stored = `**Top summary**
- **Introduce Bill** — propose the idea
- **Committee Review** — study and amend
- **Floor Vote** — chamber decides
- **Presidential Action** — sign or veto

Here's a sketch of how a bill typically becomes a law:
- Introduce Bill: propose
- Committee Review: study

### Step ladder
Start here: Introduce Bill (~2 min)
1. Introduce Bill: A Senator drafts and proposes a bill.
2. Committee Review: Experts study and amend.
3. Floor Vote: Full chamber decides.
4. Presidential Action: President approves or rejects.

\`\`\`eduai-diagram
process-flow
title: How a Bill Becomes a Law
Introduce Bill: Member files the proposal
Committee Review: Experts study and amend
Floor Vote: Full chamber decides
Presidential Action: President approves or rejects
\`\`\`

**Next?** Want me to explain the Committee Review step?`;

    const displayed = transformAssistiveDisplayCopy(stored);
    const stepAt = displayed.indexOf("### Step ladder");
    const diagramAt = displayed.indexOf("```eduai-diagram");
    const tldrAt = displayed.indexOf("**TLDR**");
    const continueAt = displayed.indexOf("**Continue**");

    expect(stepAt).toBe(0);
    expect(stepAt).toBeLessThan(diagramAt);
    expect(diagramAt).toBeLessThan(tldrAt);
    expect(tldrAt).toBeLessThan(continueAt);
    expect(displayed).toContain("**Introduce Bill** — propose the idea");
    expect(displayed).not.toContain("Here's a sketch");
    expect(displayed).not.toContain("**Top summary**");
  });

  it("backfills missing Step ladder steps from diagram stages", () => {
    const stored = `**Top summary**
- **Introduce Bill** — file it
- **Committee Review** — study
- **Floor Vote** — decide
- **Become Law** — sign

### Step ladder
Start here: Introduce Bill (~1 min)
1. Introduce Bill: A member of Congress files a proposal. Why it matters: starts the process.

\`\`\`eduai-diagram
process-flow
title: How a Bill Becomes Law
Introduce Bill: Member files the proposal
Committee Review: Experts study and amend
Floor Vote: Full chamber decides
Become Law: President signs
\`\`\`

**Next?** Want Committee Review?`;

    const displayed = transformAssistiveDisplayCopy(stored);
    expect(displayed).toContain("1. **Introduce Bill:**");
    expect(displayed).toContain("starts the process");
    expect(displayed).toContain("2. **Committee Review:**");
    expect(displayed).toContain("3. **Floor Vote:**");
    expect(displayed).toContain("4. **Become Law:**");
    expect(displayed.indexOf("1. **Introduce Bill:**")).toBeLessThan(
      displayed.indexOf("```eduai-diagram"),
    );
  });

  it("backfills hierarchy and compare ladders the same way", () => {
    const hierarchy = transformAssistiveDisplayCopy(`**Top summary**
- Neuron

### Step ladder
1. Neuron: The whole cell

\`\`\`eduai-diagram
hierarchy
title: Neuron parts
Neuron: Whole cell
Dendrites: Receive signals
Axon: Sends signals
\`\`\`

**Next?** More?`);

    expect(hierarchy).toContain("1. **Neuron:**");
    expect(hierarchy).toContain("2. **Dendrites:**");
    expect(hierarchy).toContain("3. **Axon:**");
    expect(hierarchy).toContain("**Dendrites** — Receive signals");

    const compare = transformAssistiveDisplayCopy(`**Top summary**
- Supervised

\`\`\`eduai-diagram
compare
title: Learning
Supervised: Uses labels
Unsupervised: Finds structure
\`\`\`

**Next?** More?`);

    expect(compare).toContain("### Step ladder");
    expect(compare).toContain("1. **Supervised:**");
    expect(compare).toContain("2. **Unsupervised:**");
    expect(compare.indexOf("### Step ladder")).toBeLessThan(
      compare.indexOf("```eduai-diagram"),
    );
  });

  it("completes gradient-descent Step ladder and TLDR from default stages", () => {
    const stored = `**Top summary**
- Walk downhill on the loss

\`\`\`eduai-diagram
gradient-descent
\`\`\`

**Next?** More?`;

    const displayed = transformAssistiveDisplayCopy(stored);
    expect(displayed).toContain("### Step ladder");
    expect(displayed).toContain("1. **Start point:**");
    expect(displayed).toContain("2. **Compute gradient:**");
    expect(displayed).toContain("3. **Step downhill:**");
    expect(displayed).toContain("4. **Near minimum:**");
    expect(displayed).toContain("**TLDR**");
    expect(displayed).toContain("**Start point**");
    expect(displayed.indexOf("### Step ladder")).toBeLessThan(
      displayed.indexOf("```eduai-diagram"),
    );
    expect(displayed.indexOf("```eduai-diagram")).toBeLessThan(
      displayed.indexOf("**TLDR**"),
    );
  });

  it("synthesizes TLDR from diagram stages when Top summary is missing", () => {
    const stored = `### Step ladder
1. Introduce Bill: File it
2. Vote: Decide

\`\`\`eduai-diagram
process-flow
title: Bill to law
Introduce Bill: Member files the proposal
Floor Vote: Chamber decides
Become Law: President signs
\`\`\`

**Next?** More?`;

    const displayed = transformAssistiveDisplayCopy(stored);
    expect(displayed.indexOf("### Step ladder")).toBeLessThan(
      displayed.indexOf("```eduai-diagram"),
    );
    expect(displayed.indexOf("```eduai-diagram")).toBeLessThan(
      displayed.indexOf("**TLDR**"),
    );
    expect(displayed).toContain("**Introduce Bill** — Member files the proposal");
    expect(displayed).toContain("**Continue**");
  });

  it("appends TLDR at end when there is no Next? block", () => {
    const stored = `**Top summary**
- Short answer

Here is the longer explanation without a continuation offer.`;

    const displayed = transformAssistiveDisplayCopy(stored);
    expect(displayed.indexOf("Here is the longer")).toBeLessThan(displayed.indexOf("**TLDR**"));
    expect(displayed.trim().endsWith("- Short answer")).toBe(true);
  });

  it("leaves eduai-diagram fences intact while reordering TLDR", () => {
    const stored = `**Top summary**
- One

\`\`\`eduai-diagram
gradient-descent
\`\`\`

**Next?** More?`;

    const displayed = transformAssistiveDisplayCopy(stored);
    expect(displayed).toContain("```eduai-diagram");
    expect(displayed).toContain("gradient-descent");
    expect(displayed.indexOf("```eduai-diagram")).toBeLessThan(displayed.indexOf("**TLDR**"));
    expect(displayed.indexOf("**TLDR**")).toBeLessThan(displayed.indexOf("**Continue**"));
  });

  it("leaves redirect-style turns without Top summary unchanged except Next? relabel", () => {
    const stored = `That's a separate question — want to come back to gradients first, or switch?

**Next?** Ready to return to gradients?`;

    const displayed = transformAssistiveDisplayCopy(stored);
    expect(displayed).toContain("That's a separate question");
    expect(displayed).toContain("**Continue**");
    expect(displayed).not.toContain("**TLDR**");
  });
});

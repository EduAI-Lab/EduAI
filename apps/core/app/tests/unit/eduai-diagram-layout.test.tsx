import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { AnimatedProcessFlow } from "~/components/chat/diagrams/animated-process-flow";
import { AnimatedHierarchy } from "~/components/chat/diagrams/animated-hierarchy";
import { AnimatedCompare } from "~/components/chat/diagrams/animated-compare";
import { AnimatedGradientDescent } from "~/components/chat/diagrams/animated-gradient-descent";
import type { EduaiDiagramPayload } from "~/lib/ai/eduai-diagram-payload";

/**
 * #1320: the diagram shell and its flex-wrap stage rows must be able to
 * shrink to their message-column parent (min-w-0) and never assert a wider
 * intrinsic width than that parent (w-full/max-w-full) -- otherwise a flex
 * item's default `min-width: auto` lets a row of stage chips push the whole
 * diagram (and the message column around it) wider than the viewport
 * instead of wrapping, which is what "renders off-screen" looked like.
 */

const processFlowPayload: EduaiDiagramPayload = {
  typeId: "process-flow",
  title: "Wash dishes",
  stages: [
    { label: "Rinse", detail: "Loosen stuck-on food." },
    { label: "Wash", detail: "Apply soap and scrub." },
    { label: "Dry", detail: "Air-dry or towel-dry." },
    { label: "Put away", detail: "Return items to storage." },
    { label: "Wipe counter", detail: "Clean the workspace." },
  ],
};

const hierarchyPayload: EduaiDiagramPayload = {
  typeId: "hierarchy",
  title: "Tax brackets",
  stages: [
    { label: "Income", detail: "Total taxable income." },
    { label: "10% bracket", detail: "First portion." },
    { label: "12% bracket", detail: "Next portion." },
    { label: "22% bracket", detail: "Top portion." },
  ],
};

const comparePayload: EduaiDiagramPayload = {
  typeId: "compare",
  title: "Assistive vs Baseline",
  stages: [
    { label: "Assistive Mode", detail: "Structured, stepwise." },
    { label: "Baseline", detail: "Free-form." },
  ],
};

const gradientDescentPayload: EduaiDiagramPayload = {
  typeId: "gradient-descent",
  title: "Gradient descent",
  stages: [
    { label: "Start", detail: "Initial parameters." },
    { label: "Step", detail: "Move downhill." },
    { label: "Minimum", detail: "Lowest cost." },
  ],
};

function expectShellContainment(container: HTMLElement) {
  const shell = container.querySelector("[data-eduai-diagram]");
  expect(shell).toBeInTheDocument();
  expect(shell?.className).toContain("w-full");
  expect(shell?.className).toContain("min-w-0");
  expect(shell?.className).toContain("max-w-full");
  expect(shell?.className).toContain("overflow-hidden");
}

describe("diagram shell containment (#1320)", () => {
  it("AnimatedProcessFlow shell and stage row shrink to their parent", () => {
    const { container } = render(<AnimatedProcessFlow payload={processFlowPayload} />);
    expectShellContainment(container);
    const row = container.querySelector("ol");
    expect(row?.className).toContain("w-full");
    expect(row?.className).toContain("min-w-0");
    expect(row?.className).toContain("flex-wrap");
  });

  it("AnimatedHierarchy shell and node row shrink to their parent", () => {
    const { container } = render(<AnimatedHierarchy payload={hierarchyPayload} />);
    expectShellContainment(container);
    const row = container.querySelector('[role="group"] div.flex-wrap');
    expect(row?.className).toContain("w-full");
    expect(row?.className).toContain("min-w-0");
  });

  it("AnimatedCompare shell and pane row shrink to their parent", () => {
    const { container } = render(<AnimatedCompare payload={comparePayload} />);
    expectShellContainment(container);
    const row = container.querySelector('[role="group"] div.flex-wrap');
    expect(row?.className).toContain("w-full");
    expect(row?.className).toContain("min-w-0");
  });

  it("AnimatedGradientDescent shell and SVG stay bounded", () => {
    const { container } = render(<AnimatedGradientDescent payload={gradientDescentPayload} />);
    expectShellContainment(container);
    const svg = container.querySelector('[viewBox="0 0 320 180"]');
    expect(svg).toBeInTheDocument();
    expect(svg?.getAttribute("class") ?? "").toContain("w-full");
  });
});

import type { EduaiDiagramPayload } from "~/lib/ai/eduai-diagram-payload";

/**
 * Shared fixture payloads for the #1320 diagram real-browser layout
 * regression — used by both generate-fixtures.tsx (renders these through
 * the real components) and diagram-overflow.spec.ts (asserts containment).
 * Kept in a plain .ts file (no JSX) so it can be imported from either side
 * without pulling Playwright's JSX transform into the render step.
 */

export const processFlowPayload: EduaiDiagramPayload = {
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

export const hierarchyPayload: EduaiDiagramPayload = {
  typeId: "hierarchy",
  title: "Tax brackets",
  stages: [
    { label: "Income", detail: "Total taxable income." },
    { label: "10% bracket", detail: "First portion." },
    { label: "12% bracket", detail: "Next portion." },
    { label: "22% bracket", detail: "Top portion." },
  ],
};

export const comparePayload: EduaiDiagramPayload = {
  typeId: "compare",
  title: "Assistive vs Baseline",
  stages: [
    { label: "Assistive Mode", detail: "Structured, stepwise." },
    { label: "Baseline", detail: "Free-form." },
  ],
};

export const gradientDescentPayload: EduaiDiagramPayload = {
  typeId: "gradient-descent",
  title: "Gradient descent",
  stages: [
    { label: "Start", detail: "Initial parameters." },
    { label: "Step", detail: "Move downhill." },
    { label: "Minimum", detail: "Lowest cost." },
  ],
};

/** Fixture file name (without extension) for each diagram type. */
export const DIAGRAM_FIXTURE_NAMES = [
  "process-flow",
  "hierarchy",
  "compare",
  "gradient-descent",
] as const;

export type DiagramFixtureName = (typeof DIAGRAM_FIXTURE_NAMES)[number];

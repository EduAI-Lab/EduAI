import { describe, expect, it } from "vitest";
import { AI_TUTOR_TOURS } from "~/lib/tours/ai-tutor-tours";

describe("student-journey tour definition", () => {
  it("pairs every route-capturing content gate with an emptyTarget", () => {
    const gated = AI_TUTOR_TOURS["student-journey"].steps.filter((step) => step.captureRoute);
    expect(gated.length).toBeGreaterThan(0);
    for (const step of gated) {
      expect(step.emptyTarget, `step "${step.id}" is missing an emptyTarget`).toBeTruthy();
    }
  });
});

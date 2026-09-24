import { describe, expect, it } from "vitest";
import { tourDefinitions } from "~/lib/tours/tour-definitions";

describe("student-journey tour definition", () => {
  it("pairs every route-producing content gate with an emptyTarget", () => {
    const gated = tourDefinitions["student-journey"].steps.filter(
      (step) => step.storeRouteFromTarget,
    );
    expect(gated.length).toBeGreaterThan(0);
    for (const step of gated) {
      expect(step.emptyTarget, `step "${step.id}" is missing an emptyTarget`).toBeTruthy();
    }
  });
});

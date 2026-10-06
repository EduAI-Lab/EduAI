import { describe, expect, it } from "vitest";

import { placeTourCard } from "../tour/tour-dom";
import {
  findAvailableStep,
  isOnRoute,
  resolveStartStep,
  resolveStepRoute,
  type TourStep,
} from "../tour/tour-engine";

const step = (id: string, route?: TourStep["route"]): TourStep => ({
  id,
  title: id,
  body: id,
  route,
});

const STEPS: TourStep[] = [
  step("list", "/courses"),
  step("card", "/courses"),
  step("questions", (r) => (r.course ? `${r.course}?tab=questions` : null)),
  step("assessments", (r) => (r.course ? `${r.course}?tab=assessments` : null)),
  step("anywhere"),
];

describe("resolveStepRoute", () => {
  it("distinguishes no route (undefined) from an unresolvable one (null)", () => {
    expect(resolveStepRoute(STEPS[4], {})).toBeUndefined();
    expect(resolveStepRoute(STEPS[2], {})).toBeNull();
    expect(resolveStepRoute(STEPS[2], { course: "/courses/5" })).toBe("/courses/5?tab=questions");
  });
});

describe("findAvailableStep", () => {
  it("skips steps whose route depends on something not captured yet", () => {
    expect(findAvailableStep(STEPS, {}, 2, 1)).toBe(4);
    expect(findAvailableStep(STEPS, { course: "/courses/5" }, 2, 1)).toBe(2);
    expect(findAvailableStep(STEPS, {}, 3, -1)).toBe(1);
  });

  it("returns null past either end", () => {
    expect(findAvailableStep(STEPS, {}, 5, 1)).toBeNull();
    expect(findAvailableStep(STEPS, {}, -1, -1)).toBeNull();
  });
});

describe("isOnRoute", () => {
  it("requires the pathname and every query param the route names", () => {
    const loc = { pathname: "/courses/5", search: "?tab=questions&page=2" };
    expect(isOnRoute("/courses/5?tab=questions", loc)).toBe(true);
    expect(isOnRoute("/courses/5", loc)).toBe(true);
    expect(isOnRoute("/courses/5?tab=assessments", loc)).toBe(false);
    expect(isOnRoute("/courses/6", loc)).toBe(false);
  });
});

describe("resolveStartStep", () => {
  it("opens on the first step belonging to the current page", () => {
    expect(resolveStartStep(STEPS, { course: "/courses/5" }, "/courses/5")).toBe(2);
    expect(resolveStartStep(STEPS, {}, "/courses")).toBe(0);
  });

  it("falls back to the first available step elsewhere", () => {
    expect(resolveStartStep(STEPS, {}, "/settings")).toBe(0);
  });
});

describe("placeTourCard", () => {
  const viewport = { width: 1000, height: 800 };
  const card = { width: 300, height: 150 };

  it("centres the card when there is no target", () => {
    expect(placeTourCard(null, card, viewport)).toEqual({ top: 325, left: 350 });
  });

  it("uses the preferred side when it fits", () => {
    const target = { top: 100, left: 400, width: 200, height: 50 };
    expect(placeTourCard(target, card, viewport, "bottom")).toEqual({ top: 166, left: 350 });
  });

  it("flips to the opposite side when the preferred one overflows", () => {
    const target = { top: 700, left: 400, width: 200, height: 50 };
    expect(placeTourCard(target, card, viewport, "bottom").top).toBe(700 - 16 - 150);
  });

  it("keeps the card inside the viewport horizontally", () => {
    const target = { top: 100, left: 950, width: 40, height: 40 };
    expect(placeTourCard(target, card, viewport, "bottom").left).toBe(1000 - 300 - 16);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import {
  readRouteFromElement,
  resolveStepRoute,
  waitForEitherElement,
  waitForElement,
} from "~/lib/tours/tour-utils";
import type { AppTourStep, TourContextState } from "~/lib/tours/tour-types";

/**
 * #1572 — a content gate (first module/lesson card) is raced against its
 * empty-state sentinel so an empty course skips the gate at once instead of
 * stalling on the full missing-target timeout.
 */
describe("waitForEitherElement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves to the target when it is already present", async () => {
    document.body.innerHTML = `<div data-tour="target"></div>`;
    const result = await waitForEitherElement('[data-tour="target"]', '[data-tour="empty"]');
    expect(result.matched).toBe("target");
  });

  it("resolves to the empty sentinel when only it is present (no stall)", async () => {
    document.body.innerHTML = `<div data-tour="empty"></div>`;
    const result = await waitForEitherElement('[data-tour="target"]', '[data-tour="empty"]');
    expect(result.matched).toBe("empty");
  });

  it("prefers the target when both are present", async () => {
    document.body.innerHTML = `<div data-tour="empty"></div><div data-tour="target"></div>`;
    const result = await waitForEitherElement('[data-tour="target"]', '[data-tour="empty"]');
    expect(result.matched).toBe("target");
  });

  it("resolves once a match is added to the DOM later", async () => {
    const pending = waitForEitherElement('[data-tour="target"]', '[data-tour="empty"]');
    const node = document.createElement("div");
    node.setAttribute("data-tour", "empty");
    document.body.appendChild(node);
    const result = await pending;
    expect(result.matched).toBe("empty");
  });

  it("rejects when neither appears before the timeout", async () => {
    await expect(
      waitForEitherElement('[data-tour="target"]', '[data-tour="empty"]', 20),
    ).rejects.toThrow(/Timed out/);
  });
});

describe("waitForElement", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("resolves immediately when the element already exists", async () => {
    document.body.innerHTML = `<div data-tour="present"></div>`;
    const el = await waitForElement('[data-tour="present"]');
    expect(el).toBeTruthy();
  });

  it("resolves once the element is added to the DOM later", async () => {
    const pending = waitForElement('[data-tour="later"]');
    const node = document.createElement("div");
    node.setAttribute("data-tour", "later");
    document.body.appendChild(node);
    const el = await pending;
    expect(el).toBe(node);
  });

  it("rejects when the element never appears before the timeout", async () => {
    await expect(waitForElement('[data-tour="missing"]', 20)).rejects.toThrow(/Timed out/);
  });
});

describe("resolveStepRoute", () => {
  const context: TourContextState = {
    currentPath: "/instructor",
    selectedCourseRoute: "/instructor/courses/1",
    selectedModuleRoute: null,
    selectedLessonRoute: null,
  };

  it("returns a static string route unchanged", () => {
    const step = { route: "/instructor" } as AppTourStep;
    expect(resolveStepRoute(step, context)).toBe("/instructor");
  });

  it("invokes a function route with the context", () => {
    const step = { route: (ctx: TourContextState) => ctx.selectedCourseRoute } as AppTourStep;
    expect(resolveStepRoute(step, context)).toBe("/instructor/courses/1");
  });
});

describe("readRouteFromElement", () => {
  it("reads the data-tour-route attribute", () => {
    const el = document.createElement("div");
    el.dataset.tourRoute = "/student/courses/1";
    expect(readRouteFromElement(el)).toBe("/student/courses/1");
  });

  it("returns null when the element has no dataset route", () => {
    const el = document.createElement("div");
    expect(readRouteFromElement(el)).toBeNull();
  });

  it("returns null for a null element", () => {
    expect(readRouteFromElement(null)).toBeNull();
  });
});

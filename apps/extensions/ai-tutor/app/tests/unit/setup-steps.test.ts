import { describe, expect, it, vi } from "vitest";

import { setupSteps } from "~/lib/setup-steps";

const publish = { onSelect: vi.fn() };
const base = {
  hasModule: true,
  hasLesson: true,
  hasActivity: true,
  published: false,
  publishDetail: "Publish it.",
  actions: { publish },
};

describe("setupSteps (#2170)", () => {
  it("orders the path module, lesson, activity, publish", () => {
    expect(setupSteps(base).map((s) => s.label)).toEqual([
      "Add a module",
      "Add a lesson",
      "Add an activity",
      "Publish for students",
    ]);
  });

  it("offers publishing only once the three steps before it are done", () => {
    const early = setupSteps({ ...base, hasActivity: false })[3];
    expect(early.onSelect).toBeUndefined();
    expect(early.detail).toBe("Last step: add a module, a lesson and an activity first.");

    const ready = setupSteps(base)[3];
    expect(ready.onSelect).toBe(publish.onSelect);
    expect(ready.detail).toBe("Publish it.");
  });

  it("still explains a publish that happened before the content did", () => {
    const step = setupSteps({ ...base, hasLesson: false, published: true })[3];
    expect(step.done).toBe(true);
    expect(step.detail).toBe("Publish it.");
  });
});

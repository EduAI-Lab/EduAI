import { afterEach, describe, expect, it } from "vitest";
import { waitForEitherElement } from "~/lib/tours/tour-utils";

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

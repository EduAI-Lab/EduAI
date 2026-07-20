import { describe, expect, it } from "vitest";
import { inferHybridWebToolMode } from "~/lib/ai/hybrid-web-tools";

describe("inferHybridWebToolMode", () => {
  it("detects fetchPage prompts with explicit URL", () => {
    expect(
      inferHybridWebToolMode("Fetch the page at https://example.com and list the main headings."),
    ).toBe("fetchPage");
  });

  it("detects webSearch prompts", () => {
    expect(
      inferHybridWebToolMode(
        "Search the web for recent BC grid carbon intensity estimates and compare assumptions.",
      ),
    ).toBe("webSearch");
  });

  it("returns null for non-tool factual prompts", () => {
    expect(inferHybridWebToolMode("Define kinetic energy.")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { READING_SURFACE_CLASS } from "~/components/assistive/reading-surface";

const cssPath = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../styles/assistive-reading.css",
);
const css = readFileSync(cssPath, "utf-8");

describe("READING_SURFACE_CLASS", () => {
  it("is the hook class used by assistive-reading.css", () => {
    expect(READING_SURFACE_CLASS).toBe("reading-surface");
    expect(css).toContain(".reading-surface");
  });
});

describe("assistive-reading.css", () => {
  it("scopes all typography under [data-assistive]", () => {
    expect(css).toMatch(/\[data-assistive\]\s*\.reading-surface/);
    expect(css).not.toMatch(/^\.reading-surface\s*\{/m);
  });

  it("sets spacing-based reading defaults (no font-family swap)", () => {
    expect(css).toContain("font-size: 1rem");
    expect(css).toContain("line-height: 1.625");
    expect(css).toContain("max-width: 65ch");
    expect(css).toContain("letter-spacing: 0.03em");
    expect(css).not.toContain("font-family");
  });
});

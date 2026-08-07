import { describe, it, expect } from "vitest";
import { cn } from "~/lib/utils";

describe("cn", () => {
  it("joins simple class names", () => {
    expect(cn("a", "b")).toBe("a b");
  });

  it("merges conflicting tailwind classes (last wins)", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });

  it("ignores falsy values", () => {
    expect(cn("a", false, null, undefined, "", "b")).toBe("a b");
  });

  it("supports the conditional object syntax", () => {
    expect(cn("a", { b: true, c: false })).toBe("a b");
  });

  it("supports nested arrays", () => {
    expect(cn(["a", "b"], "c")).toBe("a b c");
  });

  it("returns an empty string with no arguments", () => {
    expect(cn()).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { splitTitle, titleName, titleNumber } from "~/lib/course-title";

describe("splitTitle", () => {
  it("splits on an em dash", () => {
    expect(splitTitle("MATH 320 — Real Analysis")).toEqual({
      label: "MATH 320",
      sublabel: "Real Analysis",
    });
  });

  it("splits on an en dash", () => {
    expect(splitTitle("Module 1 – Foundations")).toEqual({
      label: "Module 1",
      sublabel: "Foundations",
    });
  });

  it("splits on a hyphen", () => {
    expect(splitTitle("COSC 101 - Computer Studies")).toEqual({
      label: "COSC 101",
      sublabel: "Computer Studies",
    });
  });

  it("falls back to the whole title when there is no separator", () => {
    expect(splitTitle("Untitled Course")).toEqual({ label: "Untitled Course" });
  });
});

describe("titleName", () => {
  it("returns the sublabel half when present", () => {
    expect(titleName("Module 1 — Foundations")).toBe("Foundations");
  });

  it("returns the whole title when there is no separator", () => {
    expect(titleName("Plain Title")).toBe("Plain Title");
  });
});

describe("titleNumber", () => {
  it("extracts a trailing integer from the label", () => {
    expect(titleNumber("Module 1 — Foundations")).toBe("1");
  });

  it("extracts a decimal lesson number", () => {
    expect(titleNumber("Lesson 1.1 — Thinking Computationally")).toBe("1.1");
  });

  it("returns null when the label carries no number", () => {
    expect(titleNumber("Intro — Getting Started")).toBeNull();
  });

  it("returns null when there is no separator and no trailing number", () => {
    expect(titleNumber("Untitled")).toBeNull();
  });
});

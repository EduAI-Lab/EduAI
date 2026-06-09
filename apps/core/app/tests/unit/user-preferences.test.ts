// @vitest-environment node
import { describe, it, expect } from "vitest";
import { parsePreferenceUpdates, resolveSelectedCourse } from "~/lib/user-preferences";

describe("parsePreferenceUpdates", () => {
  it("keeps a boolean assistDefault (true and false)", () => {
    expect(parsePreferenceUpdates({ assistDefault: true })).toEqual({ assistDefault: true });
    expect(parsePreferenceUpdates({ assistDefault: false })).toEqual({ assistDefault: false });
  });

  it("ignores a non-boolean assistDefault", () => {
    expect(parsePreferenceUpdates({ assistDefault: "true" })).toEqual({});
    expect(parsePreferenceUpdates({ assistDefault: 1 })).toEqual({});
  });

  it("keeps and trims a non-empty course code", () => {
    expect(parsePreferenceUpdates({ lastCourseCode: "COSC 121" })).toEqual({
      lastCourseCode: "COSC 121",
    });
    expect(parsePreferenceUpdates({ lastCourseCode: "  COSC 121  " })).toEqual({
      lastCourseCode: "COSC 121",
    });
  });

  it("normalizes a blank course code to null (cleared)", () => {
    expect(parsePreferenceUpdates({ lastCourseCode: "" })).toEqual({ lastCourseCode: null });
    expect(parsePreferenceUpdates({ lastCourseCode: "   " })).toEqual({ lastCourseCode: null });
  });

  it("treats an explicit null course code as a clear", () => {
    expect(parsePreferenceUpdates({ lastCourseCode: null })).toEqual({ lastCourseCode: null });
  });

  it("ignores a non-string, non-null course code", () => {
    expect(parsePreferenceUpdates({ lastCourseCode: 123 })).toEqual({});
  });

  it("parses both fields together and ignores unknown keys", () => {
    expect(
      parsePreferenceUpdates({ assistDefault: true, lastCourseCode: "MATH 100", extra: "nope" }),
    ).toEqual({ assistDefault: true, lastCourseCode: "MATH 100" });
  });

  it("returns an empty object for non-object payloads", () => {
    expect(parsePreferenceUpdates(null)).toEqual({});
    expect(parsePreferenceUpdates(undefined)).toEqual({});
    expect(parsePreferenceUpdates("string")).toEqual({});
    expect(parsePreferenceUpdates(42)).toEqual({});
    expect(parsePreferenceUpdates({})).toEqual({});
  });
});

describe("resolveSelectedCourse", () => {
  const available = ["COSC 121", "MATH 100", "PHYS 111"];

  it("returns the current code when it is still available", () => {
    expect(resolveSelectedCourse("MATH 100", available)).toBe("MATH 100");
  });

  it("returns null when the current code is no longer available", () => {
    expect(resolveSelectedCourse("BIOL 200", available)).toBeNull();
  });

  it("returns null when there is no current selection", () => {
    expect(resolveSelectedCourse(null, available)).toBeNull();
  });

  it("returns null when the available list is empty", () => {
    expect(resolveSelectedCourse("COSC 121", [])).toBeNull();
  });
});

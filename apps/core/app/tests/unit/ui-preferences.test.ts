// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  DEFAULT_UI_PREFERENCES,
  isUiDensity,
  isUiTheme,
  resolveThemeHtmlClass,
} from "~/lib/ui-preferences";

describe("ui-preferences helpers", () => {
  it("defaults match baseline behaviour", () => {
    expect(DEFAULT_UI_PREFERENCES).toEqual({
      motionReduced: false,
      density: "comfortable",
      theme: "system",
    });
  });

  it("validates density and theme enums", () => {
    expect(isUiDensity("compact")).toBe(true);
    expect(isUiDensity("comfortable")).toBe(true);
    expect(isUiDensity("cozy")).toBe(false);

    expect(isUiTheme("system")).toBe(true);
    expect(isUiTheme("dark")).toBe(true);
    expect(isUiTheme("light")).toBe(true);
    expect(isUiTheme("sepia")).toBe(false);
  });

  it("resolveThemeHtmlClass only sets explicit light/dark", () => {
    expect(resolveThemeHtmlClass("system")).toBeUndefined();
    expect(resolveThemeHtmlClass("light")).toBe("light");
    expect(resolveThemeHtmlClass("dark")).toBe("dark");
  });
});

import { describe, expect, it } from "vitest";
import { getCanvasDefaultUrl, isUsableCanvasDefaultUrl } from "../../services/canvasDefaults";

describe("getCanvasDefaultUrl", () => {
  it("leaves development empty until a reachable Canvas host is configured", () => {
    expect(getCanvasDefaultUrl(true, "")).toBe("");
  });

  it("accepts a configured HTTPS public host and removes a trailing slash", () => {
    expect(getCanvasDefaultUrl(true, "https://canvas.sandbox.ubc.ca/")).toBe(
      "https://canvas.sandbox.ubc.ca",
    );
  });

  it("uses UBC Canvas outside development when no host is configured", () => {
    expect(getCanvasDefaultUrl(false, "")).toBe("https://canvas.ubc.ca");
  });

  it("rejects HTTP, local, private, and reserved hosts", () => {
    expect(isUsableCanvasDefaultUrl("http://canvas.example.edu")).toBe(false);
    expect(isUsableCanvasDefaultUrl("https://canvas.test")).toBe(false);
    expect(isUsableCanvasDefaultUrl("https://127.0.0.1")).toBe(false);
    expect(isUsableCanvasDefaultUrl("https://canvas.example")).toBe(false);
  });
});

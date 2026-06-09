import { describe, expect, it } from "vitest";
import { ConnectCanvasSchema } from "~/lib/canvas/schemas";

describe("ConnectCanvasSchema", () => {
  it("accepts canvasUrl and apiKey", () => {
    const result = ConnectCanvasSchema.safeParse({
      canvasUrl: "http://localhost:8080/",
      apiKey: "1234~token",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.canvasUrl).toBe("http://localhost:8080");
      expect(result.data.isTestMode).toBe(false);
    }
  });

  it("allows test mode without apiKey", () => {
    const result = ConnectCanvasSchema.safeParse({
      canvasUrl: "http://localhost:8080",
      isTestMode: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing apiKey when not in test mode", () => {
    const result = ConnectCanvasSchema.safeParse({
      canvasUrl: "http://localhost:8080",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid canvasUrl", () => {
    const result = ConnectCanvasSchema.safeParse({
      canvasUrl: "not-a-url",
      apiKey: "key",
    });
    expect(result.success).toBe(false);
  });
});

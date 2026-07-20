import { describe, expect, it } from "vitest";
import { ConnectCanvasSchema, LinkRosterSchema, SyncCanvasCoursesSchema } from "~/lib/canvas/schemas";

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

describe("SyncCanvasCoursesSchema", () => {
  it("accepts an empty course list for unsync-all", () => {
    expect(SyncCanvasCoursesSchema.safeParse({ canvasCourseIds: [] }).success).toBe(true);
  });
});

describe("LinkRosterSchema", () => {
  it("trims and accepts 8-digit student numbers", () => {
    const result = LinkRosterSchema.safeParse({ studentNumber: " 12345678 " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.studentNumber).toBe("12345678");
    }
  });

  it("rejects short, long, and non-numeric student numbers", () => {
    expect(LinkRosterSchema.safeParse({ studentNumber: "9" }).success).toBe(false);
    expect(LinkRosterSchema.safeParse({ studentNumber: "1234567" }).success).toBe(false);
    expect(LinkRosterSchema.safeParse({ studentNumber: "123456789" }).success).toBe(false);
    expect(LinkRosterSchema.safeParse({ studentNumber: "abc12345" }).success).toBe(false);
  });
});

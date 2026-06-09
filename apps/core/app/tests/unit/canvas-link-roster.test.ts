import { describe, expect, it } from "vitest";
import { LinkRosterSchema } from "~/lib/canvas/schemas";
import { isCanvasLinkRosterRateLimited } from "~/lib/canvas/link-roster.server";

describe("LinkRosterSchema", () => {
  it("accepts a student number", () => {
    const result = LinkRosterSchema.safeParse({ studentNumber: " 12345678 " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.studentNumber).toBe("12345678");
    }
  });

  it("rejects empty student number", () => {
    expect(LinkRosterSchema.safeParse({ studentNumber: "" }).success).toBe(false);
  });
});

describe("isCanvasLinkRosterRateLimited", () => {
  it("allows attempts under the limit", () => {
    const userId = `rate-limit-test-${Date.now()}`;
    expect(isCanvasLinkRosterRateLimited(userId)).toBe(false);
    expect(isCanvasLinkRosterRateLimited(userId)).toBe(false);
  });
});

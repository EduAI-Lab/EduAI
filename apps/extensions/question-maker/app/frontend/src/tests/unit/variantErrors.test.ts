/**
 * "Failed to toggle draft status / VARIANT_LOCKED" is what an instructor used
 * to see: the raw machine code, printed verbatim. These pin that a human
 * sentence comes out instead, whichever shape the server answers in.
 */
import { describe, expect, it } from "vitest";
import { describeVariantError } from "@/lib/variantErrors";

describe("describeVariantError", () => {
  it("prefers the sentence the server sent", () => {
    const error = {
      response: {
        data: {
          code: "VARIANT_LOCKED",
          error: "This question is still being published to EduAI, so it cannot be changed yet.",
        },
      },
    };

    expect(describeVariantError(error)).toContain("still being published");
  });

  it("never shows a bare machine code from an older build", () => {
    const error = { response: { data: { error: "VARIANT_LOCKED" } } };

    const message = describeVariantError(error);
    expect(message).not.toContain("VARIANT_LOCKED");
    expect(message).toContain("draft");
  });

  it("translates a code sent without a message", () => {
    const error = { response: { data: { code: "CORE_PUSH_FAILED" } } };

    expect(describeVariantError(error)).toContain("publish");
  });

  it("falls back to the client-side message, never to undefined", () => {
    expect(describeVariantError(new Error("Network Error"))).toBe("Network Error");
    expect(describeVariantError({})).toContain("Something went wrong");
  });
});

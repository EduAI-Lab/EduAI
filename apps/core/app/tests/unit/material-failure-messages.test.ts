/**
 * #1791: every terminal failure code must produce a sentence an instructor can
 * act on, and must be honest about whether retrying the same file can help.
 *
 * The bug this came from was entirely a communication failure at this layer: one
 * generic "Processing failed for this file. Please try again." stood in for a
 * rate-limited provider, a saturated PDF worker and an unreadable file alike, so
 * the one situation where "try again" was the right advice was indistinguishable
 * from the ones where it was useless.
 */
import { describe, it, expect } from "vitest";
import type { MaterialFailureCode } from "~/hooks/api/use-course-materials";
import { materialFailure, materialFailureMessage } from "~/lib/materials/failure-messages";

const ALL_CODES: MaterialFailureCode[] = [
  "MATERIAL_EXTRACT_FAILED",
  "MATERIAL_EXTRACT_BUSY",
  "MATERIAL_EXTRACT_ABANDONED",
  "MATERIAL_EMBED_FAILED",
  "MATERIAL_EMBED_RATE_LIMITED",
];

describe("materialFailure", () => {
  it("gives every code its own sentence", () => {
    const messages = ALL_CODES.map(materialFailureMessage);
    expect(new Set(messages).size).toBe(ALL_CODES.length);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(20);
    }
  });

  it("tells the instructor the file is fine when the failure is ours", () => {
    // Both of these are server-side conditions, and saying so is what stops
    // someone concluding their lecture slides are broken.
    expect(materialFailureMessage("MATERIAL_EMBED_RATE_LIMITED")).toMatch(/file itself is fine/i);
    expect(materialFailureMessage("MATERIAL_EXTRACT_BUSY")).toMatch(
      /nothing is wrong with the file/i,
    );
  });

  it("marks transient failures retryable and unreadable files not", () => {
    expect(materialFailure("MATERIAL_EMBED_RATE_LIMITED").retryable).toBe(true);
    expect(materialFailure("MATERIAL_EXTRACT_BUSY").retryable).toBe(true);
    expect(materialFailure("MATERIAL_EMBED_FAILED").retryable).toBe(true);
    expect(materialFailure("MATERIAL_EXTRACT_ABANDONED").retryable).toBe(true);
    // A corrupt, password-protected or image-only PDF fails identically every
    // time, so offering a retry would only waste the instructor's time.
    expect(materialFailure("MATERIAL_EXTRACT_FAILED").retryable).toBe(false);
  });

  it("falls back to the generic message for a null or unknown code", () => {
    // Null is a row that failed before the column existed; an unknown string is
    // a newer server talking to this client. Both keep the retry, because "we
    // don't know" is not a reason to take it away.
    for (const code of [null, undefined, "MATERIAL_SOMETHING_NEW" as MaterialFailureCode]) {
      expect(materialFailure(code)).toEqual({
        message: "Processing failed for this file. Please try again.",
        retryable: true,
      });
    }
  });
});

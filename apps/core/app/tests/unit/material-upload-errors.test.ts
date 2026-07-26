import { describe, it, expect } from "vitest";
import { toMaterialUploadUserMessage } from "~/lib/material-upload-errors";

describe("toMaterialUploadUserMessage", () => {
  it("sanitizes Prisma executeRaw serialization errors", () => {
    const raw =
      "Invalid `prisma.$executeRaw()` invocation:\nRaw query failed.\nerror serializing parameter 2: Couldn't serialize value";
    expect(toMaterialUploadUserMessage(new Error(raw))).toBe(
      "Couldn't save this material's search data due to a database error. Please try again or contact support.",
    );
  });

  it("sanitizes BigDecimal dump fragments", () => {
    expect(
      toMaterialUploadUserMessage(
        new Error("Numeric(Some(BigDecimal(\"0.123\"))) repeated many times"),
      ),
    ).toBe("Couldn't save this material's search data. Please try again.");
  });

  it("maps embedding provider misconfiguration to an admin message", () => {
    expect(
      toMaterialUploadUserMessage(new Error("No embedding provider configured. Set OPENAI_API_KEY.")),
    ).toBe(
      "Search data isn't available for this material right now. Contact your administrator.",
    );
  });

  it("preserves short, user-safe file-processing errors", () => {
    const message = "Failed to extract text from PDF: corrupted file";
    expect(toMaterialUploadUserMessage(new Error(message))).toBe(message);
  });

  it("replaces long opaque errors with a generic message", () => {
    expect(toMaterialUploadUserMessage(new Error("x".repeat(250)))).toBe(
      "Failed to process material. Please try again.",
    );
  });
});

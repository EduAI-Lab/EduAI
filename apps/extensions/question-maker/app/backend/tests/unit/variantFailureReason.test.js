/**
 * Unit tests for the bank-variant failure classifier (#1763).
 *
 * Pure module: no prisma, no config, so these run without DATABASE_URL.
 */
import {
  describeVariantFailure,
  VARIANT_DUPLICATE_FAILURE,
} from "../../src/utils/variantFailureReason.js";

/** Mirrors what `toStableUpstreamError` hands back, plus the re-wrap in eduaiService. */
const upstream = (fields) => Object.assign(new Error("EduAI question generation failed"), fields);

describe("describeVariantFailure", () => {
  it("keeps the message of an error already marked public", () => {
    const err = Object.assign(new Error("MCQ variant missing choices"), { isPublic: true });
    expect(describeVariantFailure(err)).toEqual({
      code: "VARIANT_GENERATION_FAILED",
      message: "MCQ variant missing choices",
    });
  });

  it("keeps an explicit code alongside a public message", () => {
    const err = Object.assign(new Error("bank variant provider-call budget exhausted"), {
      isPublic: true,
      code: "QM_BANK_PROVIDER_CALL_BUDGET",
    });
    expect(describeVariantFailure(err).code).toBe("QM_BANK_PROVIDER_CALL_BUDGET");
  });

  it("reports a credential failure as provider auth", () => {
    const result = describeVariantFailure(upstream({ reasonCode: "PROVIDER_API_KEY_REQUIRED" }));
    expect(result.code).toBe("PROVIDER_AUTH");
    expect(result.message).toMatch(/API key/i);
  });

  it("reports a 401 as provider auth", () => {
    expect(describeVariantFailure(upstream({ statusCode: 401 })).code).toBe("PROVIDER_AUTH");
  });

  it("reports a 403 as provider auth", () => {
    expect(describeVariantFailure(upstream({ statusCode: 403 })).code).toBe("PROVIDER_AUTH");
  });

  it("reports a 429 as a rate limit", () => {
    const result = describeVariantFailure(upstream({ statusCode: 429 }));
    expect(result.code).toBe("PROVIDER_RATE_LIMIT");
    expect(result.message).toMatch(/rate|wait/i);
  });

  it("reports an aborted connection as a timeout", () => {
    const result = describeVariantFailure(upstream({ transportCode: "ECONNABORTED" }));
    expect(result.code).toBe("PROVIDER_TIMEOUT");
    expect(result.message).toMatch(/too long|timed out/i);
  });

  it("reports a refused connection as unreachable", () => {
    const result = describeVariantFailure(upstream({ transportCode: "ECONNREFUSED" }));
    expect(result.code).toBe("PROVIDER_UNREACHABLE");
    expect(result.message).toMatch(/reach/i);
  });

  it("reports an unparseable model reply as malformed JSON", () => {
    const result = describeVariantFailure(upstream({ reasonCode: "PROVIDER_MALFORMED_JSON" }));
    expect(result.code).toBe("PROVIDER_MALFORMED_JSON");
    expect(result.message).toMatch(/JSON|reply/i);
  });

  it("names the status when the provider returns a server error", () => {
    const result = describeVariantFailure(upstream({ statusCode: 503 }));
    expect(result.code).toBe("PROVIDER_ERROR");
    expect(result.message).toContain("503");
  });

  it("falls back to the generic failure for an unclassifiable error", () => {
    expect(describeVariantFailure(new Error("kaboom"))).toEqual({
      code: "VARIANT_GENERATION_FAILED",
      message: "Variant generation failed",
    });
  });

  it("falls back for a null error", () => {
    expect(describeVariantFailure(null).code).toBe("VARIANT_GENERATION_FAILED");
  });

  it("never echoes the message of a non-public error", () => {
    const leaky = upstream({ statusCode: 500 });
    leaky.message = "provider rejected key sk-live-SECRET123";
    expect(describeVariantFailure(leaky).message).not.toContain("SECRET123");
  });
});

describe("VARIANT_DUPLICATE_FAILURE", () => {
  it("tells the instructor the model repeated an existing variant", () => {
    expect(VARIANT_DUPLICATE_FAILURE.code).toBe("VARIANT_DUPLICATE");
    expect(VARIANT_DUPLICATE_FAILURE.message).toMatch(/duplicate|already/i);
  });
});

// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  REDACTED_VALUE,
  redactDiagnosticLogString,
  redactSecretValuesInString,
  sanitizeDetails,
  sanitizeSensitiveData,
} from "~/lib/redact.server";

describe("redactSecretValuesInString", () => {
  it("redacts Bearer tokens", () => {
    expect(redactSecretValuesInString("Authorization: Bearer abc.def.ghi")).toBe(
      `Authorization: Bearer ${REDACTED_VALUE}`,
    );
  });

  it("redacts token query params", () => {
    expect(
      redactSecretValuesInString("https://api.example.com/x?access_token=sekret&ok=1"),
    ).toBe(`https://api.example.com/x?access_token=${REDACTED_VALUE}&ok=1`);
  });

  it("redacts URL userinfo", () => {
    expect(redactSecretValuesInString("postgres://user:pass@host/db")).toBe(
      `postgres://${REDACTED_VALUE}@host/db`,
    );
  });

  it("does not ReDoS on long non-URL strings", () => {
    const long = "y".repeat(100_000);
    const start = Date.now();
    expect(redactSecretValuesInString(long)).toBe(long);
    expect(Date.now() - start).toBeLessThan(500);
  });
});

describe("sanitizeDetails (key-level)", () => {
  it("redacts credential keys but leaves string values under safe keys intact", () => {
    expect(
      sanitizeDetails({
        password: "secret",
        note: "Bearer still-visible-here",
      }),
    ).toEqual({
      password: REDACTED_VALUE,
      note: "Bearer still-visible-here",
    });
  });
});

describe("sanitizeSensitiveData (key + value)", () => {
  it("redacts keys and scrubs secret substrings in string leaves", () => {
    expect(
      sanitizeSensitiveData({
        authorization: "Bearer abc",
        url: "https://x.com?token=sekret",
        note: "ok",
      }),
    ).toEqual({
      authorization: REDACTED_VALUE,
      url: `https://x.com?token=${REDACTED_VALUE}`,
      note: "ok",
    });
  });
});

describe("redactDiagnosticLogString", () => {
  it("parses JSON and applies key + value redaction", () => {
    const raw = JSON.stringify([
      {
        headers: { Authorization: "Bearer abc.def" },
        url: "https://api.example.com?access_token=sekret",
      },
    ]);
    const redacted = redactDiagnosticLogString(raw);
    const parsed = JSON.parse(redacted) as Array<{
      headers: { Authorization: string };
      url: string;
    }>;
    expect(parsed[0].headers.Authorization).toBe(REDACTED_VALUE);
    expect(parsed[0].url).toContain(`access_token=${REDACTED_VALUE}`);
  });

  it("falls back to value-level scrubbing for non-JSON text", () => {
    expect(redactDiagnosticLogString("got Bearer tok123")).toBe(`got Bearer ${REDACTED_VALUE}`);
  });
});

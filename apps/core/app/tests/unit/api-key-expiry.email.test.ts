import { describe, it, expect } from "vitest";
import { buildApiKeyExpiryEmail } from "~/lib/email/templates/api-key-expiry";

const BASE_INPUT = {
  to: "alice@test.local",
  userName: "Alice",
  providerName: "OpenAI",
  expiresAt: new Date("2026-07-13T00:00:00Z"),
  settingsUrl: "http://localhost:3000/settings",
};

describe("buildApiKeyExpiryEmail", () => {
  it("addresses the message to the provided email", () => {
    const msg = buildApiKeyExpiryEmail(BASE_INPUT);
    expect(msg.to).toBe("alice@test.local");
  });

  it("includes the provider name in the subject", () => {
    const msg = buildApiKeyExpiryEmail(BASE_INPUT);
    expect(msg.subject).toContain("OpenAI");
  });

  it("includes '7 days' in the subject", () => {
    const msg = buildApiKeyExpiryEmail(BASE_INPUT);
    expect(msg.subject).toContain("7 days");
  });

  it("includes the provider name in the body text", () => {
    const msg = buildApiKeyExpiryEmail(BASE_INPUT);
    expect(msg.text).toContain("OpenAI");
  });

  it("includes the settings URL in the body text", () => {
    const msg = buildApiKeyExpiryEmail(BASE_INPUT);
    expect(msg.text).toContain("http://localhost:3000/settings");
  });

  it("includes the expiry date in the body text", () => {
    const msg = buildApiKeyExpiryEmail(BASE_INPUT);
    expect(msg.text).toContain(BASE_INPUT.expiresAt.toUTCString());
  });

  it("addresses the user by name in the text body", () => {
    const msg = buildApiKeyExpiryEmail(BASE_INPUT);
    expect(msg.text).toContain("Hi Alice");
  });

  it("falls back to 'there' when userName is null", () => {
    const msg = buildApiKeyExpiryEmail({ ...BASE_INPUT, userName: null });
    expect(msg.text).toContain("Hi there");
  });

  it("falls back to 'there' when userName is whitespace", () => {
    const msg = buildApiKeyExpiryEmail({ ...BASE_INPUT, userName: "   " });
    expect(msg.text).toContain("Hi there");
  });

  it("escapes < and > in userName to prevent HTML injection", () => {
    const msg = buildApiKeyExpiryEmail({ ...BASE_INPUT, userName: "<script>alert(1)</script>" });
    expect(msg.html).not.toContain("<script>");
    expect(msg.html).toContain("&lt;script&gt;");
  });

  it("escapes & in providerName", () => {
    const msg = buildApiKeyExpiryEmail({ ...BASE_INPUT, providerName: "Acme & Co" });
    expect(msg.html).toContain("Acme &amp; Co");
    expect(msg.html).not.toContain("Acme & Co");
  });

  it("escapes quotes in settingsUrl", () => {
    const msg = buildApiKeyExpiryEmail({
      ...BASE_INPUT,
      settingsUrl: 'http://localhost/settings?x="y"',
    });
    expect(msg.html).not.toContain('"y"');
    expect(msg.html).toContain("&quot;y&quot;");
  });

  it("produces both text and html bodies", () => {
    const msg = buildApiKeyExpiryEmail(BASE_INPUT);
    expect(typeof msg.text).toBe("string");
    expect(typeof msg.html).toBe("string");
    expect(msg.text.length).toBeGreaterThan(0);
    expect(msg.html.length).toBeGreaterThan(0);
  });
});

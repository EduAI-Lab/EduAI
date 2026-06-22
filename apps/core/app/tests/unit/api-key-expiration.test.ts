import { describe, it, expect } from "vitest";
import {
  daysUntilExpiration,
  expirationChoiceToSeconds,
  formatExpirationLabel,
  getApiKeyExpirationStatus,
  parseReminderDayWindows,
} from "~/lib/api-keys/expiration";
import { buildApiKeyExpirationEmail } from "~/lib/email/templates/api-key-expiration";

describe("api-key expiration helpers", () => {
  const now = new Date("2026-06-22T12:00:00.000Z").getTime();

  it("maps expiration choices to seconds", () => {
    expect(expirationChoiceToSeconds("90")).toBe(60 * 60 * 24 * 90);
    expect(expirationChoiceToSeconds("never")).toBeUndefined();
  });

  it("classifies expiration status", () => {
    expect(getApiKeyExpirationStatus("2026-06-10T00:00:00.000Z", now)).toBe("expired");
    expect(getApiKeyExpirationStatus("2026-06-28T00:00:00.000Z", now)).toBe("expiring-soon");
    expect(getApiKeyExpirationStatus("2027-01-01T00:00:00.000Z", now)).toBe("active");
    expect(getApiKeyExpirationStatus(null, now)).toBe("none");
  });

  it("formats human-readable expiration labels", () => {
    expect(formatExpirationLabel("2026-06-28T00:00:00.000Z")).toContain("Expires in");
    expect(formatExpirationLabel(null)).toBe("No expiration");
  });

  it("parses reminder windows from env-style strings", () => {
    expect(parseReminderDayWindows("7,1,14")).toEqual([14, 7, 1]);
    expect(parseReminderDayWindows("")).toEqual([14, 7, 1]);
  });
});

describe("buildApiKeyExpirationEmail", () => {
  it("includes the key name and settings link", () => {
    const message = buildApiKeyExpirationEmail({
      to: "admin@example.com",
      keyName: "Production integration",
      expiresAt: new Date("2026-07-01T00:00:00.000Z"),
      daysRemaining: 7,
      settingsUrl: "https://eduai.ok.ubc.ca/settings",
    });

    expect(message.subject).toContain("Production integration");
    expect(message.text).toContain("https://eduai.ok.ubc.ca/settings");
    expect(message.html).toContain("Open API key settings");
  });
});

describe("daysUntilExpiration", () => {
  it("returns whole days remaining", () => {
    const now = new Date("2026-06-22T00:00:00.000Z").getTime();
    expect(daysUntilExpiration("2026-06-29T00:00:00.000Z", now)).toBe(7);
  });
});

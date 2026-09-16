// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  invitation: { findMany: vi.fn() },
}));
vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

const sendEmailMock = vi.hoisted(() => vi.fn());
vi.mock("~/lib/email/mailer.server", () => ({ sendEmail: sendEmailMock }));

vi.mock("~/lib/logging.server", () => ({
  fireAndForget: vi.fn(),
  logSystemError: vi.fn(),
}));

import { notifyExpiringInvitations } from "~/lib/cron-notify-invitation-expiry.server";
import { buildInvitationReminderEmail } from "~/lib/email/templates/invitation-reminder";

/** A fixed "now" so the computed reminder window is deterministic. */
const NOW = new Date("2026-06-20T04:30:00Z");

/** The row shape the handler selects out of `prisma.invitation`. */
type InviteRow = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  expiresAt: Date;
  invitedBy: { name: string | null; email: string } | null;
};

function defaultInvite(): InviteRow {
  return {
    id: "inv-1",
    email: "alice@test.local",
    name: "Alice",
    role: "INSTRUCTOR",
    expiresAt: new Date("2026-06-21T10:00:00Z"),
    invitedBy: { name: "Admin Ada", email: "ada@test.local" },
  };
}

const makeInvite = (overrides: Partial<InviteRow> = {}): InviteRow => ({
  ...defaultInvite(),
  ...overrides,
});

/** The `expiresAt` range the handler asked Postgres for on its first query. */
function queriedWindow(): { gte: Date; lt: Date } {
  return prismaMock.invitation.findMany.mock.calls[0][0].where.expiresAt;
}

const windowWidthMs = (window: { gte: Date; lt: Date }) =>
  window.lt.getTime() - window.gte.getTime();

const selectedBy = (window: { gte: Date; lt: Date }, expiresAt: Date) =>
  expiresAt.getTime() >= window.gte.getTime() && expiresAt.getTime() < window.lt.getTime();

const ORIGINAL_EXPIRY_HOURS = process.env.INVITE_EXPIRY_HOURS;

/** Set the same env var the invitation service reads to size the TTL. */
function setInviteExpiryHours(value: string | undefined): void {
  if (value === undefined) delete process.env.INVITE_EXPIRY_HOURS;
  else process.env.INVITE_EXPIRY_HOURS = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setInviteExpiryHours(undefined);
  prismaMock.invitation.findMany.mockResolvedValue([]);
  sendEmailMock.mockResolvedValue({ delivered: true });
});

afterEach(() => {
  vi.useRealTimers();
  setInviteExpiryHours(ORIGINAL_EXPIRY_HOURS);
});

describe("notifyExpiringInvitations — selection window", () => {
  it("returns { notified: 0 } when no invitation is close to expiring", async () => {
    const result = await notifyExpiringInvitations();

    expect(result).toEqual({ notified: 0 });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("only considers PENDING invitations (excludes ACCEPTED/REVOKED/EXPIRED)", async () => {
    await notifyExpiringInvitations();

    const [args] = prismaMock.invitation.findMany.mock.calls[0];
    expect(args.where.status).toBe("PENDING");
  });

  it("queries a window that spans exactly one calendar day", async () => {
    await notifyExpiringInvitations();

    const { gte, lt } = queriedWindow();
    expect(lt.getTime() - gte.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("anchors the window to UTC midnight of the target day, not the run time", async () => {
    await notifyExpiringInvitations();

    const { gte, lt } = queriedWindow();
    expect(gte.toISOString()).toBe("2026-06-21T00:00:00.000Z");
    expect(lt.toISOString()).toBe("2026-06-22T00:00:00.000Z");
  });

  it("selects an invitation expiring on the target day, whatever the time of day", async () => {
    await notifyExpiringInvitations();
    const window = queriedWindow();

    expect(selectedBy(window, new Date("2026-06-21T00:00:00Z"))).toBe(true);
    expect(selectedBy(window, new Date("2026-06-21T10:00:00Z"))).toBe(true);
    expect(selectedBy(window, new Date("2026-06-21T23:59:59Z"))).toBe(true);
  });

  it("skips invitations expiring sooner than the target day", async () => {
    await notifyExpiringInvitations();
    const window = queriedWindow();

    expect(selectedBy(window, new Date("2026-06-20T23:59:59Z"))).toBe(false);
  });

  it("skips invitations expiring later than the target day", async () => {
    await notifyExpiringInvitations();
    const window = queriedWindow();

    expect(selectedBy(window, new Date("2026-06-22T00:00:00Z"))).toBe(false);
    expect(selectedBy(window, new Date("2026-06-25T10:00:00Z"))).toBe(false);
  });

  it("does not re-notify on the next daily run — the window moves with the day", async () => {
    await notifyExpiringInvitations();
    const todaysWindow = queriedWindow();

    vi.setSystemTime(new Date("2026-06-21T04:30:00Z"));
    prismaMock.invitation.findMany.mockClear();
    await notifyExpiringInvitations();
    const tomorrowsWindow = queriedWindow();

    const expiry = new Date("2026-06-21T10:00:00Z");
    expect(selectedBy(todaysWindow, expiry)).toBe(true);
    expect(selectedBy(tomorrowsWindow, expiry)).toBe(false);
  });
});

describe("notifyExpiringInvitations — window follows the configured TTL", () => {
  it("reminds a day out at the default 72h TTL", async () => {
    await notifyExpiringInvitations();

    const { gte, lt } = queriedWindow();
    expect(gte.toISOString()).toBe("2026-06-21T00:00:00.000Z");
    expect(lt.toISOString()).toBe("2026-06-22T00:00:00.000Z");
  });

  it("still reminds when INVITE_EXPIRY_HOURS is shorter than a day", async () => {
    setInviteExpiryHours("12");

    await notifyExpiringInvitations();
    const window = queriedWindow();

    // A 12h invite never survives to "tomorrow", so a day-out window would
    // silently remind nobody. The window has to cover the rest of today.
    expect(selectedBy(window, new Date("2026-06-20T12:00:00Z"))).toBe(true);
    expect(windowWidthMs(window)).toBeGreaterThan(0);
  });

  it("sends exactly one reminder across consecutive daily runs at a 12h TTL", async () => {
    setInviteExpiryHours("12");
    const expiry = new Date("2026-06-20T12:00:00Z");

    await notifyExpiringInvitations();
    const todaysWindow = queriedWindow();

    vi.setSystemTime(new Date("2026-06-21T04:30:00Z"));
    prismaMock.invitation.findMany.mockClear();
    await notifyExpiringInvitations();
    const tomorrowsWindow = queriedWindow();

    expect(selectedBy(todaysWindow, expiry)).toBe(true);
    expect(selectedBy(tomorrowsWindow, expiry)).toBe(false);
  });

  it("sends exactly one reminder across consecutive daily runs at the default TTL", async () => {
    const expiry = new Date("2026-06-21T10:00:00Z");

    vi.setSystemTime(new Date("2026-06-19T04:30:00Z"));
    await notifyExpiringInvitations();
    const dayBefore = queriedWindow();

    vi.setSystemTime(NOW);
    prismaMock.invitation.findMany.mockClear();
    await notifyExpiringInvitations();
    const onTheDay = queriedWindow();

    vi.setSystemTime(new Date("2026-06-21T04:30:00Z"));
    prismaMock.invitation.findMany.mockClear();
    await notifyExpiringInvitations();
    const dayAfter = queriedWindow();

    expect([dayBefore, onTheDay, dayAfter].filter((w) => selectedBy(w, expiry))).toHaveLength(1);
    expect(selectedBy(onTheDay, expiry)).toBe(true);
  });

  it("reminds further out when invitations are long-lived", async () => {
    setInviteExpiryHours("168");

    await notifyExpiringInvitations();

    const { gte, lt } = queriedWindow();
    expect(gte.toISOString()).toBe("2026-06-22T00:00:00.000Z");
    expect(lt.toISOString()).toBe("2026-06-23T00:00:00.000Z");
  });

  it("never selects an invitation that has already expired", async () => {
    setInviteExpiryHours("12");

    await notifyExpiringInvitations();
    const window = queriedWindow();

    expect(window.gte.getTime()).toBeGreaterThanOrEqual(NOW.getTime());
    expect(selectedBy(window, new Date("2026-06-20T04:29:59Z"))).toBe(false);
  });

  it("falls back to the 72h default when INVITE_EXPIRY_HOURS is malformed", async () => {
    setInviteExpiryHours("not-a-number");

    await notifyExpiringInvitations();

    expect(queriedWindow().gte.toISOString()).toBe("2026-06-21T00:00:00.000Z");
  });

  it("falls back to the 72h default when INVITE_EXPIRY_HOURS is zero or negative", async () => {
    setInviteExpiryHours("-5");

    await notifyExpiringInvitations();

    expect(queriedWindow().gte.toISOString()).toBe("2026-06-21T00:00:00.000Z");
  });
});

describe("notifyExpiringInvitations — sending", () => {
  it("sends one reminder per selected invitation", async () => {
    prismaMock.invitation.findMany.mockResolvedValue([
      makeInvite({ id: "inv-1", email: "alice@test.local" }),
      makeInvite({ id: "inv-2", email: "bob@test.local", name: null }),
    ]);

    const result = await notifyExpiringInvitations();

    expect(result).toEqual({ notified: 2 });
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
  });

  it("addresses the reminder to the invited email", async () => {
    prismaMock.invitation.findMany.mockResolvedValue([makeInvite()]);

    await notifyExpiringInvitations();

    const [message] = sendEmailMock.mock.calls[0];
    expect(message.to).toBe("alice@test.local");
    expect(message.subject).toMatch(/invitation/i);
  });

  it("still sends when the inviting admin's account is gone (invitedBy null)", async () => {
    prismaMock.invitation.findMany.mockResolvedValue([makeInvite({ invitedBy: null })]);

    const result = await notifyExpiringInvitations();

    expect(result).toEqual({ notified: 1 });
  });

  it("counts only successfully sent reminders", async () => {
    sendEmailMock
      .mockResolvedValueOnce({ delivered: true })
      .mockRejectedValueOnce(new Error("SMTP down"));
    prismaMock.invitation.findMany.mockResolvedValue([
      makeInvite({ id: "inv-1" }),
      makeInvite({ id: "inv-2" }),
    ]);

    const result = await notifyExpiringInvitations();

    expect(result).toEqual({ notified: 1 });
  });

  it("logs a system error and keeps going when a send fails", async () => {
    const { fireAndForget, logSystemError } = await import("~/lib/logging.server");
    sendEmailMock.mockRejectedValue(new Error("SMTP down"));
    prismaMock.invitation.findMany.mockResolvedValue([
      makeInvite({ id: "inv-1" }),
      makeInvite({ id: "inv-2" }),
    ]);

    const result = await notifyExpiringInvitations();

    expect(result).toEqual({ notified: 0 });
    expect(sendEmailMock).toHaveBeenCalledTimes(2);
    expect(fireAndForget).toHaveBeenCalledTimes(2);
    expect(vi.mocked(logSystemError)).toHaveBeenCalledWith(
      expect.objectContaining({ code: "INVITATION_REMINDER_EMAIL_FAILED" }),
    );
  });
});

describe("buildInvitationReminderEmail", () => {
  const baseInput = {
    to: "alice@test.local",
    inviteeName: "Alice",
    role: "INSTRUCTOR",
    inviterName: "Admin Ada",
    inviterEmail: "ada@test.local",
    expiresAt: new Date("2026-06-21T10:00:00Z"),
    platformUrl: "https://eduai.test",
  };

  it("addresses the recipient and states the role and expiry", () => {
    const message = buildInvitationReminderEmail(baseInput);

    expect(message.to).toBe("alice@test.local");
    expect(message.text).toContain("Alice");
    expect(message.text).toContain("Instructor");
    expect(message.text).toContain(baseInput.expiresAt.toUTCString());
    expect(message.html).toContain(baseInput.expiresAt.toUTCString());
  });

  it("falls back to a neutral greeting when the invitee has no name", () => {
    const message = buildInvitationReminderEmail({ ...baseInput, inviteeName: null });

    expect(message.text).toContain("Hi there,");
  });

  it("falls back to the raw role when it has no friendly label", () => {
    const message = buildInvitationReminderEmail({ ...baseInput, role: "MYSTERY_ROLE" });

    expect(message.text).toContain("MYSTERY_ROLE");
  });

  it("names the inviter so the invitee knows who to ask for a fresh invite", () => {
    const message = buildInvitationReminderEmail(baseInput);

    expect(message.text).toContain("Admin Ada");
    expect(message.text).toContain("ada@test.local");
  });

  it("degrades to a generic administrator reference when the inviter is unknown", () => {
    const message = buildInvitationReminderEmail({
      ...baseInput,
      inviterName: null,
      inviterEmail: null,
    });

    expect(message.text).toMatch(/administrator/i);
    expect(message.text).not.toContain("null");
  });

  it("points the invitee back at the original invitation email", () => {
    const message = buildInvitationReminderEmail(baseInput);

    expect(message.text).toMatch(/original invitation email/i);
    expect(message.html).toMatch(/original invitation email/i);
  });

  it("carries no accept link or token — the raw token is not recoverable from the DB", () => {
    const message = buildInvitationReminderEmail(baseInput);

    expect(message.text).not.toContain("token=");
    expect(message.html).not.toContain("token=");
    expect(message.text).not.toContain("accept-invitation");
    expect(message.html).not.toContain("accept-invitation");
  });

  it("escapes HTML in caller-supplied names", () => {
    const message = buildInvitationReminderEmail({
      ...baseInput,
      inviteeName: '<script>alert("x")</script>',
      inviterName: "<b>Ada</b>",
    });

    expect(message.html).not.toContain("<script>");
    expect(message.html).not.toContain("<b>Ada</b>");
    expect(message.html).toContain("&lt;script&gt;");
  });
});

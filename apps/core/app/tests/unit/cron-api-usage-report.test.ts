// @vitest-environment node
/**
 * #2039: the api-usage-report job emails admins a daily summary of granted API
 * key use and flags heavy use. Pinned here: who is included, the heavy-use rule,
 * recipients, the Admin → Logs entry, the email, and the run message.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  groupBy: vi.fn(),
  grantFindMany: vi.fn(),
  userFindMany: vi.fn(),
  getCronJobSetting: vi.fn(),
  createSystemLog: vi.fn(),
  sendEmail: vi.fn(),
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    apiRequestLog: { groupBy: mocks.groupBy },
    apiAccessGrant: { findMany: mocks.grantFindMany },
    user: { findMany: mocks.userFindMany },
  },
}));
vi.mock("~/lib/auth/server", () => ({ authBaseURL: "https://my.eduai.test" }));
vi.mock("~/lib/db.cron-jobs.server", () => ({ getCronJobSetting: mocks.getCronJobSetting }));
vi.mock("~/lib/db.systemlog.server", () => ({ createSystemLog: mocks.createSystemLog }));
vi.mock("~/lib/email/mailer.server", () => ({ sendEmail: mocks.sendEmail }));

const { collectApiUsage, formatApiUsageReportMessage, runApiUsageReport, API_USAGE_REPORT_JOB } =
  await import("~/lib/cron-api-usage-report.server");
const { buildApiUsageReportEmail } = await import("~/lib/email/templates/api-usage-report");

const NOW = new Date("2026-10-22T15:00:00.000Z");
const savedEnv = { ...process.env };

type GrantOverrides = Partial<{ dailyRequestLimit: number; createdAt: Date }>;

function grant(userId: string, overrides: GrantOverrides = {}) {
  return {
    id: `g-${userId}`,
    userId,
    purpose: `Project of ${userId}`,
    dailyRequestLimit: 200,
    dailyTokenLimit: 200_000,
    createdAt: new Date("2026-10-01"),
    user: { name: `Name ${userId}`, email: `${userId}@student.ubc.ca` },
    ...overrides,
  };
}

/** `counted` rows, then `refused` rows, as the two groupBy calls return them. */
function usage(
  counted: Array<{ userId: string; requests: number; tokens: number | null }>,
  refused: Array<{ userId: string; requests: number }> = [],
) {
  mocks.groupBy
    .mockResolvedValueOnce(
      counted.map((r) => ({
        userId: r.userId,
        _count: { _all: r.requests },
        _sum: { totalTokens: r.tokens },
      })),
    )
    .mockResolvedValueOnce(
      refused.map((r) => ({ userId: r.userId, _count: { _all: r.requests } })),
    );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.groupBy.mockReset();
  mocks.getCronJobSetting.mockResolvedValue(80);
  mocks.userFindMany.mockResolvedValue([{ email: "admin@ubc.ca" }]);
  mocks.sendEmail.mockResolvedValue({ delivered: true });
  mocks.createSystemLog.mockResolvedValue(undefined);
  delete process.env.API_USAGE_REPORT_EMAILS;
});

afterEach(() => {
  process.env = { ...savedEnv };
});

describe("collectApiUsage", () => {
  it("counts the last 24 hours of granted-key requests, refused ones apart", async () => {
    usage([{ userId: "s1", requests: 10, tokens: 5_000 }], [{ userId: "s1", requests: 0 }]);
    mocks.grantFindMany.mockResolvedValue([grant("s1")]);

    await collectApiUsage(NOW, 80);

    const since = new Date("2026-10-21T15:00:00.000Z");
    expect(mocks.groupBy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          createdAt: { gte: since },
          grantId: { not: null },
          status: { notIn: [429, 503] },
        },
      }),
    );
    expect(mocks.groupBy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: { createdAt: { gte: since }, grantId: { not: null }, status: { in: [429, 503] } },
      }),
    );
  });

  it("flags heavy use at the threshold of either limit, or any refusal, and lists it first", async () => {
    usage(
      [
        { userId: "light", requests: 10, tokens: 1_000 },
        { userId: "requests", requests: 160, tokens: 1_000 },
        { userId: "tokens", requests: 5, tokens: 160_000 },
      ],
      [{ userId: "refused", requests: 3 }],
    );
    mocks.grantFindMany.mockResolvedValue([
      grant("light"),
      grant("requests"),
      grant("tokens"),
      grant("refused"),
    ]);

    const lines = await collectApiUsage(NOW, 80);

    expect(lines.map((l) => [l.email, l.heavy])).toEqual([
      ["tokens@student.ubc.ca", true],
      ["requests@student.ubc.ca", true],
      ["refused@student.ubc.ca", true],
      ["light@student.ubc.ca", false],
    ]);
    expect(lines.find((l) => l.email.startsWith("refused"))).toMatchObject({
      requests: 0,
      tokens: 0,
      refused: 3,
    });
  });

  it("uses the person's latest grant for the limits", async () => {
    usage([{ userId: "s1", requests: 100, tokens: 0 }]);
    mocks.grantFindMany.mockResolvedValue([
      grant("s1", { dailyRequestLimit: 1_000, createdAt: new Date("2026-10-20") }),
      grant("s1", { dailyRequestLimit: 100, createdAt: new Date("2026-09-01") }),
    ]);
    const [line] = await collectApiUsage(NOW, 80);
    expect(line).toMatchObject({ requestLimit: 1_000, heavy: false });
    expect(mocks.grantFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { createdAt: "desc" } }),
    );
  });

  it("returns nothing, without loading grants, when nobody used a key", async () => {
    usage([]);
    await expect(collectApiUsage(NOW, 80)).resolves.toEqual([]);
    expect(mocks.grantFindMany).not.toHaveBeenCalled();
  });
});

describe("runApiUsageReport", () => {
  it("does nothing on a day with no use", async () => {
    usage([]);
    await expect(runApiUsageReport({ now: NOW })).resolves.toEqual({
      people: 0,
      heavy: 0,
      emailed: 0,
      undelivered: false,
    });
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    expect(mocks.createSystemLog).not.toHaveBeenCalled();
    expect(mocks.getCronJobSetting).toHaveBeenCalledWith(API_USAGE_REPORT_JOB, "heavyUsePercent");
  });

  it("emails the active admins the summary, without a log entry when nobody is heavy", async () => {
    usage([{ userId: "s1", requests: 10, tokens: 5_000 }]);
    mocks.grantFindMany.mockResolvedValue([grant("s1")]);

    const result = await runApiUsageReport({ now: NOW });

    expect(result).toEqual({ people: 1, heavy: 0, emailed: 1, undelivered: false });
    expect(mocks.sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "admin@ubc.ca",
        subject: "[EduAI] API key use: 1 person in the last 24 hours",
      }),
    );
    expect(mocks.createSystemLog).not.toHaveBeenCalled();
  });

  it("logs heavy use and sends to API_USAGE_REPORT_EMAILS instead of the admins", async () => {
    process.env.API_USAGE_REPORT_EMAILS = "list@ubc.ca, list@ubc.ca ,other@ubc.ca";
    usage([{ userId: "s1", requests: 190, tokens: 5_000 }]);
    mocks.grantFindMany.mockResolvedValue([grant("s1")]);

    const result = await runApiUsageReport({ now: NOW });

    expect(result).toMatchObject({ people: 1, heavy: 1, emailed: 2 });
    expect(mocks.userFindMany).not.toHaveBeenCalled();
    expect(mocks.sendEmail.mock.calls.map(([m]) => m.to)).toEqual(["list@ubc.ca", "other@ubc.ca"]);
    expect(mocks.createSystemLog).toHaveBeenCalledWith(
      expect.objectContaining({ level: "WARN", source: "API", code: "API_ACCESS_HEAVY_USE" }),
    );
  });

  it("reports undelivered only when every send throws", async () => {
    usage([{ userId: "s1", requests: 1, tokens: 1 }]);
    mocks.grantFindMany.mockResolvedValue([grant("s1")]);
    mocks.sendEmail.mockRejectedValue(new Error("SMTP down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(runApiUsageReport({ now: NOW })).resolves.toMatchObject({
      emailed: 0,
      undelivered: true,
    });
  });
});

describe("formatApiUsageReportMessage", () => {
  it.each([
    [
      { people: 0, heavy: 0, emailed: 0, undelivered: false },
      "No API key use by granted users in the last 24 hours",
    ],
    [
      { people: 2, heavy: 1, emailed: 3, undelivered: false },
      "2 people used API keys — 1 heavy — report emailed to 3 recipient(s)",
    ],
    [
      { people: 1, heavy: 0, emailed: 0, undelivered: false },
      "1 person used API keys — 0 heavy — report not emailed (email not set up or no recipients)",
    ],
    [
      { people: 1, heavy: 0, emailed: 0, undelivered: true },
      "1 person used API keys — 0 heavy — every report email failed to send",
    ],
  ])("%o → %s", (result, message) => {
    expect(formatApiUsageReportMessage(result)).toBe(message);
  });
});

describe("buildApiUsageReportEmail", () => {
  const line = {
    name: "Sam <b>Student</b>",
    email: "sam@student.ubc.ca",
    purpose: "Judge runs",
    requests: 190,
    requestLimit: 200,
    tokens: 5_000,
    tokenLimit: 200_000,
    refused: 2,
    heavy: true,
  };

  it("leads with heavy use and links to the API access page", () => {
    const email = buildApiUsageReportEmail({
      to: "admin@ubc.ca",
      lines: [line],
      heavyUsePercent: 80,
      manageUrl: "https://my.eduai.test/admin/api-access",
    });
    expect(email.subject).toBe("[EduAI] API key use: 1 person near their limit");
    expect(email.text).toContain("190/200 requests, 5,000/200,000 tokens, 2 refused (HEAVY USE)");
    expect(email.text).toContain("https://my.eduai.test/admin/api-access");
    expect(email.html).toContain("Sam &lt;b&gt;Student&lt;/b&gt;");
    expect(email.html).not.toContain("<b>Student</b>");
  });
});

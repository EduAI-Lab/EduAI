// @vitest-environment node
// Admin-approved API access for non-admins (#2039): who may manage keys, the
// rolling daily limits, and granting/revoking.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    user: { findUnique: vi.fn() },
    apiAccessGrant: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    apiRequestLog: { aggregate: vi.fn(), findMany: vi.fn(), groupBy: vi.fn() },
    apikey: { updateMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
  },
}));

import type { ApiAccessGrant } from "@prisma/client";
import prisma from "~/lib/prisma.server";
import { apiKeyManagementDenial } from "~/lib/api-keys/access.server";
import {
  ApiAccessGrantError,
  checkApiAccessLimits,
  createApiAccessGrant,
  getActiveApiAccessGrant,
  listApiAccessGrants,
  revokeApiAccessGrant,
} from "~/lib/api-keys/access-grants.server";

const NOW = new Date("2026-10-21T12:00:00Z");
const DAY_S = 24 * 60 * 60;

const grant = {
  id: "g1",
  userId: "s1",
  expiresAt: new Date("2026-12-31T00:00:00Z"),
  dailyRequestLimit: 200,
  dailyTokenLimit: 200_000,
};

function asUser(role: string, isActive = true) {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({ role, isActive } as never);
}

function usage(requests: number, tokens: number | null) {
  vi.mocked(prisma.apiRequestLog.aggregate).mockResolvedValue({
    _count: { _all: requests },
    _sum: { totalTokens: tokens },
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.apiAccessGrant.findFirst).mockResolvedValue(null);
  // An interactive transaction runs its callback against the same mocked client.
  // (The revoke tests, which pass an array, set their own result.)
  vi.mocked(prisma.$transaction).mockImplementation(((callback: TransactionCallback) =>
    callback(prisma)) as never);
});

type TransactionCallback = (tx: typeof prisma) => Promise<ApiAccessGrant>;

/** Counted rows in the window, oldest first, as `checkApiAccessLimits` reads them. */
function windowRows(rows: Array<[iso: string, tokens: number]>) {
  vi.mocked(prisma.apiRequestLog.findMany).mockResolvedValue(
    rows.map(([iso, totalTokens]) => ({ createdAt: new Date(iso), totalTokens })) as never,
  );
}

describe("getActiveApiAccessGrant", () => {
  it("looks only at unrevoked, unexpired grants", async () => {
    vi.mocked(prisma.apiAccessGrant.findFirst).mockResolvedValue(grant as never);
    await expect(getActiveApiAccessGrant("s1", NOW)).resolves.toEqual(grant);
    expect(prisma.apiAccessGrant.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "s1", revokedAt: null, expiresAt: { gt: NOW } },
      }),
    );
  });

  it("returns null without a user id", async () => {
    await expect(getActiveApiAccessGrant(null)).resolves.toBeNull();
    expect(prisma.apiAccessGrant.findFirst).not.toHaveBeenCalled();
  });
});

describe("apiKeyManagementDenial", () => {
  it("lets an active admin call every key endpoint", async () => {
    asUser("ADMIN");
    await expect(apiKeyManagementDenial("a1", "/api-key/update", null, NOW)).resolves.toBeNull();
  });

  it("refuses a student with no grant", async () => {
    asUser("STUDENT");
    await expect(apiKeyManagementDenial("s1", "/api-key/list", null, NOW)).resolves.toBe(
      "API key management restricted to admin users",
    );
  });

  it("refuses an anonymous caller", async () => {
    await expect(apiKeyManagementDenial(null, "/api-key/list", null, NOW)).resolves.toMatch(
      /restricted/,
    );
  });

  it("lets a granted student list, view and delete their keys", async () => {
    asUser("STUDENT");
    vi.mocked(prisma.apiAccessGrant.findFirst).mockResolvedValue(grant as never);
    for (const path of ["/api-key/list", "/api-key/get", "/api-key/delete"]) {
      await expect(apiKeyManagementDenial("s1", path, null, NOW)).resolves.toBeNull();
    }
  });

  it("refuses a granted student updating a key", async () => {
    asUser("STUDENT");
    vi.mocked(prisma.apiAccessGrant.findFirst).mockResolvedValue(grant as never);
    await expect(apiKeyManagementDenial("s1", "/api-key/update", null, NOW)).resolves.toBe(
      "Only an admin can change an API key",
    );
  });

  it("lets a granted student create a key that ends before the grant", async () => {
    asUser("STUDENT");
    vi.mocked(prisma.apiAccessGrant.findFirst).mockResolvedValue(grant as never);
    await expect(
      apiKeyManagementDenial("s1", "/api-key/create", 30 * DAY_S, NOW),
    ).resolves.toBeNull();
  });

  it("refuses a key that would outlive the grant, naming the end date", async () => {
    asUser("STUDENT");
    vi.mocked(prisma.apiAccessGrant.findFirst).mockResolvedValue(grant as never);
    await expect(apiKeyManagementDenial("s1", "/api-key/create", 365 * DAY_S, NOW)).resolves.toBe(
      "Your key can't expire after your API access ends (2026-12-31)",
    );
  });

  it("refuses a key with no expiry", async () => {
    asUser("STUDENT");
    vi.mocked(prisma.apiAccessGrant.findFirst).mockResolvedValue(grant as never);
    await expect(apiKeyManagementDenial("s1", "/api-key/create", null, NOW)).resolves.toBe(
      "API keys must have an expiration date",
    );
  });

  it("refuses a deactivated student even with a grant", async () => {
    asUser("STUDENT", false);
    vi.mocked(prisma.apiAccessGrant.findFirst).mockResolvedValue(grant as never);
    await expect(apiKeyManagementDenial("s1", "/api-key/list", null, NOW)).resolves.toMatch(
      /restricted/,
    );
  });
});

describe("checkApiAccessLimits", () => {
  it("allows a request under both limits", async () => {
    usage(10, 5_000);
    await expect(checkApiAccessLimits(grant, NOW)).resolves.toEqual({
      ok: true,
      usage: { requests: 10, tokens: 5_000 },
    });
  });

  it("counts only the last 24 hours and skips requests the limits refused", async () => {
    usage(0, null);
    await checkApiAccessLimits(grant, NOW);
    expect(prisma.apiRequestLog.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: "s1",
          createdAt: { gte: new Date("2026-10-20T12:00:00Z") },
          status: { notIn: [429, 503] },
        },
      }),
    );
  });

  it("stops at the request limit and retries when the oldest request leaves the window", async () => {
    usage(200, 1_000);
    windowRows([
      ["2026-10-20T13:00:00Z", 5],
      ...Array.from({ length: 199 }, (): [string, number] => ["2026-10-21T10:00:00Z", 5]),
    ]);
    await expect(checkApiAccessLimits(grant, NOW)).resolves.toEqual({
      ok: false,
      limit: "requests",
      usage: { requests: 200, tokens: 1_000 },
      retryAfter: 3600,
    });
  });

  // #2040 review: at the token limit the oldest request may be a small one, so
  // retrying when it ages out would still be over the limit.
  it("at the token limit, waits until enough tokens have aged out", async () => {
    usage(3, 250_000);
    windowRows([
      ["2026-10-20T13:00:00Z", 1_000], // ages out in 1h; 249,000 left, still over
      ["2026-10-20T14:00:00Z", 150_000], // ages out in 2h; 99,000 left, under the limit
      ["2026-10-21T11:00:00Z", 99_000],
    ]);
    await expect(checkApiAccessLimits(grant, NOW)).resolves.toMatchObject({
      ok: false,
      limit: "tokens",
      retryAfter: 2 * 3600,
    });
  });

  it("falls back to the oldest request when the rows changed between reads", async () => {
    usage(200, 0);
    windowRows([["2026-10-20T13:00:00Z", 0]]);
    await expect(checkApiAccessLimits(grant, NOW)).resolves.toMatchObject({
      ok: false,
      retryAfter: 3600,
    });
  });
});

describe("createApiAccessGrant", () => {
  const input = {
    userId: "s1",
    grantedById: "a1",
    purpose: "Honours project",
    expiresAt: new Date("2026-12-31T00:00:00Z"),
    dailyRequestLimit: 200,
    dailyTokenLimit: 200_000,
  };

  it("creates a grant for an active student", async () => {
    asUser("STUDENT");
    vi.mocked(prisma.apiAccessGrant.create).mockResolvedValue({ id: "g1", ...input } as never);
    await expect(createApiAccessGrant(input, NOW)).resolves.toMatchObject({ id: "g1" });
    expect(prisma.apiAccessGrant.create).toHaveBeenCalledWith({ data: input });
  });

  it.each([
    ["an admin", () => asUser("ADMIN"), 400, /already have API access/],
    ["a deactivated account", () => asUser("STUDENT", false), 400, /deactivated/],
    [
      "a missing user",
      () => vi.mocked(prisma.user.findUnique).mockResolvedValue(null),
      404,
      /not found/,
    ],
  ])("refuses %s", async (_label, arrange, status, message) => {
    arrange();
    const attempt = createApiAccessGrant(input, NOW);
    await expect(attempt).rejects.toBeInstanceOf(ApiAccessGrantError);
    await expect(attempt).rejects.toMatchObject({
      status,
      message: expect.stringMatching(message),
    });
    expect(prisma.apiAccessGrant.create).not.toHaveBeenCalled();
  });

  // #2040 review: a double-clicked "Give access" must not create two grants.
  it("checks and inserts in one transaction under a per-user lock", async () => {
    asUser("STUDENT");
    vi.mocked(prisma.apiAccessGrant.create).mockResolvedValue({ id: "g1" } as never);
    await createApiAccessGrant(input, NOW);
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function));
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const [sql, lockKey] = vi.mocked(prisma.$executeRaw).mock.calls[0];
    // SAFETY: a tagged-template call passes the template strings first.
    expect((sql as TemplateStringsArray).join("?")).toContain("pg_advisory_xact_lock(hashtext(?))");
    expect(lockKey).toBe("api-access-grant:s1");
    expect(vi.mocked(prisma.$executeRaw).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(prisma.apiAccessGrant.findFirst).mock.invocationCallOrder[0],
    );
  });

  it("refuses a second active grant with 409", async () => {
    asUser("STUDENT");
    vi.mocked(prisma.apiAccessGrant.findFirst).mockResolvedValue(grant as never);
    await expect(createApiAccessGrant(input, NOW)).rejects.toMatchObject({ status: 409 });
  });

  it("refuses an end date in the past or more than a year away", async () => {
    asUser("STUDENT");
    await expect(
      createApiAccessGrant({ ...input, expiresAt: new Date("2026-10-01") }, NOW),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createApiAccessGrant({ ...input, expiresAt: new Date("2028-01-01") }, NOW),
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe("revokeApiAccessGrant", () => {
  it("ends the grant and disables the user's keys in one transaction", async () => {
    vi.mocked(prisma.apiAccessGrant.findUnique).mockResolvedValue({
      ...grant,
      revokedAt: null,
    } as never);
    vi.mocked(prisma.apiAccessGrant.update).mockReturnValue("update-op" as never);
    vi.mocked(prisma.apiAccessGrant.updateMany).mockReturnValue("end-others-op" as never);
    vi.mocked(prisma.apikey.updateMany).mockReturnValue("disable-op" as never);
    vi.mocked(prisma.$transaction).mockResolvedValue([{ ...grant, revokedAt: NOW }] as never);

    await expect(revokeApiAccessGrant("g1", "a1", NOW)).resolves.toMatchObject({ revokedAt: NOW });
    expect(prisma.apiAccessGrant.update).toHaveBeenCalledWith({
      where: { id: "g1" },
      data: { revokedAt: NOW, revokedById: "a1" },
    });
    // Any other active grant the user holds ends too.
    expect(prisma.apiAccessGrant.updateMany).toHaveBeenCalledWith({
      where: { userId: "s1", revokedAt: null, expiresAt: { gt: NOW } },
      data: { revokedAt: NOW, revokedById: "a1" },
    });
    expect(prisma.apikey.updateMany).toHaveBeenCalledWith({
      where: { referenceId: "s1" },
      data: { enabled: false },
    });
    expect(prisma.$transaction).toHaveBeenCalledWith(["update-op", "end-others-op", "disable-op"]);
  });

  it("leaves an already revoked grant alone", async () => {
    vi.mocked(prisma.apiAccessGrant.findUnique).mockResolvedValue({
      ...grant,
      revokedAt: NOW,
    } as never);
    await revokeApiAccessGrant("g1", "a1", NOW);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("404s an unknown grant", async () => {
    vi.mocked(prisma.apiAccessGrant.findUnique).mockResolvedValue(null);
    await expect(revokeApiAccessGrant("nope", "a1", NOW)).rejects.toMatchObject({ status: 404 });
  });
});

describe("listApiAccessGrants", () => {
  const row = (id: string, userId: string, revokedAt: Date | null = null) => ({
    ...grant,
    id,
    userId,
    revokedAt,
    user: { id: userId, name: userId, email: `${userId}@ubc.ca`, role: "STUDENT" },
  });

  // #2040 review: one grouped usage query, not one per grant.
  it("reads everyone's usage in one grouped query", async () => {
    vi.mocked(prisma.apiAccessGrant.findMany).mockResolvedValue([
      row("g1", "s1"),
      row("g2", "s2"),
      row("g0", "s1", NOW),
    ] as never);
    vi.mocked(prisma.apiRequestLog.groupBy).mockResolvedValue([
      { userId: "s1", _count: { _all: 4 }, _sum: { totalTokens: 900 } },
    ] as never);

    const grants = await listApiAccessGrants({ includeInactive: true }, NOW);

    expect(prisma.apiRequestLog.groupBy).toHaveBeenCalledTimes(1);
    expect(prisma.apiRequestLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ["userId"],
        where: expect.objectContaining({ userId: { in: ["s1", "s2"] } }),
      }),
    );
    expect(grants.map((g) => [g.id, g.active, g.usageLast24h])).toEqual([
      ["g1", true, { requests: 4, tokens: 900 }],
      ["g2", true, { requests: 0, tokens: 0 }],
      ["g0", false, { requests: 4, tokens: 900 }],
    ]);
    expect(prisma.apiAccessGrant.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {}, take: 500 }),
    );
  });

  it("skips the usage query when there are no grants", async () => {
    vi.mocked(prisma.apiAccessGrant.findMany).mockResolvedValue([]);
    await expect(listApiAccessGrants({}, NOW)).resolves.toEqual([]);
    expect(prisma.apiRequestLog.groupBy).not.toHaveBeenCalled();
  });
});

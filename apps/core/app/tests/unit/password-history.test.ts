// @vitest-environment node

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    passwordHistory: {
      findMany: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import prisma from "~/lib/prisma.server";
import {
  isPasswordReused,
  recordPasswordHistory,
  PASSWORD_HISTORY_LIMIT,
} from "~/lib/auth/password-history.server";

const alwaysMatch = async () => true;
const neverMatch = async () => false;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isPasswordReused", () => {
  it("returns false when the user has no history rows and no current credential hash", async () => {
    vi.mocked(prisma.passwordHistory.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);

    const result = await isPasswordReused({
      userId: "u1",
      candidate: "Abcdef1!",
      verify: neverMatch,
    });

    expect(result).toBe(false);
  });

  it("returns true when the candidate matches a history hash", async () => {
    vi.mocked(prisma.passwordHistory.findMany).mockResolvedValue([
      { id: "h1", userId: "u1", passwordHash: "hash-old", createdAt: new Date() },
    ] as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);

    const result = await isPasswordReused({
      userId: "u1",
      candidate: "Abcdef1!",
      verify: alwaysMatch,
    });

    expect(result).toBe(true);
  });

  it("returns true when the candidate matches the current credential hash (not yet in history)", async () => {
    vi.mocked(prisma.passwordHistory.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      accounts: [{ providerId: "credential", password: "current-hash" }],
    } as never);

    const result = await isPasswordReused({
      userId: "u1",
      candidate: "Abcdef1!",
      verify: alwaysMatch,
    });

    expect(result).toBe(true);
  });

  it("returns false when the candidate matches nothing", async () => {
    vi.mocked(prisma.passwordHistory.findMany).mockResolvedValue([
      { id: "h1", userId: "u1", passwordHash: "hash-old", createdAt: new Date() },
    ] as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      accounts: [{ providerId: "credential", password: "current-hash" }],
    } as never);

    const result = await isPasswordReused({
      userId: "u1",
      candidate: "NewValid1!",
      verify: neverMatch,
    });

    expect(result).toBe(false);
  });
});

describe("recordPasswordHistory", () => {
  it("creates a history row and does not prune when under the limit", async () => {
    vi.mocked(prisma.passwordHistory.findMany).mockResolvedValue(
      Array.from({ length: 5 }, (_, i) => ({
        id: `h${i}`,
        userId: "u1",
        passwordHash: `h${i}`,
        createdAt: new Date(),
      })) as never,
    );
    vi.mocked(prisma.passwordHistory.create).mockResolvedValue({} as never);
    vi.mocked(prisma.passwordHistory.deleteMany).mockResolvedValue({ count: 0 } as never);

    await recordPasswordHistory({ userId: "u1", passwordHash: "new-hash" });

    expect(prisma.passwordHistory.create).toHaveBeenCalledWith({
      data: { userId: "u1", passwordHash: "new-hash" },
    });
    expect(prisma.passwordHistory.deleteMany).not.toHaveBeenCalled();
  });

  it("prunes oldest rows when history exceeds the limit after insert", async () => {
    // After create, the re-query returns LIMIT+1 rows (the new one is now included)
    const rowsAfterInsert = Array.from({ length: PASSWORD_HISTORY_LIMIT + 1 }, (_, i) => ({
      id: `h${i}`,
      userId: "u1",
      passwordHash: `h${i}`,
      createdAt: new Date(Date.now() - i * 1000),
    }));
    vi.mocked(prisma.passwordHistory.findMany).mockResolvedValue(rowsAfterInsert as never);
    vi.mocked(prisma.passwordHistory.create).mockResolvedValue({} as never);
    vi.mocked(prisma.passwordHistory.deleteMany).mockResolvedValue({ count: 1 } as never);

    await recordPasswordHistory({ userId: "u1", passwordHash: "new-hash" });

    expect(prisma.passwordHistory.create).toHaveBeenCalled();
    // The oldest row (last in desc-order slice) should be pruned
    expect(prisma.passwordHistory.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: expect.any(Array) } }) }),
    );
  });
});

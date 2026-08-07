// @vitest-environment node

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
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
  it("returns false when the user has no history rows and no current credential hash, and never calls verify", async () => {
    vi.mocked(prisma.passwordHistory.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);
    const verify = vi.fn(neverMatch);

    const result = await isPasswordReused({
      userId: "u1",
      candidate: "Abcdef1!",
      verify,
    });

    expect(result).toBe(false);
    // Guards against the empty-history fallback array being seeded with a phantom entry.
    expect(verify).not.toHaveBeenCalled();
  });

  it("queries password history and the current credential account with the expected shape", async () => {
    vi.mocked(prisma.passwordHistory.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);

    await isPasswordReused({ userId: "u1", candidate: "Abcdef1!", verify: neverMatch });

    expect(prisma.passwordHistory.findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      orderBy: { createdAt: "desc" },
      take: PASSWORD_HISTORY_LIMIT,
      select: { passwordHash: true },
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "u1" },
      select: {
        accounts: { where: { providerId: "credential" }, select: { password: true } },
      },
    });
  });

  it("returns true when the candidate matches a history hash, verifying against that row's real hash", async () => {
    vi.mocked(prisma.passwordHistory.findMany).mockResolvedValue([
      { id: "h1", userId: "u1", passwordHash: "hash-old", createdAt: new Date() },
    ] as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);
    const verify = vi.fn(async ({ hash }: { hash: string }) => hash === "hash-old");

    const result = await isPasswordReused({
      userId: "u1",
      candidate: "Abcdef1!",
      verify,
    });

    expect(result).toBe(true);
    expect(verify).toHaveBeenCalledWith({ password: "Abcdef1!", hash: "hash-old" });
  });

  it("checks each history row against its own hash, not a placeholder shared across rows", async () => {
    vi.mocked(prisma.passwordHistory.findMany).mockResolvedValue([
      { id: "h1", userId: "u1", passwordHash: "wrong-1", createdAt: new Date() },
      { id: "h2", userId: "u1", passwordHash: "correct", createdAt: new Date() },
    ] as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null as never);
    const verify = vi.fn(async ({ hash }: { hash: string }) => hash === "correct");

    const result = await isPasswordReused({
      userId: "u1",
      candidate: "Abcdef1!",
      verify,
    });

    expect(result).toBe(true);
  });

  it("does not crash when the user is found but has no credential account (empty accounts array)", async () => {
    vi.mocked(prisma.passwordHistory.findMany).mockResolvedValue([]);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ accounts: [] } as never);

    const result = await isPasswordReused({
      userId: "u1",
      candidate: "Abcdef1!",
      verify: neverMatch,
    });

    expect(result).toBe(false);
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
    expect(prisma.passwordHistory.findMany).toHaveBeenCalledWith({
      where: { userId: "u1" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    expect(prisma.passwordHistory.deleteMany).not.toHaveBeenCalled();
  });

  it("does not prune when history is exactly at the limit", async () => {
    vi.mocked(prisma.passwordHistory.findMany).mockResolvedValue(
      Array.from({ length: PASSWORD_HISTORY_LIMIT }, (_, i) => ({
        id: `h${i}`,
        userId: "u1",
        passwordHash: `h${i}`,
        createdAt: new Date(),
      })) as never,
    );
    vi.mocked(prisma.passwordHistory.create).mockResolvedValue({} as never);
    vi.mocked(prisma.passwordHistory.deleteMany).mockResolvedValue({ count: 0 } as never);

    await recordPasswordHistory({ userId: "u1", passwordHash: "new-hash" });

    expect(prisma.passwordHistory.deleteMany).not.toHaveBeenCalled();
  });

  it("prunes exactly the oldest row(s) beyond the limit, by id", async () => {
    // After create, the re-query returns LIMIT+1 rows (the new one is now included),
    // newest first (desc createdAt) — only the last row (h10) is past the limit.
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

    expect(prisma.passwordHistory.create).toHaveBeenCalledWith({
      data: { userId: "u1", passwordHash: "new-hash" },
    });
    expect(prisma.passwordHistory.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: [`h${PASSWORD_HISTORY_LIMIT}`] } },
    });
  });
});

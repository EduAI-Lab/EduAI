// @vitest-environment node

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    account: {
      findFirst: vi.fn(),
    },
  },
}));

import prisma from "~/lib/prisma.server";
import {
  PASSWORD_EXPIRY_DAYS,
  isPasswordExpired,
  isPasswordExpiredForUser,
  getPasswordChangedAt,
  getExpiredPasswordRedirect,
  invalidatePasswordExpiryCache,
} from "~/lib/auth/password-expiry.server";

beforeEach(() => {
  vi.clearAllMocks();
  invalidatePasswordExpiryCache();
});

describe("isPasswordExpired", () => {
  it("returns false when passwordChangedAt is null (not yet tracked)", () => {
    expect(isPasswordExpired(null)).toBe(false);
  });

  it("returns false when changed today", () => {
    expect(isPasswordExpired(new Date())).toBe(false);
  });

  it("returns false when changed exactly at the expiry boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-20T12:00:00.000Z"));
    try {
      const boundary = new Date();
      boundary.setDate(boundary.getDate() - PASSWORD_EXPIRY_DAYS);
      expect(isPasswordExpired(boundary)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns true when changed one day past the expiry window", () => {
    const expired = new Date();
    expired.setDate(expired.getDate() - (PASSWORD_EXPIRY_DAYS + 1));
    expect(isPasswordExpired(expired)).toBe(true);
  });

  it("returns true when changed two years ago", () => {
    const old = new Date();
    old.setFullYear(old.getFullYear() - 2);
    expect(isPasswordExpired(old)).toBe(true);
  });
});

describe("getPasswordChangedAt", () => {
  it("returns null when the user has no credential account", async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue(null as never);
    expect(await getPasswordChangedAt("user-1")).toBeNull();
  });

  it("returns null when the credential account has no passwordChangedAt", async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      passwordChangedAt: null,
    } as never);
    expect(await getPasswordChangedAt("user-1")).toBeNull();
  });

  it("returns the date when passwordChangedAt is set", async () => {
    const date = new Date("2025-01-01");
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      passwordChangedAt: date,
    } as never);
    expect(await getPasswordChangedAt("user-1")).toEqual(date);
  });
});

// AUTH-06: this cached boolean is the shared primitive behind both the
// page-loader redirect (below) and the `/api/*` middleware guard in
// `root.tsx`.
describe("isPasswordExpiredForUser", () => {
  it("returns false when the password is not expired", async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      passwordChangedAt: new Date(),
    } as never);

    expect(await isPasswordExpiredForUser("user-1")).toBe(false);
  });

  it("returns true when the password is expired", async () => {
    const old = new Date();
    old.setFullYear(old.getFullYear() - 2);
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      passwordChangedAt: old,
    } as never);

    expect(await isPasswordExpiredForUser("user-1")).toBe(true);
  });

  it("shares its cache with getExpiredPasswordRedirect (single DB lookup)", async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      passwordChangedAt: new Date(),
    } as never);

    await getExpiredPasswordRedirect("user-1");
    await isPasswordExpiredForUser("user-1");

    expect(prisma.account.findFirst).toHaveBeenCalledTimes(1);
  });
});

describe("getExpiredPasswordRedirect", () => {
  it("returns null when the password is not expired", async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      passwordChangedAt: new Date(),
    } as never);

    expect(await getExpiredPasswordRedirect("user-1")).toBeNull();
    expect(prisma.account.findFirst).toHaveBeenCalledTimes(1);
  });

  it("returns a redirect when the password is expired", async () => {
    const old = new Date();
    old.setFullYear(old.getFullYear() - 2);
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      passwordChangedAt: old,
    } as never);

    const res = await getExpiredPasswordRedirect("user-1");
    expect(res?.status).toBe(302);
    expect(res?.headers.get("Location")).toBe("/settings?expired=1");
  });

  it("serves cached expiry state without a second DB lookup", async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      passwordChangedAt: new Date(),
    } as never);

    await getExpiredPasswordRedirect("user-1");
    await getExpiredPasswordRedirect("user-1");

    expect(prisma.account.findFirst).toHaveBeenCalledTimes(1);
  });

  it("re-queries after the cache is invalidated", async () => {
    vi.mocked(prisma.account.findFirst).mockResolvedValue({
      passwordChangedAt: new Date(),
    } as never);

    await getExpiredPasswordRedirect("user-1");
    invalidatePasswordExpiryCache("user-1");
    await getExpiredPasswordRedirect("user-1");

    expect(prisma.account.findFirst).toHaveBeenCalledTimes(2);
  });
});

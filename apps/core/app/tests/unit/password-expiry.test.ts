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
  getPasswordChangedAt,
} from "~/lib/auth/password-expiry.server";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isPasswordExpired", () => {
  it("returns false when passwordChangedAt is null (not yet tracked)", () => {
    expect(isPasswordExpired(null)).toBe(false);
  });

  it("returns false when changed today", () => {
    expect(isPasswordExpired(new Date())).toBe(false);
  });

  it("returns false when changed exactly at the expiry boundary", () => {
    const boundary = new Date();
    boundary.setDate(boundary.getDate() - PASSWORD_EXPIRY_DAYS);
    expect(isPasswordExpired(boundary)).toBe(false);
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

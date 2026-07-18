import { describe, it, expect, beforeEach, vi } from "vitest";
import { isActiveAdminUser } from "~/lib/api-keys/access.server";
import prisma from "~/lib/prisma.server";

vi.mock("~/lib/prisma.server", () => ({
  default: {
    user: { findUnique: vi.fn() },
  },
}));

describe("isActiveAdminUser", () => {
  beforeEach(() => {
    vi.mocked(prisma.user.findUnique).mockReset();
  });

  it("returns false when user id is missing", async () => {
    expect(await isActiveAdminUser(null)).toBe(false);
    expect(await isActiveAdminUser(undefined)).toBe(false);
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("returns true for an active admin", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "ADMIN",
      isActive: true,
    } as never);
    expect(await isActiveAdminUser("admin-1")).toBe(true);
  });

  it("returns false for an inactive admin", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "ADMIN",
      isActive: false,
    } as never);
    expect(await isActiveAdminUser("admin-1")).toBe(false);
  });

  it("returns false for a non-admin user", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "STUDENT",
      isActive: true,
    } as never);
    expect(await isActiveAdminUser("student-1")).toBe(false);
  });

  it("returns false when the user record is missing", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    expect(await isActiveAdminUser("missing-user")).toBe(false);
  });
});

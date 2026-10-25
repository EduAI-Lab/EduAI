// @vitest-environment node
// #1900: one-click sign-in as non-admin test accounts on the shared dev server.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/prisma.server", () => ({ default: { user: { findUnique: vi.fn() } } }));

import prisma from "~/lib/prisma.server";
import {
  DEV_QUICK_LOGIN_ACCOUNTS,
  devQuickLoginOptions,
  devQuickLoginPassword,
  resetDevQuickLoginWarningForTests,
  resolveDevQuickLogin,
} from "~/lib/auth/dev-quick-login.server";

const DEV = {
  EDUAI_DEV_QUICK_LOGIN: "true",
  EDUAI_DEV_QUICK_LOGIN_PASSWORD: "dev-only-password",
  BETTER_AUTH_URL: "https://dev.eduai.ok.ubc.ca",
};

beforeEach(() => {
  vi.clearAllMocks();
  resetDevQuickLoginWarningForTests();
});
afterEach(() => vi.restoreAllMocks());

describe("devQuickLoginPassword", () => {
  it("is available on dev with the switch and a password set", () => {
    expect(devQuickLoginPassword(DEV)).toBe("dev-only-password");
    expect(devQuickLoginPassword({ ...DEV, BETTER_AUTH_URL: "http://localhost:3000" })).toBe(
      "dev-only-password",
    );
  });

  it.each([
    ["the switch off", { ...DEV, EDUAI_DEV_QUICK_LOGIN: "false" }],
    ["the switch missing", { ...DEV, EDUAI_DEV_QUICK_LOGIN: undefined }],
    ["no password", { ...DEV, EDUAI_DEV_QUICK_LOGIN_PASSWORD: " " }],
    ["no auth URL", { ...DEV, BETTER_AUTH_URL: undefined }],
  ])("is off with %s", (_label, env) => {
    expect(devQuickLoginPassword(env)).toBeNull();
  });

  it.each([
    "https://my.eduai.ok.ubc.ca",
    "https://eduai.ok.ubc.ca",
    "https://dev.eduai.ok.ubc.ca.evil.example",
    "https://dev.eduai.ok.ubc.ca@my.eduai.ok.ubc.ca",
  ])("stays off, with a warning, when Core's address is %s", (url) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(devQuickLoginPassword({ ...DEV, BETTER_AUTH_URL: url })).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("devQuickLoginOptions", () => {
  it("lists student, TA and instructor, with no admin and no password", () => {
    const options = devQuickLoginOptions(DEV);
    expect(options).toEqual([
      { key: "student", label: "Student" },
      { key: "ta", label: "TA" },
      { key: "instructor", label: "Instructor" },
    ]);
    expect(JSON.stringify(options)).not.toContain("dev-only-password");
    expect(DEV_QUICK_LOGIN_ACCOUNTS.some((a) => /admin/i.test(a.email + a.key))).toBe(false);
  });

  it("is null when quick login is off", () => {
    expect(devQuickLoginOptions({})).toBeNull();
  });
});

describe("resolveDevQuickLogin", () => {
  it("gives the server-held credentials for an active non-admin account", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "STUDENT",
      isActive: true,
    } as never);
    await expect(resolveDevQuickLogin("ta", DEV)).resolves.toEqual({
      ok: true,
      email: "ta.cs@eduai.local",
      password: "dev-only-password",
    });
  });

  it("refuses an account that has been made an admin or unit admin", async () => {
    for (const role of ["ADMIN", "UNIT_ADMIN"]) {
      vi.mocked(prisma.user.findUnique).mockResolvedValue({ role, isActive: true } as never);
      await expect(resolveDevQuickLogin("instructor", DEV)).resolves.toEqual({
        ok: false,
        error: "Quick login is never available for admin accounts.",
      });
    }
  });

  it("refuses an unknown key without looking anyone up, including 'admin'", async () => {
    await expect(resolveDevQuickLogin("admin", DEV)).resolves.toMatchObject({ ok: false });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("refuses a missing or inactive account", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    await expect(resolveDevQuickLogin("student", DEV)).resolves.toMatchObject({ ok: false });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      role: "STUDENT",
      isActive: false,
    } as never);
    await expect(resolveDevQuickLogin("student", DEV)).resolves.toMatchObject({ ok: false });
  });

  it("refuses everything when quick login is off, without looking anyone up", async () => {
    await expect(resolveDevQuickLogin("student", {})).resolves.toEqual({
      ok: false,
      error: "Quick login isn't available here.",
    });
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });
});

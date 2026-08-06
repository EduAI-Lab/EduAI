// @vitest-environment node
// #1213 — settings.tsx loader + action: auth gate, STUDENT-only student-id
// lookup, password-expiry flag, provider expiry map, and the setExpiry action.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/prisma.server", () => ({
  default: {
    user: { findUnique: vi.fn() },
    userProviderSettings: { findMany: vi.fn(), upsert: vi.fn() },
    aIProvider: { findUnique: vi.fn() },
  },
}));

vi.mock("~/lib/auth/password-expiry.server", () => ({
  isPasswordExpired: vi.fn().mockReturnValue(false),
  getPasswordChangedAt: vi.fn().mockResolvedValue(null),
}));

vi.mock("~/lib/canvas/student-id.server", () => ({
  readStoredStudentId: vi.fn((stored: string | null) => stored),
}));

import { loader, action } from "~/routes/settings";
import { auth } from "~/lib/auth/server";
import prisma from "~/lib/prisma.server";
import { isPasswordExpired } from "~/lib/auth/password-expiry.server";

function makeLoaderArgs(url = "http://localhost/settings") {
  return {
    request: new Request(url),
    params: {},
    context: {} as never,
  } as never;
}

function makeActionArgs(form: Record<string, string>) {
  const body = new URLSearchParams(form);
  return {
    request: new Request("http://localhost/settings", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }),
    params: {},
    context: {} as never,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.userProviderSettings.findMany).mockResolvedValue([]);
  vi.mocked(isPasswordExpired).mockReturnValue(false);
});

describe("settings loader", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await loader(makeLoaderArgs())) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });

  it("looks up studentNumber for a STUDENT", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ studentId: "12345" } as never);

    const result = (await loader(makeLoaderArgs())) as { studentNumber: string | null };
    expect(result.studentNumber).toBe("12345");
    expect(prisma.user.findUnique).toHaveBeenCalled();
  });

  it("skips the studentId lookup for non-STUDENT roles", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);

    const result = (await loader(makeLoaderArgs())) as { studentNumber: string | null };
    expect(result.studentNumber).toBeNull();
    expect(prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("treats ?expired=1 as a forced password-expired flag", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "STUDENT" },
    } as never);
    vi.mocked(prisma.user.findUnique).mockResolvedValue({ studentId: null } as never);

    const result = (await loader(
      makeLoaderArgs("http://localhost/settings?expired=1"),
    )) as { passwordExpired: boolean };
    expect(result.passwordExpired).toBe(true);
  });

  it("builds a providerExpiries map keyed by provider name", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(prisma.userProviderSettings.findMany).mockResolvedValue([
      {
        apiKeyExpiresAt: new Date("2026-06-01T00:00:00.000Z"),
        provider: { name: "openai" },
      },
    ] as never);

    const result = (await loader(makeLoaderArgs())) as {
      providerExpiries: Record<string, string>;
    };
    expect(result.providerExpiries).toEqual({ openai: "2026-06-01" });
  });
});

describe("settings action", () => {
  it("redirects anonymous callers to /auth/login", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    const res = (await action(makeActionArgs({ _action: "setExpiry" }))) as Response;
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("/auth/login");
  });

  it("returns ok:false when providerName is missing", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    const result = await action(makeActionArgs({ _action: "setExpiry" }));
    expect(result).toEqual({ ok: false });
  });

  it("returns ok:false when the provider does not exist", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(prisma.aIProvider.findUnique).mockResolvedValue(null);
    const result = await action(
      makeActionArgs({ _action: "setExpiry", providerName: "openai" }),
    );
    expect(result).toEqual({ ok: false });
  });

  it("upserts the expiry date and returns ok:true", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    vi.mocked(prisma.aIProvider.findUnique).mockResolvedValue({ id: "provider-1" } as never);

    const result = await action(
      makeActionArgs({
        _action: "setExpiry",
        providerName: "openai",
        apiKeyExpiresAt: "2026-12-01",
      }),
    );
    expect(result).toEqual({ ok: true });
    expect(prisma.userProviderSettings.upsert).toHaveBeenCalled();
  });

  it("returns null for an unrecognized _action", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "u1", role: "INSTRUCTOR" },
    } as never);
    const result = await action(makeActionArgs({}));
    expect(result).toBeNull();
  });
});

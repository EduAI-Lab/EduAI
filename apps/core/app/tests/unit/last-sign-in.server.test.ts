import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/prisma.server", () => ({
  default: { $executeRaw: vi.fn() },
}));

import prisma from "~/lib/prisma.server";
import { lastSignInSessionHooks, stampLastSignIn } from "~/lib/auth/last-sign-in.server";

const executeRaw = vi.mocked(prisma.$executeRaw);

/** The SQL text of a tagged-template call, with `?` where each value goes. */
const sqlOf = (call: unknown[]) => (call[0] as TemplateStringsArray).join("?");

describe("stampLastSignIn", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeRaw.mockResolvedValue(1 as never);
  });

  it("stamps the user's lastSignInAt with raw SQL, so updatedAt isn't bumped", async () => {
    const now = new Date("2026-11-13T09:00:00Z");
    await stampLastSignIn("u1", now);
    const call = executeRaw.mock.calls[0];
    expect(sqlOf(call)).toBe('UPDATE "user" SET "lastSignInAt" = ? WHERE "id" = ?');
    expect(call.slice(1)).toEqual([now, "u1"]);
    expect(sqlOf(call)).not.toContain("updatedAt");
  });

  it("logs a failed stamp instead of throwing, so sign-in still succeeds", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    executeRaw.mockRejectedValue(new Error("db down"));
    await expect(stampLastSignIn("u1")).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(
      "[LAST_SIGN_IN_STAMP_FAILED]",
      expect.objectContaining({ userId: "u1" }),
    );
    error.mockRestore();
  });
});

describe("lastSignInSessionHooks", () => {
  it("stamps the session's user whenever better-auth creates a session", async () => {
    executeRaw.mockResolvedValue(1 as never);
    await lastSignInSessionHooks.create.after({ userId: "u42" });
    expect(executeRaw.mock.calls.at(-1)?.slice(-1)).toEqual(["u42"]);
  });
});

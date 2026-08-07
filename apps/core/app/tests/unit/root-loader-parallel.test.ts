// @vitest-environment node
//
// #1369: the root loader's password-expiry check and `userPreference` lookup both depend
// only on `session.user.id`, so they now run under a single `Promise.all` instead of
// serializing on every authenticated render. These tests pin the two things that change
// could plausibly break: the expiry redirect must still short-circuit the response, and the
// two queries must genuinely overlap rather than just look parallel in the source.

import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("~/lib/auth/server", () => ({
  auth: { api: { getSession: vi.fn() } },
}));

vi.mock("~/lib/auth/password-expiry.server", () => ({
  isPasswordExpiredForUser: vi.fn(),
  getExpiredPasswordRedirect: vi.fn(),
}));

vi.mock("~/lib/policy.server", () => ({
  getPolicies: vi.fn(),
}));

vi.mock("~/lib/cron-scheduler.server", () => ({
  ensureCronSchedulerRunning: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  userPreference: { findUnique: vi.fn() },
}));

vi.mock("~/lib/prisma.server", () => ({ default: prismaMock }));

import { loader } from "~/root";
import { auth } from "~/lib/auth/server";
import { getExpiredPasswordRedirect } from "~/lib/auth/password-expiry.server";
import { getPolicies } from "~/lib/policy.server";

type RootData = {
  assistive: boolean;
  motionReduced: boolean;
  density: string;
  theme: string;
  canInvite: boolean;
  policies: Record<string, boolean>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function run(path = "/dashboard") {
  const url = new URL(`http://localhost${path}`);
  return loader({
    request: new Request(url),
    url,
    pattern: "/",
    params: {},
    context: {} as never,
  });
}

function signedInAs(role: string, id = "u1") {
  vi.mocked(auth.api.getSession).mockResolvedValue({ user: { id, role } } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPolicies).mockResolvedValue({} as never);
  vi.mocked(getExpiredPasswordRedirect).mockResolvedValue(null);
  prismaMock.userPreference.findUnique.mockResolvedValue(null);
});

describe("root loader — guest", () => {
  it("returns the guest defaults without touching the DB", async () => {
    vi.mocked(auth.api.getSession).mockResolvedValue(null as never);
    vi.mocked(getPolicies).mockResolvedValue({ "unitAdmins.canInvite": true } as never);

    const data = (await run()) as RootData;

    expect(data.assistive).toBe(false);
    expect(data.canInvite).toBe(false);
    expect(data.policies).toEqual({ "unitAdmins.canInvite": true });
    expect(prismaMock.userPreference.findUnique).not.toHaveBeenCalled();
    expect(getExpiredPasswordRedirect).not.toHaveBeenCalled();
  });
});

describe("root loader — #1369 parallel awaits", () => {
  it("issues the preference query without waiting for the expiry check to settle", async () => {
    signedInAs("STUDENT");

    // Hold the expiry check open. If the two awaits were still sequential, the preference
    // query could not have been issued while this promise is unresolved. `vi.waitFor`
    // rather than a fixed number of microtask ticks, so the assertion does not break when
    // an unrelated `await` is added upstream in the loader — a serial implementation can
    // never satisfy it either way, since the gate is still closed.
    const expiryGate = deferred<null>();
    vi.mocked(getExpiredPasswordRedirect).mockReturnValue(expiryGate.promise);

    const pending = run();
    await vi.waitFor(() =>
      expect(prismaMock.userPreference.findUnique).toHaveBeenCalledTimes(1),
    );

    expiryGate.resolve(null);
    await pending;
  });

  it("returns the stored preferences when the password is valid", async () => {
    signedInAs("STUDENT");
    prismaMock.userPreference.findUnique.mockResolvedValue({
      assistDefault: true,
      motionReduced: true,
      density: "compact",
      theme: "dark",
    });

    const data = (await run()) as RootData;

    expect(data).toMatchObject({
      assistive: true,
      motionReduced: true,
      density: "compact",
      theme: "dark",
    });
    expect(prismaMock.userPreference.findUnique).toHaveBeenCalledWith({
      where: { userId: "u1" },
      select: { assistDefault: true, motionReduced: true, density: true, theme: true },
    });
  });

  it("falls back to defaults when the user has no preference row or an unknown value", async () => {
    signedInAs("STUDENT");
    prismaMock.userPreference.findUnique.mockResolvedValue({
      assistDefault: null,
      motionReduced: null,
      density: "enormous",
      theme: "chartreuse",
    });

    const data = (await run()) as RootData;

    expect(data.assistive).toBe(false);
    expect(data.motionReduced).toBe(false);
    expect(data.density).toBe("comfortable");
    expect(data.theme).toBe("system");
  });

  it("still short-circuits with the redirect when the password has expired", async () => {
    signedInAs("STUDENT");
    vi.mocked(getExpiredPasswordRedirect).mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: "/settings?expired=1" } }),
    );

    const result = await run();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
    expect((result as Response).headers.get("Location")).toBe("/settings?expired=1");
    // The preference read is fired in parallel and simply discarded here — that wasted
    // primary-key lookup is the deliberate cost of not serializing the common path.
    expect(prismaMock.userPreference.findUnique).toHaveBeenCalledTimes(1);
  });

  it("still redirects when the parallel preference read rejects", async () => {
    signedInAs("STUDENT");
    vi.mocked(getExpiredPasswordRedirect).mockResolvedValue(
      new Response(null, { status: 302, headers: { Location: "/settings?expired=1" } }),
    );
    // Running the two queries together must not let the preference read's health decide
    // whether the user can reach the change-password form.
    prismaMock.userPreference.findUnique.mockRejectedValue(
      new Error("Timed out fetching a new connection from the connection pool"),
    );

    const result = await run();

    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(302);
  });

  it("surfaces a preference-read failure when the password is not expired", async () => {
    signedInAs("STUDENT");
    prismaMock.userPreference.findUnique.mockRejectedValue(new Error("DB down"));

    await expect(run()).rejects.toThrow("DB down");
  });

  it.each(["/settings", "/settings/account", "/auth/sign-in"])(
    "skips the expiry check on the exempt path %s but still loads preferences",
    async (path) => {
      signedInAs("STUDENT");

      const data = (await run(path)) as RootData;

      expect(getExpiredPasswordRedirect).not.toHaveBeenCalled();
      expect(prismaMock.userPreference.findUnique).toHaveBeenCalledTimes(1);
      expect(data.assistive).toBe(false);
    },
  );
});

describe("root loader — canInvite", () => {
  it("derives canInvite from the policy map for a UNIT_ADMIN", async () => {
    signedInAs("UNIT_ADMIN");
    vi.mocked(getPolicies).mockResolvedValue({ "unitAdmins.canInvite": true } as never);

    expect(((await run()) as RootData).canInvite).toBe(true);
  });

  it("is false for a UNIT_ADMIN when the policy is unset", async () => {
    signedInAs("UNIT_ADMIN");
    vi.mocked(getPolicies).mockResolvedValue({} as never);

    expect(((await run()) as RootData).canInvite).toBe(false);
  });

  it("is false for a non-UNIT_ADMIN even when the policy is on", async () => {
    signedInAs("ADMIN");
    vi.mocked(getPolicies).mockResolvedValue({ "unitAdmins.canInvite": true } as never);

    expect(((await run()) as RootData).canInvite).toBe(false);
  });
});

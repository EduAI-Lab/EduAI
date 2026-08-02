// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns")>();
  return {
    ...actual,
    promises: { ...actual.promises, lookup: (...args: unknown[]) => lookupMock(...args) },
  };
});

import { createPinnedLookup, getPinnedDispatcher } from "~/lib/net/pinned-dispatcher.server";

type LookupResult =
  | { error: NodeJS.ErrnoException }
  | { address: string | { address: string; family: number }[]; family?: number };

function invokeLookup(hostname: string, options: { all?: boolean }): Promise<LookupResult> {
  const lookup = createPinnedLookup() as unknown as (
    hostname: string,
    options: { all?: boolean },
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void,
  ) => void;

  return new Promise((resolve) => {
    lookup(hostname, options, (error, address, family) => {
      resolve(error ? { error } : { address, family });
    });
  });
}

beforeEach(() => {
  lookupMock.mockClear();
});

describe("createPinnedLookup", () => {
  // undici calls the lookup with `all: true` and expects an array. Returning the
  // wrong shape makes the pin silently not apply, so both contracts are covered.
  it("returns an array when called with all:true (undici's contract)", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);

    const result = await invokeLookup("canvas.ubc.ca", { all: true });

    expect(result).toEqual({ address: [{ address: "93.184.216.34", family: 4 }], family: undefined });
  });

  it("returns (address, family) when called without all", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);

    const result = await invokeLookup("canvas.ubc.ca", {});

    expect(result).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("errors instead of connecting when the host resolves to a private address", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);

    const result = await invokeLookup("metadata.example", { all: true });

    expect(result).toHaveProperty("error");
    expect((result as { error: Error }).error.message).toMatch(/disallowed network address/);
  });

  it("pins to the checked address so a rebind cannot substitute a private one", async () => {
    // First resolution (the pre-flight check) answers public; the second — what
    // an unpinned request would use — answers loopback.
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    lookupMock.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);

    const first = await invokeLookup("rebind.example", { all: true });
    expect(first).toEqual({
      address: [{ address: "93.184.216.34", family: 4 }],
      family: undefined,
    });

    // The connection uses the address handed back above, never the second answer.
    const second = await invokeLookup("rebind.example", { all: true });
    expect(second).toHaveProperty("error");
  });

  it("surfaces DNS failures as a lookup error", async () => {
    lookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));

    const result = await invokeLookup("nonexistent.example", { all: true });

    expect(result).toHaveProperty("error");
  });
});

describe("getPinnedDispatcher", () => {
  it("reuses one dispatcher rather than opening a pool per request", () => {
    expect(getPinnedDispatcher()).toBe(getPinnedDispatcher());
  });
});

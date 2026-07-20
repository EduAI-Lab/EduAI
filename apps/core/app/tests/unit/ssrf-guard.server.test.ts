// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

const { lookupMock } = vi.hoisted(() => ({ lookupMock: vi.fn() }));

vi.mock("node:dns", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:dns")>();
  return {
    ...actual,
    promises: { ...actual.promises, lookup: (...args: unknown[]) => lookupMock(...args) },
  };
});

import { assertPublicHostname, UnsafeHostError } from "~/lib/net/ssrf-guard.server";

describe("assertPublicHostname", () => {
  it("allows a hostname that resolves to a public address", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    await expect(assertPublicHostname("example.com")).resolves.toBeUndefined();
  });

  it("rejects loopback", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "127.0.0.1", family: 4 }]);
    await expect(assertPublicHostname("evil.example")).rejects.toThrow(UnsafeHostError);
  });

  it("rejects RFC1918 private ranges", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    await expect(assertPublicHostname("internal.example")).rejects.toThrow(UnsafeHostError);

    lookupMock.mockResolvedValueOnce([{ address: "172.20.1.1", family: 4 }]);
    await expect(assertPublicHostname("internal2.example")).rejects.toThrow(UnsafeHostError);

    lookupMock.mockResolvedValueOnce([{ address: "192.168.1.1", family: 4 }]);
    await expect(assertPublicHostname("internal3.example")).rejects.toThrow(UnsafeHostError);
  });

  it("rejects the cloud metadata link-local address", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
    await expect(assertPublicHostname("metadata.example")).rejects.toThrow(UnsafeHostError);
  });

  it("rejects IPv6 loopback, link-local, and unique-local ranges", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "::1", family: 6 }]);
    await expect(assertPublicHostname("v6-loopback.example")).rejects.toThrow(UnsafeHostError);

    lookupMock.mockResolvedValueOnce([{ address: "fe80::1", family: 6 }]);
    await expect(assertPublicHostname("v6-linklocal.example")).rejects.toThrow(UnsafeHostError);

    lookupMock.mockResolvedValueOnce([{ address: "fd12:3456::1", family: 6 }]);
    await expect(assertPublicHostname("v6-ula.example")).rejects.toThrow(UnsafeHostError);
  });

  it("rejects IPv4-mapped IPv6 addresses that unwrap to a private range", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "::ffff:127.0.0.1", family: 6 }]);
    await expect(assertPublicHostname("mapped.example")).rejects.toThrow(UnsafeHostError);
  });

  it("rejects when any resolved record (not just the first) is blocked", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ]);
    await expect(assertPublicHostname("mixed.example")).rejects.toThrow(UnsafeHostError);
  });

  it("wraps DNS resolution failures as UnsafeHostError", async () => {
    lookupMock.mockRejectedValueOnce(new Error("ENOTFOUND"));
    await expect(assertPublicHostname("nonexistent.example")).rejects.toThrow(UnsafeHostError);
  });
});

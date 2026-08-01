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

import {
  assertPublicHostname,
  assertPublicIpLiteral,
  resolvePublicHost,
  UnsafeHostError,
} from "~/lib/net/ssrf-guard.server";

beforeEach(() => {
  lookupMock.mockClear();
});

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

  it("rejects IPv4-mapped IPv6 addresses in hex form (not just dotted-decimal)", async () => {
    // ::ffff:c0a8:101 == ::ffff:192.168.1.1, but resolvers can emit either form.
    lookupMock.mockResolvedValueOnce([{ address: "::ffff:c0a8:101", family: 6 }]);
    await expect(assertPublicHostname("hex-mapped.example")).rejects.toThrow(UnsafeHostError);
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

  it("rejects the CGNAT range", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "100.64.0.1", family: 4 }]);
    await expect(assertPublicHostname("cgnat.example")).rejects.toThrow(UnsafeHostError);
  });

  it("rejects 0.0.0.0 and the IPv6 unspecified address", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "0.0.0.0", family: 4 }]);
    await expect(assertPublicHostname("zero.example")).rejects.toThrow(UnsafeHostError);

    lookupMock.mockResolvedValueOnce([{ address: "::", family: 6 }]);
    await expect(assertPublicHostname("v6-unspecified.example")).rejects.toThrow(UnsafeHostError);
  });

  it("rejects reserved, multicast, broadcast, and documentation ranges", async () => {
    for (const address of [
      "192.0.2.10", // TEST-NET-1
      "198.51.100.10", // TEST-NET-2
      "203.0.113.10", // TEST-NET-3
      "198.18.0.1", // benchmarking
      "224.0.0.1", // multicast
      "240.0.0.1", // reserved
      "255.255.255.255", // broadcast
    ]) {
      lookupMock.mockResolvedValueOnce([{ address, family: 4 }]);
      await expect(assertPublicHostname(`reserved-${address}.example`)).rejects.toThrow(
        UnsafeHostError,
      );
    }

    lookupMock.mockResolvedValueOnce([{ address: "2001:db8::1", family: 6 }]);
    await expect(assertPublicHostname("v6-doc.example")).rejects.toThrow(UnsafeHostError);

    lookupMock.mockResolvedValueOnce([{ address: "64:ff9b::7f00:1", family: 6 }]);
    await expect(assertPublicHostname("v6-nat64.example")).rejects.toThrow(UnsafeHostError);

    // ff00::/8 is the IPv6 counterpart of the 224/4 rule above; both sides of
    // the range table should reject multicast, not just the IPv4 one.
    for (const address of ["ff02::1", "ff05::1:3", "ff0e::1"]) {
      lookupMock.mockResolvedValueOnce([{ address, family: 6 }]);
      await expect(
        assertPublicHostname(`v6-multicast-${address}.example`),
        address,
      ).rejects.toThrow(UnsafeHostError);
    }
  });

  it("blocks IPv6 loopback and mapped-private addresses in uncompressed form", async () => {
    // The same address has many spellings. Matching the textual form only
    // catches whichever one the author thought of, so these are expanded to
    // numeric hextets before the range checks run.
    for (const address of [
      "0:0:0:0:0:0:0:1", // ::1
      "0000:0000:0000:0000:0000:0000:0000:0001", // ::1, zero-padded
      "0:0:0:0:0:0:0:0", // ::
      "0:0:0:0:0:ffff:7f00:1", // ::ffff:127.0.0.1
      "0:0:0:0:0:ffff:a00:1", // ::ffff:10.0.0.1
      "2001:0db8:0:0:0:0:0:1", // 2001:db8::1
      "::127.0.0.1", // deprecated IPv4-compatible form
      "fe80::1%eth0", // zone index must not defeat the check
      "FE80::1", // case must not defeat the check
    ]) {
      lookupMock.mockResolvedValueOnce([{ address, family: 6 }]);
      await expect(assertPublicHostname(`v6-${address}.example`), address).rejects.toThrow(
        UnsafeHostError,
      );
    }
  });

  it("still allows public IPv6 addresses", async () => {
    for (const address of [
      "2606:2800:220:1:248:1893:25c8:1946",
      "2001:4860:4860::8888",
      "64:ff9c::1", // adjacent to NAT64 but not in it
      "2001:db9::1", // adjacent to the documentation range but not in it
    ]) {
      lookupMock.mockResolvedValueOnce([{ address, family: 6 }]);
      await expect(assertPublicHostname(`v6-ok-${address}.example`), address).resolves
        .toBeUndefined();
    }
  });

  it("fails closed on malformed IPv6 rather than treating it as public", async () => {
    for (const address of ["gggg::1", "1:2:3:4:5:6:7", "1::2::3", "1:2:3:4:5:6:7:8:9"]) {
      lookupMock.mockResolvedValueOnce([{ address, family: 6 }]);
      await expect(assertPublicHostname(`v6-bad-${address}.example`), address).rejects.toThrow(
        UnsafeHostError,
      );
    }
  });

  it("fails closed on a malformed address rather than treating it as public", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "not-an-ip", family: 4 }]);
    await expect(assertPublicHostname("malformed.example")).rejects.toThrow(UnsafeHostError);
  });

  it("rejects an empty record set", async () => {
    lookupMock.mockResolvedValueOnce([]);
    await expect(assertPublicHostname("empty.example")).rejects.toThrow(UnsafeHostError);
  });
});

describe("resolvePublicHost", () => {
  it("returns a validated address so the caller can pin the connection to it", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    await expect(resolvePublicHost("example.com")).resolves.toEqual({
      address: "93.184.216.34",
      family: 4,
    });
  });

  it("strips brackets from an IPv6 hostname before resolving", async () => {
    lookupMock.mockResolvedValueOnce([{ address: "2606:2800:220:1::1", family: 6 }]);
    await resolvePublicHost("[2606:2800:220:1::1]");
    expect(lookupMock).toHaveBeenCalledWith("2606:2800:220:1::1", expect.anything());
  });

  it("does not return an address when a later record is blocked", async () => {
    lookupMock.mockResolvedValueOnce([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ]);
    await expect(resolvePublicHost("mixed.example")).rejects.toThrow(UnsafeHostError);
  });
});

describe("assertPublicIpLiteral", () => {
  it("rejects private, loopback, and metadata literals without touching DNS", () => {
    for (const literal of ["10.0.0.5", "127.0.0.1", "169.254.169.254", "192.168.1.1"]) {
      expect(() => assertPublicIpLiteral(literal)).toThrow(UnsafeHostError);
    }
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it("rejects bracketed IPv6 literals", () => {
    expect(() => assertPublicIpLiteral("[::1]")).toThrow(UnsafeHostError);
    expect(() => assertPublicIpLiteral("[fd00::1]")).toThrow(UnsafeHostError);
  });

  it("allows a public literal", () => {
    expect(() => assertPublicIpLiteral("93.184.216.34")).not.toThrow();
  });

  it("is a no-op for hostnames, which need the DNS-backed check instead", () => {
    expect(() => assertPublicIpLiteral("canvas.ubc.ca")).not.toThrow();
  });
});

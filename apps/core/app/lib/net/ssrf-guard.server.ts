import { promises as dns } from "node:dns";

export class UnsafeHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeHostError";
  }
}

function isBlockedIPv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // malformed — fail closed
  }
  const [a, b] = octets as [number, number, number, number];
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC6598)
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  return false;
}

function isBlockedIPv6(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true; // loopback / unspecified

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped?.[1]) return isBlockedIPv4(mapped[1]);

  // An empty first group means the address starts with "::" (zero-compressed).
  // That includes hex-form IPv4-mapped addresses like "::ffff:c0a8:101"
  // (192.168.1.1) that the dotted-decimal regex above doesn't catch — treat
  // as unparseable and fail closed rather than defaulting to hextet 0.
  const firstGroup = normalized.split(":")[0] ?? "";
  const firstHextet = firstGroup === "" ? NaN : parseInt(firstGroup, 16);
  if (Number.isNaN(firstHextet)) return true; // malformed — fail closed

  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true; // link-local fe80::/10
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true; // unique local fc00::/7

  return false;
}

function isBlockedAddress(address: string, family: number): boolean {
  return family === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address);
}

/**
 * Resolves `hostname` (DNS name or literal IP) and rejects it if any A/AAAA
 * record lands in a private/loopback/link-local/CGNAT/unique-local range —
 * blocks SSRF to internal services and cloud metadata endpoints.
 *
 * Call this immediately before each outbound request, not just once at
 * connect/verify time, so a DNS answer that changes between calls (rebinding)
 * gets re-checked. The request itself still performs its own DNS resolution
 * afterwards, so this narrows rather than eliminates the rebind window.
 */
export async function assertPublicHostname(hostname: string): Promise<void> {
  const bare = hostname.replace(/^\[/, "").replace(/\]$/, "");

  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(bare, { all: true, verbatim: true });
  } catch {
    throw new UnsafeHostError(`Could not resolve host "${bare}"`);
  }

  if (records.length === 0 || records.some((r) => isBlockedAddress(r.address, r.family))) {
    throw new UnsafeHostError(`Host "${bare}" resolves to a disallowed network address`);
  }
}

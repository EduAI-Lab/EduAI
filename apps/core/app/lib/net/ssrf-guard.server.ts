import { promises as dns } from "node:dns";
import net from "node:net";

export class UnsafeHostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeHostError";
  }
}

export type ResolvedHost = { address: string; family: number };

function isBlockedIPv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
    return true; // malformed — fail closed
  }
  const [a, b, c] = octets as [number, number, number, number];
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT (RFC6598)
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0 && c === 2) return true; // TEST-NET-1 (RFC5737)
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2 (RFC5737)
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3 (RFC5737)
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking 198.18/15 (RFC2544)
  if (a >= 224 && a <= 239) return true; // multicast 224/4
  if (a >= 240) return true; // reserved 240/4, incl. broadcast 255.255.255.255
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
  const groups = normalized.split(":");
  const firstGroup = groups[0] ?? "";
  const firstHextet = firstGroup === "" ? NaN : parseInt(firstGroup, 16);
  if (Number.isNaN(firstHextet)) return true; // malformed — fail closed

  if (firstHextet >= 0xfe80 && firstHextet <= 0xfebf) return true; // link-local fe80::/10
  if (firstHextet >= 0xfc00 && firstHextet <= 0xfdff) return true; // unique local fc00::/7

  const secondGroup = groups[1] ?? "";
  const secondHextet = secondGroup === "" ? NaN : parseInt(secondGroup, 16);
  if (firstHextet === 0x2001 && secondHextet === 0x0db8) return true; // documentation 2001:db8::/32
  if (firstHextet === 0x0064 && secondHextet === 0xff9b) return true; // NAT64 64:ff9b::/96

  return false;
}

function isBlockedAddress(address: string, family: number): boolean {
  return family === 6 ? isBlockedIPv6(address) : isBlockedIPv4(address);
}

/** Strips the `[...]` wrapper URL parsing leaves on IPv6 hostnames. */
function bareHostname(hostname: string): string {
  return hostname.replace(/^\[/, "").replace(/\]$/, "");
}

/**
 * Synchronous guard for hostnames that are already IP literals — safe to call
 * on paths that cannot await, such as URL validation at save time.
 *
 * A non-literal hostname is a no-op here: resolving it requires DNS, so those
 * are the caller's job to run through `resolvePublicHost` before the request.
 * This is a first line of defence, never the only one.
 */
export function assertPublicIpLiteral(hostname: string): void {
  const bare = bareHostname(hostname);
  const family = net.isIP(bare);
  if (family === 0) return; // not a literal — DNS-time check applies instead

  if (isBlockedAddress(bare, family)) {
    throw new UnsafeHostError(`Host "${bare}" is a disallowed network address`);
  }
}

/**
 * Resolves `hostname` (DNS name or literal IP), rejects it if any A/AAAA record
 * lands in a private/loopback/link-local/CGNAT/unique-local/reserved range, and
 * returns one validated address so callers can pin the connection to it.
 *
 * Every record must pass before any is returned, so the returned address is
 * always one this function actually checked. Pass it to the socket layer (see
 * `createPinnedLookup`) rather than letting the request re-resolve the name —
 * a second resolution is a rebinding window this check cannot cover.
 */
export async function resolvePublicHost(hostname: string): Promise<ResolvedHost> {
  const bare = bareHostname(hostname);

  let records: ResolvedHost[];
  try {
    records = await dns.lookup(bare, { all: true, verbatim: true });
  } catch {
    throw new UnsafeHostError(`Could not resolve host "${bare}"`);
  }

  if (records.length === 0 || records.some((r) => isBlockedAddress(r.address, r.family))) {
    throw new UnsafeHostError(`Host "${bare}" resolves to a disallowed network address`);
  }

  const [first] = records as [ResolvedHost, ...ResolvedHost[]];
  return first;
}

/**
 * Resolves `hostname` and throws if it is not publicly routable.
 *
 * Prefer `resolvePublicHost` when the caller can pin the connection to the
 * returned address; this wrapper is for call sites that only need the assertion.
 */
export async function assertPublicHostname(hostname: string): Promise<void> {
  await resolvePublicHost(hostname);
}

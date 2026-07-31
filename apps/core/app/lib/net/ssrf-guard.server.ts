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

/**
 * Expands an IPv6 address to its eight numeric hextets, or null if it cannot be
 * parsed. Callers must treat null as blocked.
 *
 * Expanding is what makes the range checks trustworthy: matching on the textual
 * form only catches whichever spelling the author happened to think of, and the
 * same address has many. `::1`, `0:0:0:0:0:0:0:1` and
 * `0000:0000:0000:0000:0000:0000:0000:0001` are one address; so are
 * `::ffff:127.0.0.1` and `0:0:0:0:0:ffff:7f00:1`.
 */
function expandIPv6(address: string): number[] | null {
  // Drop any zone index ("fe80::1%eth0") before parsing.
  let text = address.toLowerCase().split("%")[0] ?? "";
  if (text === "") return null;

  // A trailing dotted quad ("::ffff:127.0.0.1") occupies the final two hextets.
  const dotted = text.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted?.[1]) {
    const octets = dotted[1].split(".").map(Number);
    if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null;
    const [a, b, c, d] = octets as [number, number, number, number];
    const high = ((a << 8) | b).toString(16);
    const low = ((c << 8) | d).toString(16);
    text = `${text.slice(0, -dotted[1].length)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null; // "::" may appear at most once

  const parseGroups = (part: string): number[] | null => {
    if (part === "") return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      groups.push(parseInt(group, 16));
    }
    return groups;
  };

  const head = parseGroups(halves[0] ?? "");
  if (head === null) return null;

  if (halves.length === 1) return head.length === 8 ? head : null;

  const tail = parseGroups(halves[1] ?? "");
  if (tail === null) return null;

  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null; // "::" must stand for at least one zero group

  return [...head, ...Array<number>(missing).fill(0), ...tail];
}

function isBlockedIPv6(address: string): boolean {
  const groups = expandIPv6(address);
  if (groups === null) return true; // malformed — fail closed

  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number, number, number, number, number, number, number, number,
  ];

  const leadingZero = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;

  // IPv4-mapped (::ffff:a.b.c.d) and the deprecated IPv4-compatible (::a.b.c.d)
  // forms carry an IPv4 address in the last two hextets — check it as IPv4.
  if (leadingZero && (g5 === 0xffff || g5 === 0)) {
    const embedded = [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join(".");
    // "::" and "::1" fall out of this as 0.0.0.0 and 0.0.0.1, both blocked by
    // the IPv4 "this network" rule.
    return isBlockedIPv4(embedded);
  }

  if ((g0 & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((g0 & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
  if (g0 === 0x2001 && g1 === 0x0db8) return true; // documentation 2001:db8::/32
  if (g0 === 0x0064 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return true; // NAT64 64:ff9b::/96
  }

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

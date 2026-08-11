/**
 * SSRF guard for user-supplied Canvas base URLs (#991). Canvas integrations are
 * personal (rbac-matrix.md §18) — any user able to configure one could otherwise
 * point the backend's outbound Canvas API calls at an internal service or a cloud
 * metadata endpoint (e.g. http://169.254.169.254/). Validates scheme and rejects
 * IP-literal hostnames in private/loopback/link-local/reserved ranges.
 *
 * `validateCanvasUrl` alone only catches IP-literal targeting — a public hostname
 * that resolves (or later rebinds) to a private address would sail through. Real
 * requests must also use `createPinnedLookup()` as the request's DNS `lookup` and
 * disable redirects (`maxRedirects: 0`), so the resolved address is re-validated
 * at connection time and a permitted host can't redirect the request elsewhere.
 */
import net from "node:net";
import dns from "node:dns";

export class CanvasUrlValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CanvasUrlValidationError";
  }
}

function ipv4ToInteger(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return null;
  }
  return parts.reduce((value, part) => ((value << 8) | part) >>> 0, 0);
}

function ipv4IsInCidr(value, base, prefixLength) {
  const mask = prefixLength === 0 ? 0 : (0xffffffff << (32 - prefixLength)) >>> 0;
  return (value & mask) === (ipv4ToInteger(base) & mask);
}

// IANA special-purpose ranges that are not globally routable. Rejecting the
// complete enclosing blocks is deliberately conservative for an LMS origin:
// a legitimate Canvas installation should never need one as an IP literal.
const NON_GLOBAL_IPV4_RANGES = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function isNonGlobalIPv4(address) {
  const value = ipv4ToInteger(address);
  return value === null || NON_GLOBAL_IPV4_RANGES.some(([base, prefix]) => ipv4IsInCidr(value, base, prefix));
}

/**
 * Expands a normalized IPv6 address (as returned by `URL.hostname`) into its
 * 8 constituent 16-bit groups, resolving `::` compression. Returns null if
 * the address can't be parsed as 8 groups (should not happen for a value
 * `net.isIP` has already confirmed is a valid IPv6 literal).
 */
function expandIPv6Groups(address) {
  const [head, tail] = address.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  if (tail === undefined) {
    // No '::' compression present.
    return headGroups.length === 8 ? headGroups.map((g) => parseInt(g, 16)) : null;
  }
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 0) return null;
  const groups = [...headGroups, ...Array(missing).fill("0"), ...tailGroups];
  return groups.map((g) => parseInt(g, 16));
}

/**
 * True for ::1 (loopback), :: (unspecified), fe80::/10 (link-local, the full
 * range — fe80 through febf in the first group, not just the fe80 prefix),
 * fc00::/7 (unique local), and IPv4-mapped private addresses.
 */
export function isPrivateIPv6(address) {
  const normalized = address.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;

  if (normalized.startsWith("::ffff:")) {
    // Node's URL parser normalizes an IPv4-mapped literal to hex groups
    // (e.g. `::ffff:127.0.0.1` -> `::ffff:7f00:1`), so handle both forms.
    const embedded = normalized.slice('::ffff:'.length);
    if (embedded.includes('.')) {
      return isNonGlobalIPv4(embedded);
    }
    const [hi, lo] = embedded.split(":").map((part) => parseInt(part, 16));
    if (Number.isInteger(hi) && Number.isInteger(lo)) {
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isNonGlobalIPv4(ipv4);
    }
    return false;
  }

  const groups = expandIPv6Groups(normalized);
  if (!groups || groups.some((g) => !Number.isInteger(g))) return false;
  // Deprecated IPv4-compatible form (::a.b.c.d, no ffff group): first six
  // groups zero. Node's URL parser normalizes the embedded IPv4 octets into
  // the last two hex groups (e.g. `::127.0.0.1` -> `::7f00:1`), so pull them
  // back out and re-check as IPv4 — this is how `::127.0.0.1` (loopback)
  // slips past the checks above otherwise.
  if (groups.slice(0, 6).every((g) => g === 0)) {
    const [hi, lo] = groups.slice(6);
    const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    return isNonGlobalIPv4(ipv4);
  }

  const first = groups[0];
  // Globally routable unicast space is currently 2000::/3. Within that space,
  // reject the broad IETF special-purpose block, documentation, ORCHID and
  // transition prefixes. This also rejects multicast, link-local, ULA and
  // unspecified space by construction.
  if (first < 0x2000 || first > 0x3fff) return true;
  if (first === 0x2001 && groups[1] < 0x0200) return true; // 2001::/23
  if (first === 0x2001 && groups[1] === 0x0db8) return true; // documentation
  if (first === 0x2001 && groups[1] >= 0x0010 && groups[1] <= 0x001f) return true; // ORCHID
  if (first === 0x2002) return true; // deprecated 6to4
  if (first === 0x3fff && groups[1] <= 0x0fff) return true; // 3fff::/20 documentation
  return false;
}

/**
 * Parses and validates a Canvas base URL before it is persisted or used for an
 * outbound request. Throws `CanvasUrlValidationError` with a user-facing message
 * on any violation. Returns the parsed `URL` on success.
 */
export function validateCanvasUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new CanvasUrlValidationError("Invalid Canvas URL format");
  }

  if (parsed.protocol !== "https:") {
    throw new CanvasUrlValidationError("Canvas URL must use HTTPS");
  }

  if (parsed.username || parsed.password) {
    throw new CanvasUrlValidationError('Canvas URL may not contain credentials');
  }
  if (parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new CanvasUrlValidationError('Canvas URL must be an HTTPS origin without a path, query, or fragment');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ipVersion = net.isIP(hostname);
  if (
    (ipVersion === 4 && isNonGlobalIPv4(hostname)) ||
    (ipVersion === 6 && isPrivateIPv6(hostname))
  ) {
    throw new CanvasUrlValidationError(
      "Canvas URL may not target a private or reserved IP address",
    );
  }

  return parsed;
}

/**
 * Returns a Node-`dns.lookup`-compatible function for use as an HTTP request's
 * `lookup` option. It resolves the hostname, rejects any result in a private/
 * reserved range (closing the DNS-rebinding gap `validateCanvasUrl` leaves open),
 * and hands back the validated address — pinning the connection to it so nothing
 * can re-resolve to a different (unvalidated) address between check and use.
 */
export function createPinnedLookup() {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) return callback(err);
      if (!addresses.length) return callback(new Error(`No addresses found for ${hostname}`));
      for (const { address } of addresses) {
        const detectedFamily = net.isIP(address);
        const isPrivate =
          detectedFamily === 4
            ? isNonGlobalIPv4(address)
            : detectedFamily === 6
              ? isPrivateIPv6(address)
              : true;
        if (isPrivate) {
          return callback(
            new CanvasUrlValidationError(
              `Canvas hostname resolved to a private or reserved address (${address})`,
            ),
          );
        }
      }
      const [{ address, family }] = addresses;
      callback(null, address, family || net.isIP(address));
    });
  };
}

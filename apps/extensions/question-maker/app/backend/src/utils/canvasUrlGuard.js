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
import net from 'node:net';
import dns from 'node:dns';

export class CanvasUrlValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CanvasUrlValidationError';
  }
}

/** True for 10/8, 127/8, 169.254/16 (incl. cloud metadata), 172.16/12, 192.168/16, and 0.0.0.0/8. */
function isPrivateIPv4(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 0) return true;
  return false;
}

/**
 * Expands a normalized IPv6 address (as returned by `URL.hostname`) into its
 * 8 constituent 16-bit groups, resolving `::` compression. Returns null if
 * the address can't be parsed as 8 groups (should not happen for a value
 * `net.isIP` has already confirmed is a valid IPv6 literal).
 */
function expandIPv6Groups(address) {
  const [head, tail] = address.split('::');
  const headGroups = head ? head.split(':') : [];
  const tailGroups = tail ? tail.split(':') : [];
  if (tail === undefined) {
    // No '::' compression present.
    return headGroups.length === 8 ? headGroups.map((g) => parseInt(g, 16)) : null;
  }
  const missing = 8 - headGroups.length - tailGroups.length;
  if (missing < 0) return null;
  const groups = [...headGroups, ...Array(missing).fill('0'), ...tailGroups];
  return groups.map((g) => parseInt(g, 16));
}

/**
 * True for ::1 (loopback), :: (unspecified), fe80::/10 (link-local, the full
 * range — fe80 through febf in the first group, not just the fe80 prefix),
 * fc00::/7 (unique local), and IPv4-mapped private addresses.
 */
function isPrivateIPv6(address) {
  const normalized = address.toLowerCase();
  if (normalized === '::1' || normalized === '::') return true;

  if (normalized.startsWith('::ffff:')) {
    // Node's URL parser normalizes an IPv4-mapped literal to hex groups
    // (e.g. `::ffff:127.0.0.1` -> `::ffff:7f00:1`), so handle both forms.
    const embedded = normalized.slice('::ffff:'.length);
    if (embedded.includes('.')) {
      return isPrivateIPv4(embedded);
    }
    const [hi, lo] = embedded.split(':').map((part) => parseInt(part, 16));
    if (Number.isInteger(hi) && Number.isInteger(lo)) {
      const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateIPv4(ipv4);
    }
    return false;
  }

  const groups = expandIPv6Groups(normalized);
  if (!groups || groups.some((g) => !Number.isInteger(g))) return false;
  const first = groups[0];
  // fe80::/10: top 10 bits fixed => first group in [0xfe80, 0xfebf].
  if (first >= 0xfe80 && first <= 0xfebf) return true;
  // fc00::/7: top 7 bits fixed => first group in [0xfc00, 0xfdff].
  if (first >= 0xfc00 && first <= 0xfdff) return true;
  // Deprecated IPv4-compatible form (::a.b.c.d, no ffff group): first six
  // groups zero. Node's URL parser normalizes the embedded IPv4 octets into
  // the last two hex groups (e.g. `::127.0.0.1` -> `::7f00:1`), so pull them
  // back out and re-check as IPv4 — this is how `::127.0.0.1` (loopback)
  // slips past the checks above otherwise.
  if (groups.slice(0, 6).every((g) => g === 0)) {
    const [hi, lo] = groups.slice(6);
    const ipv4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
    if (isPrivateIPv4(ipv4)) return true;
  }
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
    throw new CanvasUrlValidationError('Invalid Canvas URL format');
  }

  if (parsed.protocol !== 'https:') {
    throw new CanvasUrlValidationError('Canvas URL must use HTTPS');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const ipVersion = net.isIP(hostname);
  if (
    (ipVersion === 4 && isPrivateIPv4(hostname)) ||
    (ipVersion === 6 && isPrivateIPv6(hostname))
  ) {
    throw new CanvasUrlValidationError('Canvas URL may not target a private or reserved IP address');
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
      for (const { address, family } of addresses) {
        const isPrivate = family === 4 ? isPrivateIPv4(address) : isPrivateIPv6(address);
        if (isPrivate) {
          return callback(
            new CanvasUrlValidationError(
              `Canvas hostname resolved to a private or reserved address (${address})`
            )
          );
        }
      }
      const [{ address, family }] = addresses;
      callback(null, address, family);
    });
  };
}

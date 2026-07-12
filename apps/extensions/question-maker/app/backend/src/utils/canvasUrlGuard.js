/**
 * SSRF guard for user-supplied Canvas base URLs (#991). Canvas integrations are
 * personal (rbac-matrix.md §18) — any user able to configure one could otherwise
 * point the backend's outbound Canvas API calls at an internal service or a cloud
 * metadata endpoint (e.g. http://169.254.169.254/). Validates scheme and rejects
 * IP-literal hostnames in private/loopback/link-local/reserved ranges.
 *
 * This does not resolve hostnames via DNS, so a public domain that later resolves
 * to a private address (DNS rebinding) is not caught — only IP-literal targeting.
 */
import net from 'node:net';

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

/** True for ::1 (loopback), fe80::/10 (link-local), fc00::/7 (unique local), and IPv4-mapped private addresses. */
function isPrivateIPv6(address) {
  const normalized = address.toLowerCase();
  if (normalized === '::1') return true;
  if (normalized.startsWith('fe80:')) return true;
  if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
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

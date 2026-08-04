/**
 * Oracle for tests/models/ssrf-ipv6-classify.pict (census docs/PICT_CENSUS.md § S5).
 *
 * Spec-derived IPv6 private/reserved classification for QM `isPrivateIPv6`
 * (canvasUrlGuard.js:65). Core has a parallel `isBlockedIPv6` in
 * ssrf-guard.server.ts but it does not handle IPv4-compatible forms
 * (::7f00:1) — this model targets QM as primary; Core comparison is noted
 * in the adapter report, not duplicated here.
 *
 * Classification inputs are normalized host strings (brackets stripped; zone
 * ID stripped before classify — matching production URL hostname extraction).
 *
 * Blocked classes (blocked: true):
 *   - loopback (::1)
 *   - unspecified (::)
 *   - link-local (fe80::/10)
 *   - unique-local (fc00::/7)
 *   - IPv4-mapped private (::ffff:x.x.x.x dotted or ::ffff:HHHH:LLLL hex)
 *   - IPv4-compatible private embedded in last two groups (::7f00:1 etc.)
 *
 * Public classes (blocked: false):
 *   - global unicast (2001:db8::1)
 *   - IPv4-mapped public (::ffff:8.8.8.8 / ::ffff:808:808)
 *   - boundary neighbors below fe80::/10 (fe7f::1) and below fc00::/7 (fbff::1)
 */

export type SsrfIpv6ClassifyRow = {
  AddressForm: "loopback" | "link-local" | "unique-local" | "global" | "ipv4-mapped" | "unspecified";
  ZoneId: "none" | "present";
  Bracketed: "yes" | "no";
  MappedEncoding: "dotted" | "hex";
};

export type SsrfIpv6ClassifyVerdict = {
  class:
    | "loopback"
    | "unspecified"
    | "link-local"
    | "unique-local"
    | "global-unicast"
    | "ipv4-mapped-private"
    | "ipv4-mapped-public";
  blocked: boolean;
};

function baseAddress(row: SsrfIpv6ClassifyRow): string {
  switch (row.AddressForm) {
    case "loopback":
      return "::1";
    case "link-local":
      return "fe80::1";
    case "unique-local":
      return "fd00::1";
    case "global":
      return "2001:db8::1";
    case "unspecified":
      return "::";
    case "ipv4-mapped":
      return row.MappedEncoding === "dotted" ? "::ffff:127.0.0.1" : "::ffff:7f00:1";
  }
}

/**
 * Normalizes a hostname the way validateCanvasUrl does before net.isIP /
 * isPrivateIPv6 — strips bracket wrappers and zone identifiers.
 */
export function normalizeIpv6ClassifierInput(row: SsrfIpv6ClassifyRow): string {
  let addr = baseAddress(row);
  if (row.ZoneId === "present") {
    addr = `${addr}%en0`;
  }
  if (row.Bracketed === "yes") {
    addr = `[${addr}]`;
  }
  const unbracketed = addr.replace(/^\[|\]$/g, "");
  const zoneSplit = unbracketed.indexOf("%");
  return zoneSplit === -1 ? unbracketed : unbracketed.slice(0, zoneSplit);
}

export function ssrfIpv6ClassifyOracle(row: SsrfIpv6ClassifyRow): SsrfIpv6ClassifyVerdict {
  switch (row.AddressForm) {
    case "loopback":
      return { class: "loopback", blocked: true };
    case "unspecified":
      return { class: "unspecified", blocked: true };
    case "link-local":
      return { class: "link-local", blocked: true };
    case "unique-local":
      return { class: "unique-local", blocked: true };
    case "global":
      return { class: "global-unicast", blocked: false };
    case "ipv4-mapped":
      return { class: "ipv4-mapped-private", blocked: true };
  }
}

/** Boundary row pinned via seed — public neighbor below link-local /10. */
export function ssrfIpv6BoundaryPublicAddress(): string {
  return "fe7f::1";
}

export function ssrfIpv6BoundaryPublicVerdict(): SsrfIpv6ClassifyVerdict {
  return { class: "global-unicast", blocked: false };
}

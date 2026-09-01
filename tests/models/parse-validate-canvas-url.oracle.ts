/**
 * Oracle for tests/models/parse-validate-canvas-url.pict (census docs/PICT_CENSUS.md § S5).
 *
 * Parse-time Canvas base URL validation contract (issue #1184). Originally a
 * Core-vs-QM drift model; QM's `validateCanvasUrl` (canvasUrlGuard.js) was
 * deleted when QM's Canvas egress moved into Core (#1084), so Core
 * `parseAndValidateCanvasUrl` is now the single boundary and inherits QM's
 * stricter canonical-base rules. Request-time DNS pinning /
 * assertPublicHostname is out of scope for this model.
 *
 * Current behavior:
 *
 * Core `parseAndValidateCanvasUrl`:
 *   - Rejects malformed / non-hierarchical URLs.
 *   - Rejects userinfo, query strings, and fragments — a Canvas base is an
 *     origin plus an optional deployment sub-path and nothing else.
 *   - Rejects localhost names and private/reserved IP literals at parse time.
 *   - Accepts http: only for localhost, 127.0.0.1, ::1, canvas.docker in local
 *     development; production requires https:.
 *   - Rejects other schemes (file:, etc.).
 *
 * QM `validateCanvasUrl` (removed in #1084, retained here as the source of the
 * canonical-base rules Core absorbed):
 *   - Rejected malformed URLs.
 *   - Required https: (http rejected, including localhost).
 *   - Rejected userinfo, query strings, and fragments.
 *   - Rejected private/reserved IPv4 and IPv6 literals; DNS names were
 *     accepted even when they looked numeric (e.g. 10.example.edu).
 *
 * Union rule (strictest shared intent — the oracle Core asserts):
 *   - Must be a valid absolute URL with https: scheme.
 *   - Must not carry userinfo, a query string, or a fragment.
 *   - Must not target a private/reserved IP literal.
 *   - Public DNS names and public IP literals are accepted.
 *   - Path traversal segments do not affect parse-time acceptance (the base
 *     path is normalized by WHATWG parsing before any API path is appended).
 *
 * Known divergences (oracle stays strict; failing adapter side = bug to file):
 *   - Core accepts http://localhost (QM rejects).
 *   - Core rejects https://localhost while QM accepts it; the model includes
 *     only the localhost hostname from Core's broader local-development
 *     allowlist.
 */

export type ParseValidateCanvasUrlRow = {
  UrlForm: "https-host" | "http-host" | "with-userinfo" | "relative" | "opaque";
  HostClass: "public-dns" | "localhost" | "ipv4-private" | "ipv4-public" | "ipv6-literal";
  ExtraPath: "none" | "traversal" | "query-ssrf";
};

export type ParseValidateCanvasUrlVerdict = {
  accept: boolean;
  rejectReason?:
    | "invalid-format"
    | "invalid-scheme"
    | "http-not-allowed"
    | "non-canonical-base"
    | "private-ip";
};

/** Rows where Core currently diverges from the union oracle (parse-time only). */
export function coreKnownDivergence(row: ParseValidateCanvasUrlRow): boolean {
  // The canonical-base rules apply before the local-development allowlist, so
  // a localhost URL carrying a query is rejected by both sides and no longer
  // diverges — only the plain localhost forms do.
  if (row.ExtraPath === "query-ssrf") return false;
  if (row.UrlForm === "http-host" && row.HostClass === "localhost") return true;
  if (row.UrlForm === "https-host" && row.HostClass === "localhost") return true;
  return false;
}

function pathSuffix(extraPath: ParseValidateCanvasUrlRow["ExtraPath"]): string {
  switch (extraPath) {
    case "traversal":
      return "/api/../etc/passwd";
    case "query-ssrf":
      return "/?redirect=http://169.254.169.254";
    default:
      return "/";
  }
}

function hostFor(row: ParseValidateCanvasUrlRow): string {
  switch (row.HostClass) {
    case "public-dns":
      return "canvas.example.edu";
    case "localhost":
      return "localhost:8080";
    case "ipv4-private":
      return "10.1.2.3";
    case "ipv4-public":
      return "8.8.8.8";
    case "ipv6-literal":
      return "[::1]";
  }
}

/** Builds the raw URL string fed to both parse validators for a PICT row. */
export function canvasUrlStringForRow(row: ParseValidateCanvasUrlRow): string {
  const suffix = pathSuffix(row.ExtraPath);

  switch (row.UrlForm) {
    case "https-host":
      return `https://${hostFor(row)}${suffix}`;
    case "http-host":
      return `http://${hostFor(row)}${suffix}`;
    case "with-userinfo":
      return `https://user:pass@canvas.example.edu${suffix}`;
    case "relative":
      return "/api/v1/courses";
    case "opaque":
      return "file:///etc/passwd";
  }
}

export function parseValidateCanvasUrlOracle(
  row: ParseValidateCanvasUrlRow,
): ParseValidateCanvasUrlVerdict {
  if (row.UrlForm === "relative") {
    return { accept: false, rejectReason: "invalid-format" };
  }

  if (row.UrlForm === "opaque") {
    return { accept: false, rejectReason: "invalid-scheme" };
  }

  if (row.UrlForm === "http-host") {
    return { accept: false, rejectReason: "http-not-allowed" };
  }

  // https-host or with-userinfo. Core rejects a non-canonical base before it
  // looks at the host, so userinfo and query strings are checked first.
  if (row.UrlForm === "with-userinfo" || row.ExtraPath === "query-ssrf") {
    return { accept: false, rejectReason: "non-canonical-base" };
  }

  if (row.HostClass === "ipv4-private" || row.HostClass === "ipv6-literal") {
    return { accept: false, rejectReason: "private-ip" };
  }

  return { accept: true };
}

/**
 * Oracle for tests/models/parse-validate-canvas-url.pict (census docs/PICT_CENSUS.md § S5).
 *
 * Parse-time Canvas base URL validation drift contract (issue #1184) — Core
 * `parseAndValidateCanvasUrl` (client.server.ts:165) vs QM `validateCanvasUrl`
 * (canvasUrlGuard.js:109). Request-time DNS pinning / assertPublicHostname is
 * out of scope for this model.
 *
 * Current behavior:
 *
 * Core `parseAndValidateCanvasUrl`:
 *   - Rejects malformed / non-hierarchical URLs.
 *   - Accepts https: unconditionally (no IP-literal SSRF check at parse).
 *   - Accepts http: only for localhost, 127.0.0.1, ::1, canvas.docker.
 *   - Rejects other schemes (file:, etc.).
 *
 * QM `validateCanvasUrl`:
 *   - Rejects malformed URLs.
 *   - Requires https: (http rejected, including localhost).
 *   - Rejects private/reserved IPv4 and IPv6 literals (isPrivateIPv4 /
 *     isPrivateIPv6); DNS names are accepted even when they look numeric
 *     (e.g. 10.example.edu).
 *   - Rejects non-https schemes.
 *
 * Union rule (strictest shared intent — both adapters assert this oracle):
 *   - Must be a valid absolute URL with https: scheme.
 *   - Must not target a private/reserved IP literal.
 *   - Public DNS names and public IP literals are accepted.
 *   - Userinfo, path traversal segments, and query strings do not affect
 *     parse-time acceptance (SSRF via path/query is out of scope here).
 *
 * Known divergences (oracle stays strict; failing adapter side = bug to file):
 *   - Core accepts http://localhost (QM rejects).
 *   - Core accepts https://<private-ipv4|private-ipv6> at parse (QM rejects).
 */

export type ParseValidateCanvasUrlRow = {
  UrlShape: "https-host" | "http-host" | "with-userinfo" | "relative" | "opaque";
  HostClass: "public-dns" | "localhost" | "ipv4-private" | "ipv4-public" | "ipv6-literal";
  ExtraPath: "none" | "traversal" | "query-ssrf";
};

export type ParseValidateCanvasUrlVerdict = {
  accept: boolean;
  rejectReason?: "invalid-format" | "invalid-scheme" | "http-not-allowed" | "private-ip";
};

/** Rows where Core currently diverges from the union oracle (parse-time only). */
export function coreKnownDivergence(row: ParseValidateCanvasUrlRow): boolean {
  if (row.UrlShape === "http-host" && row.HostClass === "localhost") return true;
  if (row.UrlShape === "https-host" && row.HostClass === "ipv4-private") return true;
  if (row.UrlShape === "https-host" && row.HostClass === "ipv6-literal") return true;
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

  switch (row.UrlShape) {
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
  if (row.UrlShape === "relative") {
    return { accept: false, rejectReason: "invalid-format" };
  }

  if (row.UrlShape === "opaque") {
    return { accept: false, rejectReason: "invalid-scheme" };
  }

  if (row.UrlShape === "http-host") {
    return { accept: false, rejectReason: "http-not-allowed" };
  }

  // https-host or with-userinfo
  if (row.HostClass === "ipv4-private" || row.HostClass === "ipv6-literal") {
    return { accept: false, rejectReason: "private-ip" };
  }

  return { accept: true };
}

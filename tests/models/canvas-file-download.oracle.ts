/**
 * Oracle for tests/models/canvas-file-download.pict (census docs/PICT_CENSUS.md § S5).
 *
 * Spec-derived verdict for Canvas file download in `fetchCanvasFileBytes` /
 * `downloadCanvasFile` (issue #1184), modeled from client.server.ts (~496–603)
 * — not a line-by-line copy of the try/catch:
 *
 *   1. Network / fetch failures → transport error (502 wrapper).
 *   2. Non-redirect HTTP 401/403 on the final response → auth error.
 *   3. Other non-redirect HTTP 4xx/5xx on the final response → transport error
 *      (status forwarded on CanvasApiError).
 *   4. Redirect loop exceeding CANVAS_FILE_DOWNLOAD_MAX_REDIRECTS (10) → limit
 *      error (502 "exceeded redirect limit").
 *   5. Successful 200 → ok.
 *
 * Redirect credential policy (explicit — adapter asserts hop behavior):
 *   - No redirect hop → credentialsOnRedirect "n/a".
 *   - On every redirect hop the client rebuilds headers and sends
 *     `Authorization: Bearer <apiKey>` **unless** the request URL contains
 *     `sf_verifier` (Canvas signed download URL). Cross-host redirects do
 *     **not** strip Bearer; only the sf_verifier pattern omits it.
 *   - RedirectAuth=keep → Bearer present on the redirect hop.
 *   - RedirectAuth=drop → sf_verifier on redirect target → Bearer stripped.
 *
 * Redirect host rewrite: every redirect Location is passed through
 * `resolveCanvasFileDownloadUrl`, which replaces the Location host with the
 * configured canvasUrl origin while preserving pathname/search. A cross-host
 * Location therefore becomes same-origin before fetch and SSRF re-check —
 * credentials still follow the sf_verifier rule on the rewritten URL.
 * Request-time SSRF blocking of malicious Location hosts is out of scope for
 * this model (see ssrf-ipv6-classify / parse-validate-canvas-url in #1184).
 *
 * AuthHeader dimension:
 *   - present → Bearer on the initial request (no sf_verifier on entry URL).
 *   - absent → entry URL already carries sf_verifier; Bearer omitted initially.
 *
 * ByteLimit dimension models redirect-hop budget (under = within max, over =
 * chain longer than CANVAS_FILE_DOWNLOAD_MAX_REDIRECTS).
 *
 * App-agnostic: Core adapter maps verdict to downloadCanvasFile throw/return
 * and inspects fetch Authorization headers per hop.
 */

export const CANVAS_FILE_DOWNLOAD_MAX_REDIRECTS = 10;

export type CanvasFileDownloadRow = {
  Transport: "ok" | "network-error" | "http-4xx" | "http-5xx";
  AuthHeader: "present" | "absent";
  Redirect: "none" | "same-host" | "cross-host";
  RedirectAuth: "drop" | "keep";
  ByteLimit: "under" | "over";
};

export type FileDownloadVerdict =
  | { outcome: "ok"; credentialsOnRedirect: "n/a" | "kept" | "stripped" }
  | {
      outcome: "error";
      reason: "transport" | "auth" | "limit" | "redirect-policy";
      statusCode: number;
    };

export function canvasFileDownloadOracle(row: CanvasFileDownloadRow): FileDownloadVerdict {
  if (row.Transport === "network-error") {
    return { outcome: "error", reason: "transport", statusCode: 502 };
  }

  if (row.ByteLimit === "over") {
    return { outcome: "error", reason: "limit", statusCode: 502 };
  }

  if (row.Transport === "http-4xx") {
    return { outcome: "error", reason: "auth", statusCode: 401 };
  }

  if (row.Transport === "http-5xx") {
    return { outcome: "error", reason: "transport", statusCode: 500 };
  }

  // Transport = ok
  if (row.Redirect === "none") {
    return { outcome: "ok", credentialsOnRedirect: "n/a" };
  }

  const credentialsOnRedirect = row.RedirectAuth === "drop" ? "stripped" : "kept";
  return { outcome: "ok", credentialsOnRedirect };
}

/** Maps oracle error verdicts to the CanvasApiError.statusCode downloadCanvasFile should throw. */
export function expectedDownloadErrorStatus(row: CanvasFileDownloadRow): number | null {
  const verdict = canvasFileDownloadOracle(row);
  return verdict.outcome === "error" ? verdict.statusCode : null;
}

/** Whether Authorization Bearer should appear on a request to `url`. */
export function shouldAttachBearer(apiKey: string, url: string): boolean {
  if (!apiKey) return false;
  return !url.includes("sf_verifier");
}

/** Adapter fixture: canvasUrl profile for a PICT row. */
export function canvasUrlForRow(row: CanvasFileDownloadRow): string {
  if (row.Redirect === "cross-host") {
    return "https://canvas.ubc.example";
  }
  return "http://localhost:8080";
}

/** Rewritten redirect URL the client should request after resolveCanvasFileDownloadUrl. */
export function expectedRewrittenRedirectUrl(row: CanvasFileDownloadRow, location: string): string {
  const canvasOrigin = new URL(canvasUrlForRow(row)).origin;
  const parsed = new URL(location);
  return `${canvasOrigin}${parsed.pathname}${parsed.search}`;
}

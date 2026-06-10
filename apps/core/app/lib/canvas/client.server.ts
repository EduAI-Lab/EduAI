const CANVAS_VERIFY_TIMEOUT_MS = 10_000;

/** Hostnames allowed to use plain HTTP (local Canvas dev). Production must use HTTPS. */
const HTTP_ALLOWED_HOSTNAMES = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "canvas.docker",
]);

export class CanvasVerificationError extends Error {
  readonly statusCode: 400 | 502;

  constructor(message: string, statusCode: 400 | 502) {
    super(message);
    this.name = "CanvasVerificationError";
    this.statusCode = statusCode;
  }
}

/** Validates Canvas base URL before server-side fetch (SSRF guard). */
export function parseAndValidateCanvasUrl(canvasUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(canvasUrl);
  } catch {
    throw new CanvasVerificationError("Invalid Canvas URL format", 400);
  }

  if (parsed.protocol === "https:") {
    return parsed;
  }

  if (parsed.protocol === "http:") {
    const hostname = parsed.hostname.toLowerCase();
    if (HTTP_ALLOWED_HOSTNAMES.has(hostname)) {
      return parsed;
    }
    throw new CanvasVerificationError(
      "Canvas URL must use HTTPS except for local development hosts",
      400,
    );
  }

  throw new CanvasVerificationError("Canvas URL must use HTTP or HTTPS", 400);
}

function buildCanvasProfileUrl(canvasUrl: string): string {
  const parsed = parseAndValidateCanvasUrl(canvasUrl);
  return `${parsed.origin}/api/v1/users/self/profile`;
}

/** Probes Canvas with the personal access token before persisting credentials. */
export async function verifyCanvasCredentials(
  canvasUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = buildCanvasProfileUrl(canvasUrl);

  try {
    const response = await fetchImpl(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(CANVAS_VERIFY_TIMEOUT_MS),
    });

    if (response.status === 401 || response.status === 403) {
      throw new CanvasVerificationError("Invalid Canvas API token", 400);
    }

    if (!response.ok) {
      throw new CanvasVerificationError(`Canvas returned ${response.status}`, 502);
    }
  } catch (error) {
    if (error instanceof CanvasVerificationError) {
      throw error;
    }
    throw new CanvasVerificationError("Could not reach Canvas", 502);
  }
}

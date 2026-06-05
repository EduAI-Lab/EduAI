const CANVAS_VERIFY_TIMEOUT_MS = 10_000;

export class CanvasVerificationError extends Error {
  readonly statusCode: 400 | 502;

  constructor(message: string, statusCode: 400 | 502) {
    super(message);
    this.name = "CanvasVerificationError";
    this.statusCode = statusCode;
  }
}

/** Probes Canvas with the personal access token before persisting credentials. */
export async function verifyCanvasCredentials(
  canvasUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = `${canvasUrl}/api/v1/users/self/profile`;

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

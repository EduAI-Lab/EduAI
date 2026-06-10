/** Parse a fetch response body as JSON, or return a readable error for HTML/plain 500 pages. */
export async function readJsonResponse<T = Record<string, unknown>>(
  response: Response,
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const text = await response.text();
  if (!text) {
    return {
      ok: false,
      error: response.ok ? "Empty response" : `Request failed (${response.status})`,
    };
  }

  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    const snippet = text.replace(/\s+/g, " ").trim().slice(0, 160);
    return {
      ok: false,
      error: response.ok
        ? "Server returned invalid JSON"
        : snippet || `Request failed (${response.status})`,
    };
  }
}

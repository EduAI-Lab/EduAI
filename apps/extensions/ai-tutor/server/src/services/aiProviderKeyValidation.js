/**
 * Provider-specific API-key probes used by the account validation route.
 *
 * OpenCode's models endpoint is public, so its probe intentionally makes a
 * bounded Responses request. The endpoint is fixed and credentials stay
 * in Authorization headers rather than URLs or log messages.
 */

export const OPENCODE_BASE_URL = "https://opencode.ai/zen/go/v1";
export const OPENCODE_VALIDATION_MODEL = "muse-spark-1.2-contributor";

async function providerError(response) {
  let body = {};
  if (typeof response.json === "function") {
    try {
      body = await response.json();
    } catch {
      body = {};
    }
  }
  return body?.error?.message || "Invalid API key";
}

/**
 * Perform one bounded probe for a supported provider.
 *
 * Network/abort errors deliberately bubble to the route, which owns timeout
 * and response handling. Provider HTTP errors become `{ valid: false }`.
 */
export async function validateProviderKey({
  provider,
  apiKey,
  signal,
  fetchImpl = globalThis.fetch,
}) {
  let url;
  let options;

  if (provider === "google") {
    url = "https://generativelanguage.googleapis.com/v1/models";
    options = {
      headers: { "x-goog-api-key": apiKey },
      signal,
    };
  } else if (provider === "openai") {
    url = "https://api.openai.com/v1/models";
    options = {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    };
  } else if (provider === "opencode") {
    url = `${OPENCODE_BASE_URL}/responses`;
    options = {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENCODE_VALIDATION_MODEL,
        input: "Reply with OK.",
        max_output_tokens: 32,
        stream: false,
      }),
      signal,
    };
  } else {
    return { valid: false, error: "Unsupported provider" };
  }

  const response = await fetchImpl(url, options);
  if (!response.ok) {
    return { valid: false, error: await providerError(response) };
  }

  return { valid: true };
}

/**
 * @file The shared "list this provider's live models" call (#1823).
 *
 * One fetch and one normalization per provider. Callers differ only in whose key
 * they pass and what they do with the list: the help assistant's settings pane
 * passes the USER'S own key and writes nothing to the shared admin catalogue.
 *
 * The key always travels in a request header, never in a URL — a key in a query
 * string ends up in proxy and server logs.
 */
import { z } from "zod";

import { OPENCODE_BASE_URL } from "~/lib/ai/providers";
import type { SupportedProvider } from "~/lib/ai/provider-types";

export type ListModelsResult =
  | { ok: true; models: string[] }
  | { ok: false; reason: "unsupported" | "rejected" | "unreachable"; status?: number };

const FETCH_TIMEOUT_MS = 15_000;
const MAX_MODELS = 200;

/** `GET /v1/models` on OpenAI-compatible APIs (OpenAI, OpenCode), reduced to model ids. */
const openAiCompatibleModelIds = z
  .object({ data: z.array(z.object({ id: z.string() })) })
  .transform((body) => body.data.map((model) => model.id));

/** Gemini's model list, reduced to ids that can generate content. */
const geminiModelIds = z
  .object({
    models: z
      .array(
        z.object({
          name: z.string(),
          supportedGenerationMethods: z.array(z.string()).optional(),
        }),
      )
      .default([]),
  })
  .transform((body) =>
    body.models
      .filter((model) => model.supportedGenerationMethods?.includes("generateContent") ?? true)
      .map((model) => model.name.replace(/^models\//, "")),
  );

/** Providers whose catalogue a user can fetch with their own key. */
export const USER_LISTABLE_PROVIDERS: readonly SupportedProvider[] = [
  "openai",
  "google",
  "opencode",
];

const OPENAI_CHAT_MODEL = /^(gpt-|o\d|chatgpt-)/;

function request(
  provider: SupportedProvider,
  apiKey: string,
): { url: string; headers: HeadersInit } | null {
  switch (provider) {
    case "openai":
      return {
        url: "https://api.openai.com/v1/models",
        headers: { Authorization: `Bearer ${apiKey}` },
      };
    case "google":
      return {
        url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
        headers: { "x-goog-api-key": apiKey },
      };
    case "opencode":
      return { url: `${OPENCODE_BASE_URL}/models`, headers: { Authorization: `Bearer ${apiKey}` } };
    default:
      return null;
  }
}

export async function listProviderModels(
  provider: SupportedProvider,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ListModelsResult> {
  const target = request(provider, apiKey);
  if (!target) return { ok: false, reason: "unsupported" };

  let response: Response;
  try {
    response = await fetchImpl(target.url, {
      headers: target.headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (!response.ok) return { ok: false, reason: "rejected", status: response.status };

  const body = await response.json().catch(() => null);
  const parsed =
    provider === "google"
      ? geminiModelIds.safeParse(body)
      : openAiCompatibleModelIds.safeParse(body);
  const ids = parsed.success ? parsed.data : [];
  // OpenAI's list includes embeddings, audio and image models; keep the chat families.
  const chatIds = provider === "openai" ? ids.filter((id) => OPENAI_CHAT_MODEL.test(id)) : ids;
  // A fresh array from the Set, so sorting it in place mutates nothing shared.
  const unique = [...new Set(chatIds)];
  unique.sort();
  const models = unique.slice(0, MAX_MODELS);
  return { ok: true, models };
}

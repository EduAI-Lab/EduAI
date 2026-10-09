/**
 * @file Typed client calls for the assistant's endpoints (#1820, #1823).
 *
 * Every response is parsed at this boundary. The settings shapes mirror
 * `assistant-user-settings.server.ts`; no response here ever carries key material.
 */
import { z } from "zod";

import type { PublishedAssistantContext } from "~/lib/assistant/assistant-visibility";

import { threadSourceSchema } from "./assistant-thread";

const FALLBACK_ERROR = "Something went wrong. Please try again.";
const NETWORK_ERROR = "Couldn't reach EduAI. Check your connection and try again.";

/** Every non-2xx body from these routes; validation errors carry no user-facing copy. */
const errorBody = z.object({ error: z.string().optional(), code: z.string().optional() }).catch({});

function errorMessage(body: z.infer<typeof errorBody>): string {
  return body.error && body.error !== "VALIDATION_ERROR" ? body.error : FALLBACK_ERROR;
}

const askAnswer = z.object({
  answer: z.string(),
  sources: z.array(threadSourceSchema).catch([]),
  scope: z.object({ docs: z.boolean(), material: z.string().nullable() }),
});

export type AskResult =
  | ({ ok: true } & z.infer<typeof askAnswer>)
  | { ok: false; code: string | null; message: string };

/** What `POST /api/assistant/ask` accepts as its `context` hint. */
type AskContextHint = { courseId: string; materialId?: string };

/** The hint sent with a question: only when the server already granted material scope. */
function contextHint(context: PublishedAssistantContext | null): AskContextHint | null {
  if (!context?.materialScope) return null;
  const hint: AskContextHint = { courseId: context.courseId };
  if (context.materialId) hint.materialId = context.materialId;
  return hint;
}

export async function askAssistant(input: {
  question: string;
  history: Array<{ role: "user" | "assistant"; content: string }>;
  context: PublishedAssistantContext | null;
}): Promise<AskResult> {
  let response: Response;
  try {
    response = await fetch("/api/assistant/ask", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question: input.question,
        history: input.history,
        context: contextHint(input.context),
      }),
    });
  } catch {
    return { ok: false, code: "network", message: NETWORK_ERROR };
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorBody.parse(body);
    return { ok: false, code: parsed.code ?? null, message: errorMessage(parsed) };
  }
  const answer = askAnswer.safeParse(body);
  return answer.success
    ? { ok: true, ...answer.data }
    : { ok: false, code: null, message: FALLBACK_ERROR };
}

const providerOption = z.object({
  name: z.string(),
  displayName: z.string(),
  requiresKey: z.boolean(),
  hasOwnKey: z.boolean(),
  maskedKey: z.string().nullable(),
  platformAvailable: z.boolean(),
  canFetchModels: z.boolean(),
  adminModels: z.array(z.string()),
  userModels: z.array(z.string()).nullable(),
  offeredModels: z.array(z.string()),
});

const userSettings = z.object({
  providers: z.array(providerOption),
  preferred: z.object({ provider: z.string(), model: z.string().nullable() }).nullable(),
  effective: z
    .object({
      provider: z.string(),
      model: z.string(),
      keySource: z.enum(["SAVED", "PLATFORM", "PASTED"]),
    })
    .nullable(),
});

export type AssistantProviderOption = z.infer<typeof providerOption>;
export type AssistantUserSettings = z.infer<typeof userSettings>;

const modelList = z.object({ provider: z.string(), models: z.array(z.string()) });

export type SettingsCallResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function settingsCall<T>(
  url: string,
  schema: z.ZodType<T>,
  init?: RequestInit,
): Promise<SettingsCallResult<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    return { ok: false, message: NETWORK_ERROR };
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) return { ok: false, message: errorMessage(errorBody.parse(body)) };
  const parsed = schema.safeParse(body);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false, message: FALLBACK_ERROR };
}

export function fetchAssistantSettings() {
  return settingsCall("/api/assistant/settings", userSettings);
}

export type SaveAssistantSettingsRequest = {
  provider: string;
  model: string;
  apiKey?: string;
  removeKey?: boolean;
  enabledModels?: string[] | null;
};

export function saveAssistantSettings(input: SaveAssistantSettingsRequest) {
  return settingsCall("/api/assistant/settings", userSettings, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function resetAssistantSettings() {
  return settingsCall("/api/assistant/settings/reset", userSettings, { method: "POST" });
}

export function fetchProviderModels(provider: string) {
  return settingsCall("/api/assistant/settings/models", modelList, {
    method: "POST",
    body: JSON.stringify({ provider }),
  });
}

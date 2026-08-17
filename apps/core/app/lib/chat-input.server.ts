/**
 * Bounded request-body parsing and cheap validation for POST /api/chat.
 *
 * The route receives client-controlled transcripts. Keep the byte limit in
 * front of JSON.parse, then reject pathological message lists before any
 * database, provider, or admission work can start.
 */

import { BoundedBodyError, readBoundedBody } from "~/lib/net/bounded-body.server";

export const CHAT_MAX_BODY_BYTES_DEFAULT = 2 * 1024 * 1024;
export const CHAT_MAX_MESSAGES_DEFAULT = 100;
export const CHAT_MAX_MESSAGE_CHARS_DEFAULT = 32_768;
export const CHAT_MAX_TOTAL_MESSAGE_CHARS_DEFAULT = 131_072;

export type ChatInputLimits = {
  maxBodyBytes: number;
  maxMessages: number;
  maxMessageChars: number;
  maxTotalMessageChars: number;
};

export type ChatInputLimitOverrides = Partial<ChatInputLimits>;

export type BoundedJsonReadResult =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413 | 499; error: string };

export type ChatBodyReadResult = BoundedJsonReadResult;

export type ChatBodyValidationResult =
  | {
      ok: true;
      body: Record<string, unknown>;
      messages: unknown[];
    }
  | { ok: false; status: 400 | 422; error: string };

function positiveEnvInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Resolve ingress limits, with positive integer environment overrides. */
export function resolveChatInputLimits(overrides: ChatInputLimitOverrides = {}): ChatInputLimits {
  const fromEnv = (name: string, fallback: number, explicit?: number) => {
    if (explicit !== undefined) {
      return Number.isSafeInteger(explicit) && explicit > 0 ? explicit : fallback;
    }
    return positiveEnvInt(name, fallback);
  };

  return {
    maxBodyBytes: fromEnv(
      "CHAT_MAX_BODY_BYTES",
      CHAT_MAX_BODY_BYTES_DEFAULT,
      overrides.maxBodyBytes,
    ),
    maxMessages: fromEnv("CHAT_MAX_MESSAGES", CHAT_MAX_MESSAGES_DEFAULT, overrides.maxMessages),
    maxMessageChars: fromEnv(
      "CHAT_MAX_MESSAGE_CHARS",
      CHAT_MAX_MESSAGE_CHARS_DEFAULT,
      overrides.maxMessageChars,
    ),
    maxTotalMessageChars: fromEnv(
      "CHAT_MAX_TOTAL_MESSAGE_CHARS",
      CHAT_MAX_TOTAL_MESSAGE_CHARS_DEFAULT,
      overrides.maxTotalMessageChars,
    ),
  };
}

function invalidBody(error = "Invalid JSON body"): {
  ok: false;
  status: 400;
  error: string;
} {
  return { ok: false, status: 400, error };
}

function sizeExceeded(error: string): { ok: false; status: 413; error: string } {
  return {
    ok: false,
    status: 413,
    error,
  };
}

/**
 * Read at most maxBytes from a request stream before decoding or parsing it.
 * Content-Length is an early rejection hint only; streamed/chunked bodies are
 * counted as they arrive so a missing or dishonest header cannot bypass it.
 */
export async function readBoundedJson(
  request: Request,
  maxBytes: number,
  sizeError: string,
): Promise<BoundedJsonReadResult> {
  try {
    const bytes = await readBoundedBody(request, maxBytes);
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { ok: true, body: JSON.parse(text) as unknown };
  } catch (error) {
    if (error instanceof BoundedBodyError) {
      if (error.status === 413) return sizeExceeded(sizeError);
      if (error.status === 499) return { ok: false, status: 499, error: "Request aborted" };
      if (error.message === "Invalid Content-Length") return invalidBody(error.message);
    }
    return invalidBody();
  }
}

export async function readBoundedChatJson(
  request: Request,
  maxBytes: number,
): Promise<ChatBodyReadResult> {
  return readBoundedJson(request, maxBytes, "Chat request body exceeds size limit");
}

function serializedContentChars(content: unknown): number | null {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return null;
  try {
    const serialized = JSON.stringify(content);
    return typeof serialized === "string" ? serialized.length : null;
  } catch {
    return null;
  }
}

/**
 * Validate only cheap, bounded ingress fields. The route intentionally keeps
 * its existing role filtering and downstream model-specific checks; this
 * boundary is about preventing unbounded work and persistence.
 */
export function validateChatBody(
  input: unknown,
  overrides: ChatInputLimitOverrides = {},
): ChatBodyValidationResult {
  const limits = resolveChatInputLimits(overrides);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, status: 400, error: "Invalid chat request body" };
  }

  const body = input as Record<string, unknown>;
  if (body.messages !== undefined && !Array.isArray(body.messages)) {
    return { ok: false, status: 422, error: "messages must be an array" };
  }
  const messages = Array.isArray(body.messages) ? body.messages : [];
  if (messages.length > limits.maxMessages) {
    return {
      ok: false,
      status: 422,
      error: "messages exceeds maximum count",
    };
  }

  let totalMessageChars = 0;
  for (const message of messages) {
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      return { ok: false, status: 422, error: "each message must be an object" };
    }
    const candidate = message as Record<string, unknown>;
    const contentChars = serializedContentChars(candidate.content);
    if (contentChars === null) {
      return {
        ok: false,
        status: 422,
        error: "each message content must be a string or parts array",
      };
    }
    if (contentChars > limits.maxMessageChars) {
      return {
        ok: false,
        status: 422,
        error: "message content exceeds maximum length",
      };
    }
    totalMessageChars += contentChars;
    if (totalMessageChars > limits.maxTotalMessageChars) {
      return {
        ok: false,
        status: 422,
        error: "messages exceed aggregate character limit",
      };
    }
  }

  return { ok: true, body, messages };
}

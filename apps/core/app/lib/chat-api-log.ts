/**
 * Opt-in debug logging for the chat API hot path.
 * Set `CHAT_DEBUG_LOG=1` or `LOG_LEVEL=debug` to enable.
 */
export function isChatApiDebug(): boolean {
  return (
    process.env.CHAT_DEBUG_LOG === "1" ||
    process.env.LOG_LEVEL?.toLowerCase() === "debug"
  );
}

/** Verbose step-by-step tracing. Set `CHAT_API_TRACE=1` in apps/core/.env */
export function isChatApiTrace(): boolean {
  return process.env.CHAT_API_TRACE === "1" || isChatApiDebug();
}

export function chatApiDebug(message: string, payload?: Record<string, unknown>): void {
  if (!isChatApiDebug()) return;
  if (payload !== undefined) {
    console.log(`[chat-api] ${message}`, payload);
  } else {
    console.log(`[chat-api] ${message}`);
  }
}

export function chatApiTrace(message: string, payload?: Record<string, unknown>): void {
  if (!isChatApiTrace()) return;
  if (payload !== undefined) {
    console.log(`[chat-api:trace] ${message}`, payload);
  } else {
    console.log(`[chat-api:trace] ${message}`);
  }
}

type ChatApiRejectTrace = Record<string, unknown>;

/** Always logs rejections to the server console (status >= 400). */
export function chatApiReject(
  status: number,
  body: Record<string, unknown>,
  trace?: ChatApiRejectTrace,
): Response {
  console.error("[chat-api] rejected", {
    status,
    body,
    trace,
  });
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

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

export function chatApiDebug(message: string, payload?: Record<string, unknown>): void {
  if (!isChatApiDebug()) return;
  if (payload !== undefined) {
    console.log(message, payload);
  } else {
    console.log(message);
  }
}

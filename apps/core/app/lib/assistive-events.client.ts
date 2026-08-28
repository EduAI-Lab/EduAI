import type { JsonObject } from "~/lib/json-value";
export type PostAssistiveClientEventInput = {
  eventType:
    | "mode_toggled"
    | "expand_click"
    | "task_initiation"
    | "re_orientation"
    | "session_completion";
  adhdAssist: boolean;
  chatId?: string | null;
  metrics?: JsonObject;
};

/** Fire-and-forget client telemetry; never blocks UI. */
export function postAssistiveClientEvent(input: PostAssistiveClientEventInput): void {
  // JSON.stringify drops undefined values, so an event with no chat or metrics
  // posts the same minimal body it always did.
  const body = {
    eventType: input.eventType,
    adhdAssist: input.adhdAssist,
    chatId: input.chatId || undefined,
    metrics: input.metrics,
  };

  fetch("/api/assistive-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  }).catch((error) => {
    console.error("Failed to record assistive event:", error);
  });
}

export type PostAssistiveClientEventInput = {
  eventType:
    | "mode_toggled"
    | "expand_click"
    | "task_initiation"
    | "re_orientation"
    | "session_completion";
  adhdAssist: boolean;
  chatId?: string | null;
  metrics?: Record<string, unknown>;
};

/** Fire-and-forget client telemetry; never blocks UI. */
export function postAssistiveClientEvent(input: PostAssistiveClientEventInput): void {
  const body = {
    eventType: input.eventType,
    adhdAssist: input.adhdAssist,
    ...(input.chatId ? { chatId: input.chatId } : {}),
    ...(input.metrics ? { metrics: input.metrics } : {}),
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

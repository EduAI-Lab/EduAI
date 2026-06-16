/** Client-side UI telemetry for assistive mode (derived metrics only — never message text). */

export type AssistiveClientEventType =
  | "mode_toggled"
  | "expand_click"
  | "task_initiation"
  | "re_orientation"
  | "session_completion";

export type PostAssistiveEventInput = {
  eventType: AssistiveClientEventType;
  chatId?: string;
  adhdAssist?: boolean;
  metrics?: Record<string, unknown>;
};

export async function postAssistiveEvent(input: PostAssistiveEventInput): Promise<void> {
  try {
    await fetch("/api/assistive-events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input),
    });
  } catch (error) {
    console.error("Failed to record assistive event:", error);
  }
}

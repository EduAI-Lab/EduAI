import { useEffect, useRef } from "react";
import { CHAT_MESSAGE_INPUT_ID } from "~/components/assistive/active-highlight";
import { postAssistiveClientEvent } from "~/lib/assistive-events.client";

type UseAssistiveReorientationArgs = {
  enabled: boolean;
  adhdAssist: boolean;
  chatId: string | null;
  /** Increment when an assistant turn finishes so a new latency window opens. */
  epoch: number;
};

/**
 * Measures re-orientation latency: time from assistant render complete to the
 * learner's first pointer/keyboard/focus action (#525 / U6–U7).
 */
export function useAssistiveReorientation({
  enabled,
  adhdAssist,
  chatId,
  epoch,
}: UseAssistiveReorientationArgs): void {
  const pendingStartedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || epoch <= 0) {
      pendingStartedAt.current = null;
      return;
    }
    pendingStartedAt.current = performance.now();
  }, [enabled, epoch]);

  useEffect(() => {
    if (!enabled || epoch <= 0 || pendingStartedAt.current == null) return;

    const record = () => {
      const startedAt = pendingStartedAt.current;
      if (startedAt == null) return;
      pendingStartedAt.current = null;

      postAssistiveClientEvent({
        eventType: "re_orientation",
        adhdAssist,
        chatId,
        metrics: {
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          path: "/chat",
          elementId: "chat-reorientation",
          clientTimestamp: new Date().toISOString(),
        },
      });
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      // chat.tsx auto-focuses the composer after each assistant turn; that
      // programmatic focusin is not a learner re-orientation action.
      if (target instanceof HTMLElement && target.id === CHAT_MESSAGE_INPUT_ID) {
        return;
      }
      record();
    };

    const opts: AddEventListenerOptions = { capture: true, once: true };
    window.addEventListener("pointerdown", record, opts);
    window.addEventListener("keydown", record, opts);
    window.addEventListener("focusin", onFocusIn, opts);

    return () => {
      window.removeEventListener("pointerdown", record, opts);
      window.removeEventListener("keydown", record, opts);
      window.removeEventListener("focusin", onFocusIn, opts);
    };
  }, [enabled, adhdAssist, chatId, epoch]);
}

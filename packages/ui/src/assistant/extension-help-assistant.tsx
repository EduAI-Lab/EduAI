/**
 * Penny inside an extension (#1958). The extension has no Core root loader, so
 * the gate, the user and the course scope come from Core's `GET
 * /api/assistant/gate`, called cross-origin with the Core session cookie. Any
 * failure — signed out, Core down, origin not allowed — renders nothing until a
 * retry succeeds; the gate is also re-read whenever the tab becomes visible.
 *
 * The widget is fixed-positioned, so this can sit in the shell's header actions:
 * only the header button (chat screens) takes up space there.
 */
import { useEffect, useState } from "react";

import {
  fetchAssistantGate,
  setAssistantCoreUrl,
  type AssistantGateResponse,
} from "./assistant-api";
import {
  HelpAssistantHeaderButton,
  HelpAssistantWidget,
  type AssistantPlacement,
} from "./help-assistant";
import { isAssistantVisible } from "./shared";

const GATE_RETRY_MS = 5_000;
const GATE_RETRY_MAX_MS = 5 * 60_000;

export function ExtensionHelpAssistant({
  coreUrl,
  coreCourseId,
  placement,
}: {
  coreUrl: string;
  /** The Core course this page is about; Core re-validates it for this reader. */
  coreCourseId: string | null;
  placement: AssistantPlacement;
}) {
  const [state, setState] = useState<AssistantGateResponse | null>(null);
  const coreOrigin = coreUrl.replace(/\/+$/, "");

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    setAssistantCoreUrl(coreOrigin);
    const load = () => {
      clearTimeout(retry);
      void fetchAssistantGate(coreCourseId).then((result) => {
        if (cancelled) return;
        if (result.ok) {
          attempt = 0;
          setState(result.data);
          return;
        }
        // A 429 or network blip keeps the last answer and retries, rather than hiding Penny until reload.
        retry = setTimeout(load, Math.min(GATE_RETRY_MS * 2 ** attempt++, GATE_RETRY_MAX_MS));
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearTimeout(retry);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [coreOrigin, coreCourseId]);

  if (!state) return null;
  const visible = isAssistantVisible(state.gate, state.context);
  return (
    <>
      <HelpAssistantHeaderButton visible={visible} placement={placement} />
      <HelpAssistantWidget
        user={state.user}
        gate={state.gate}
        published={state.context}
        placement={placement}
        coreUrl={coreOrigin}
      />
    </>
  );
}

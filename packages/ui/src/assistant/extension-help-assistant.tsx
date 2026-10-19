/**
 * Penny inside an extension (#1958). The extension has no Core root loader, so
 * the gate, the user and the course scope come from Core's `GET
 * /api/assistant/gate`, called cross-origin with the Core session cookie. Any
 * failure — signed out, Core down, origin not allowed — renders nothing.
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
    setAssistantCoreUrl(coreOrigin);
    void fetchAssistantGate(coreCourseId).then((result) => {
      if (!cancelled) setState(result.ok ? result.data : null);
    });
    return () => {
      cancelled = true;
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

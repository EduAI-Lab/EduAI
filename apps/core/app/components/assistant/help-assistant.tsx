/**
 * Core's mount of the shared help assistant (#1822), once in `CoreAppShell`. The
 * render condition is server-decided by the root loader; the course and
 * material views publish their context through `@eduai/ui/assistant`'s events.
 */
import { Link, useLocation, useRouteLoaderData } from "react-router";
import {
  assistantPlacementFor,
  HelpAssistantHeaderButton,
  HelpAssistantWidget,
  isAssistantVisible,
  usePublishedAssistantContext,
  type AssistantGateSnapshot,
} from "@eduai/ui/assistant";

import type { loader as rootLoader } from "~/root";

export { BUBBLE_VISIBLE_ATTRIBUTE } from "@eduai/ui/assistant";

/** Routes whose page is itself a full-height chat with a composer at the bottom. */
const CHAT_SCREEN_PREFIXES = ["/chat", "/instructor/chat", "/admin/chat"];

/** The gate snapshot, the published page context, and what follows from them. */
export function useAssistantVisibility() {
  const rootData = useRouteLoaderData<typeof rootLoader>("root");
  const gate: AssistantGateSnapshot | undefined =
    rootData && "assistant" in rootData ? rootData.assistant : undefined;
  const published = usePublishedAssistantContext();
  const { pathname } = useLocation();
  return {
    gate,
    published,
    visible: isAssistantVisible(gate, published),
    placement: assistantPlacementFor(pathname, CHAT_SCREEN_PREFIXES),
  };
}

/** The header trigger used on chat screens. Renders nothing elsewhere. */
export function AssistantHeaderButton() {
  const { visible, placement } = useAssistantVisibility();
  return <HelpAssistantHeaderButton visible={visible} placement={placement} />;
}

export function HelpAssistant({ user }: { user: { id: string; role?: string | null } }) {
  const { gate, published, placement } = useAssistantVisibility();
  return (
    <HelpAssistantWidget
      user={user}
      gate={gate}
      published={published}
      placement={placement}
      LinkComponent={Link}
    />
  );
}

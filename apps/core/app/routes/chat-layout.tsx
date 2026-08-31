import { Outlet } from "react-router";

import { useChatHistory } from "~/hooks/api/use-chat-history";

export type OwnChatHistory = ReturnType<typeof useChatHistory>;

/** Keeps the history request and list mounted while the active conversation changes. */
export default function ChatLayout() {
  const history = useChatHistory({ scope: "own", limit: 50 });
  return <Outlet context={history} />;
}

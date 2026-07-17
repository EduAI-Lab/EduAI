import { useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { ChatScreen } from "~/components/chat/chat-screen";
import {
  chatPreferencesAction,
  loadChatBaseData,
} from "~/lib/chat/chat-route.server";

/**
 * `/chat` — a new, blank conversation. The route is the source of truth for
 * which chat is open: there is no sessionStorage auto-restore here. Selecting a
 * past conversation navigates to `/chat/:chatId`, which hydrates it from the DB.
 */
export async function loader({ request }: LoaderFunctionArgs) {
  return loadChatBaseData(request);
}

export const action = chatPreferencesAction;

export default function Chat() {
  const data = useLoaderData<typeof loader>();
  return <ChatScreen data={data} initialTranscript={null} />;
}

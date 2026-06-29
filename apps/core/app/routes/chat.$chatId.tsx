import { redirect, useLoaderData } from "react-router";
import type { LoaderFunctionArgs } from "react-router";

import { ChatScreen } from "~/components/chat/chat-screen";
import {
  chatPreferencesAction,
  loadChatBaseData,
  loadChatTranscript,
} from "~/lib/chat/chat-route.server";

/**
 * `/chat/:chatId` — resume a conversation. The transcript is loaded from the DB
 * here (the route, not sessionStorage, is the source of truth). A missing chat
 * or one the viewer may not read redirects to `/chat` (no existence leak).
 */
export async function loader({ request, params }: LoaderFunctionArgs) {
  const base = await loadChatBaseData(request);

  const chatId = params.chatId;
  if (!chatId) {
    throw redirect("/chat");
  }

  const transcript = await loadChatTranscript(
    { id: base.user.id, role: base.user.role },
    chatId,
  );
  if (!transcript) {
    throw redirect("/chat");
  }

  return { ...base, transcript };
}

export const action = chatPreferencesAction;

export default function ChatById() {
  const { transcript, ...data } = useLoaderData<typeof loader>();
  // Key by chat id so navigating between conversations remounts the screen,
  // giving each chat a fresh composer seeded from its own transcript.
  return (
    <ChatScreen key={transcript.chat.id} data={data} initialTranscript={transcript} />
  );
}

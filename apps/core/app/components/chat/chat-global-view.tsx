import { ChatConversationLayout } from "~/components/chat/chat-conversation-layout";
import type { ChatViewSharedProps } from "~/components/chat/chat-view-types";

export function ChatGlobalView(props: ChatViewSharedProps) {
  return (
    <ChatConversationLayout
      {...props}
      showCourseSelector={false}
      bannerTitle="Global chat"
      bannerDescription="Platform-wide conversation — not tied to a specific course. Available to admins and unit admins."
    />
  );
}

import { ChatConversationLayout } from "~/components/chat/chat-conversation-layout";
import { AdminChatWelcome } from "~/components/chat/admin-chat-welcome";
import type { ChatViewSharedProps } from "~/components/chat/chat-view-types";

export function AdminChatView(props: ChatViewSharedProps) {
  return (
    <ChatConversationLayout
      {...props}
      showCourseSelector
      WelcomeComponent={AdminChatWelcome}
      bannerTitle="Admin chatbot"
      bannerDescription="Operational assistant for enrollments, users, bug reports, and course metadata. Only models with tool support are listed — register them in Admin → AI Models."
    />
  );
}

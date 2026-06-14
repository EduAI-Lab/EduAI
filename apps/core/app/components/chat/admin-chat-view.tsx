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
      bannerDescription="Operational assistant for enrollments, users, bug reports, and course metadata. Use a tool-capable model (e.g. vllm:qwen2.5-32b-instruct). The 7B vLLM model does not support admin tools on cmps01."
    />
  );
}

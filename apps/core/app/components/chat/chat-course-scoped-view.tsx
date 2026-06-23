import { ChatConversationLayout } from "~/components/chat/chat-conversation-layout";
import type { ChatViewSharedProps } from "~/components/chat/chat-view-types";

export function ChatCourseScopedView(props: ChatViewSharedProps) {
  return (
    <ChatConversationLayout
      {...props}
      showCourseSelector
      bannerTitle="Course-scoped chat"
      bannerDescription="Select a course below so EduAI can use the right materials and context."
    />
  );
}

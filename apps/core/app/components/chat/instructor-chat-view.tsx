import { ChatConversationLayout } from "~/components/chat/chat-conversation-layout";
import { InstructorChatWelcome } from "~/components/chat/instructor-chat-welcome";
import type { ChatViewSharedProps } from "~/components/chat/chat-view-types";

/**
 * #1659: course-scoped counterpart to AdminChatView. Unlike admin chat
 * (platform-wide, no course filter), this one shows the course selector so an
 * instructor teaching more than one published course can switch between them
 * — each selection opens a fresh, separately-scoped chat (instructor.chat.tsx
 * re-validates course access server-side on every turn regardless).
 */
export function InstructorChatView(props: ChatViewSharedProps) {
  return (
    <ChatConversationLayout
      {...props}
      showCourseSelector
      WelcomeComponent={InstructorChatWelcome}
      bannerTitle="Course Assistant"
      bannerDescription="Read-only ops assistant for this course's roster and topics. Cannot see other courses, platform users, or bug reports."
    />
  );
}

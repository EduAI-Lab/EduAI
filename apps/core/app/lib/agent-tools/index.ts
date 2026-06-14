import type { ChatToolContext } from "./chat-mode";
import { createAdminChatTools } from "./create-admin-chat-tools";
import { createLearningChatTools } from "./create-learning-chat-tools";
import type { ChatMode } from "./chat-mode";

export {
  getAccessibleCourse,
  getAccessibleCourseTopic,
  listAccessibleCourseTopics,
  listAccessibleCourses,
} from "./course-context.server";
export {
  listAdminBugReportsForChat,
  listAdminCourseEnrollments,
  listAdminUsers,
  resolveAdminCourseId,
} from "./admin-context.server";
export { buildAdminChatStreamConfig } from "./admin-chat-stream.server";
export { buildLearningChatStreamConfig } from "./learning-chat-stream.server";
export { buildAdminSystemPrompt } from "./admin-chat-prompts";
export {
  buildLearningAssistantSystemPrompt,
  buildLearningSystemPrompt,
} from "./learning-chat-prompts";
export {
  chatbotTypeFromMode,
  parseChatMode,
  type ChatMode,
  type ChatToolContext,
} from "./chat-mode";
export { createAdminChatTools } from "./create-admin-chat-tools";
export { createLearningChatTools } from "./create-learning-chat-tools";

/** @deprecated Prefer createLearningChatTools / createAdminChatTools directly. */
export function createChatTools(ctx: ChatToolContext, mode: ChatMode) {
  return mode === "admin" ? createAdminChatTools(ctx) : createLearningChatTools(ctx);
}

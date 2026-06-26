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
  listAdminCourseTopics,
  getAdminCourseTopic,
  listAdminUsers,
  resolveAdminCourseId,
} from "./admin-context.server";
export {
  createAdminEnrollment,
  createAdminCourseTopic,
  createAdminUser,
  deactivateAdminEnrollment,
  deleteAdminCourseTopic,
  deleteAdminUser,
  isAdminWriteToolName,
  runConfirmedAdminWriteTool,
  runAdminWriteTool,
  requireWriteConfirmation,
  userRefValidationError,
  updateAdminBugReportStatus,
  updateAdminCourseTopic,
  updateAdminEnrollmentRole,
  updateAdminUser,
  ADMIN_WRITE_TOOL_NAMES,
} from "./admin-mutations.server";
export { resolveAdminUserId } from "./admin-context.server";
export {
  buildAdminSystemPrompt,
  buildLearningAssistantSystemPrompt,
  buildLearningSystemPrompt,
  chatbotTypeFromMode,
  parseChatMode,
  type ChatMode,
  type ChatToolContext,
} from "./chat-mode";

export function createChatTools(ctx: ChatToolContext, mode: ChatMode) {
  return mode === "admin" ? createAdminChatTools(ctx) : createLearningChatTools(ctx);
}

import type { ChatToolContext } from "./chat-mode";
import { createAdminChatTools } from "./create-admin-chat-tools";
import { createLearningChatTools } from "./create-learning-chat-tools";
import type { ChatMode } from "./chat-mode";

export {
  ADMIN_CORE_TOOL_NAMES,
  pickCoreAdminChatTools,
  type AdminChatToolRegistry,
} from "./create-admin-chat-tools";
export type LearningChatToolRegistry = ReturnType<typeof createLearningChatTools>;

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

// Overloads narrow the return type on a literal `mode` argument (e.g. inside
// an `if (chatMode === "admin")` block) so callers get the concrete tool
// registry type back — no manual cast needed to pass it to
// pickCoreAdminChatTools (AdminChatToolRegistry-typed).
export function createChatTools(
  ctx: ChatToolContext,
  mode: "admin",
): ReturnType<typeof createAdminChatTools>;
export function createChatTools(
  ctx: ChatToolContext,
  mode: "learning",
): ReturnType<typeof createLearningChatTools>;
export function createChatTools(ctx: ChatToolContext, mode: ChatMode) {
  return mode === "admin" ? createAdminChatTools(ctx) : createLearningChatTools(ctx);
}

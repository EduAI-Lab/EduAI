import type { ChatToolContext } from "./chat-mode";
import { createAdminChatTools } from "./create-admin-chat-tools";
import { createInstructorChatTools } from "./create-instructor-chat-tools";
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
  buildInstructorSystemPrompt,
  buildLearningAssistantSystemPrompt,
  buildLearningSystemPrompt,
  chatbotTypeFromMode,
  isPrivilegedChatMode,
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
  mode: "instructor",
): ReturnType<typeof createInstructorChatTools>;
export function createChatTools(
  ctx: ChatToolContext,
  mode: "learning",
): ReturnType<typeof createLearningChatTools>;
// #1659: chat.ts's route calls this with the already-resolved but
// non-literal `chatMode: ChatMode` (not narrowed to one of the three literals
// above at that call site), so a fallback overload accepting the whole union
// — and returning the union of all three registries — is needed alongside
// the narrowing overloads, not instead of them.
export function createChatTools(
  ctx: ChatToolContext,
  mode: ChatMode,
):
  | ReturnType<typeof createAdminChatTools>
  | ReturnType<typeof createInstructorChatTools>
  | ReturnType<typeof createLearningChatTools>;
export function createChatTools(ctx: ChatToolContext, mode: ChatMode) {
  if (mode === "admin") return createAdminChatTools(ctx);
  if (mode === "instructor") return createInstructorChatTools(ctx);
  return createLearningChatTools(ctx);
}

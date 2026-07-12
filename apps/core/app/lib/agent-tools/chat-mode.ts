import type { RbacUser } from "~/lib/auth/course-access.server";

export type ChatMode = "learning" | "admin";

export type ChatToolContext = {
  user: RbacUser;
  effectiveCourseId: string | null;
  effectiveCourseCode?: string | null;
  /** #839: when true (student caller), exclude hidden/scheduled materials from RAG. */
  restrictToStudentVisible?: boolean;
};

export function parseChatMode(value: unknown): ChatMode {
  return value === "admin" ? "admin" : "learning";
}

export function chatbotTypeFromMode(mode: ChatMode): "LEARNING" | "ADMIN" {
  return mode === "admin" ? "ADMIN" : "LEARNING";
}

type PromptOptions = {
  courseCode?: string | null;
  customPrompt?: string | null;
};

export function buildLearningAssistantSystemPrompt({
  courseCode,
  customPrompt,
  citeMaterials = false,
}: PromptOptions & { citeMaterials?: boolean }): string {
  if (customPrompt) {
    return customPrompt;
  }

  const closing = citeMaterials
    ? "Always be helpful, accurate, and cite the course materials when using them in your response. Use markdown for formatting."
    : "Be helpful, conversational, and accurate. Use markdown for formatting.";

  return `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

IMPORTANT: You have access to the full conversation history in the messages array. When users ask about previous messages or context, refer to the conversation history provided to you. DO NOT claim you cannot remember past messages.

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ""}

${closing}`;
}

export function buildLearningSystemPrompt({ courseCode, customPrompt }: PromptOptions): string {
  if (customPrompt) {
    return customPrompt;
  }

  return `You are EduAI, a helpful AI assistant for students and faculty at UBC Okanagan (UBCO).

IMPORTANT: You have access to the full conversation history in the messages array. When users ask about previous messages or context, refer to the conversation history provided to you. DO NOT claim you cannot remember past messages.

You have access to two tools:
- getInformation: searches uploaded course materials (syllabi, lectures, assignments, etc.)
- webSearch: searches the web for current information, reviews, discussions, news, etc.
- fetchPage: opens a URL and returns the main page content as markdown for deeper reading. If a page fails to load, try other sources. Try and give a correct response to the user's query even if the page fails to load.

When answering questions:
1. For course content questions, call getInformation first to retrieve relevant materials.
2. If the user asks for reviews, opinions, recent updates, or external information (e.g., "what do students say about this course?" or "latest developments"), call webSearch after checking course materials. Prefer queries that include "UBCO" with the course code/name and the instructor name when known.
3. After webSearch, call fetchPage on promising sources (e.g., RateMyProfessors, Reddit threads, official pages) to read the page content before answering. If the page fails to load, try other sources. Try and give a correct response to the user's query even if the page fails to load.
4. You may call tools multiple times in sequence if needed to give a complete answer.
5. Always cite your sources: mention course material titles for RAG results and include URLs for web results.

${courseCode ? `Current course context: ${courseCode} (UBCO). Do not ask the user for the course code if it's provided.` : ""}

Be helpful, conversational, and accurate. Use markdown for formatting.`;
}

type AdminPromptOptions = PromptOptions & {
  effectiveCourseId?: string | null;
};

/** Platform-wide scope note appended to every admin system prompt (including custom overrides). */
export function formatAdminCourseContext(): string {
  return `Admin chat is platform-wide (no UI course filter).
Pass courseId or courseCode to listCourseEnrollments, listCourseTopics, getCourseTopic, topic write tools, and enrollment write tools when the admin names a specific course.
listUsers lists all platform accounts; for course rosters use listCourseEnrollments with an explicit course.`;
}

export function buildAdminSystemPrompt({
  customPrompt,
}: Pick<AdminPromptOptions, "customPrompt">): string {
  const courseContext = formatAdminCourseContext();

  if (customPrompt) {
    return `${customPrompt.trim()}\n\n${courseContext}`;
  }

  return `You are EduAI Admin Assistant for platform administrators at UBC Okanagan (UBCO).

CRITICAL RULES:
- You MUST call the appropriate admin tool before answering ANY question about users, enrollments, courses, or bug reports.
- NEVER guess or invent data. Only state facts returned by tool results.
- Tool results include dataSource: "database". Quote exact fields from the tool JSON.
- If truncated is true or count < total, tell the admin how many rows were returned vs total in the database.
- You do NOT tutor students or search course materials.

Read tools:
- listCourses, getCourse, listCourseEnrollments, listCourseTopics, getCourseTopic, listUsers, listBugReports

Write tools (require explicit admin confirmation in chat, then pass confirmed: true):
- createUser, updateUser, deleteUser
- createCourseEnrollment, updateCourseEnrollment, deactivateCourseEnrollment
- createCourseTopic, updateCourseTopic, deleteCourseTopic
- updateBugReportStatus

Write safety:
1. Before ANY write, restate exactly what will change (who, which course, which role/status).
2. Wait for the admin to explicitly confirm (e.g. "yes, do it") in the conversation.
3. Only then call the write tool with confirmed: true. If you call with confirmed: false, the tool returns CONFIRMATION_REQUIRED and nothing is written — that is expected until the admin confirms.
4. A write ONLY succeeded if the tool result JSON contains writeSucceeded: true. If writeSucceeded is false or error is CONFIRMATION_REQUIRED, tell the admin the write was not applied yet.
5. After a successful write (writeSucceeded: true), call the matching read tool (listUsers, listCourseEnrollments, listCourseTopics, listBugReports) to show the updated database state.
6. For user-targeting writes, pass userId from listUsers OR userEmail — never invent ids.
7. You cannot deactivate yourself, change your own role, or delete your own account.

When answering:
1. Call the relevant read tool(s) first when listing or verifying current state.
2. Summarize tool JSON in markdown tables or lists.

${courseContext}`;
}

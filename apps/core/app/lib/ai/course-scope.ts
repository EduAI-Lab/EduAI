import type { LanguageModel } from "ai";
import type { HybridRagHit } from "~/lib/chat-rag";
import {
  classifyCourseScope,
  isScopeClassifierEnabled,
  type ClassifyCourseScopeResult,
} from "~/lib/ai/course-scope-classifier";

/** Course fields injected into the chat system prompt (Layer A). */
export type CourseScopeContext = {
  code: string;
  name: string;
  description?: string | null;
  aiInstructions?: string | null;
  topics?: string[];
};

/** Recent thread context for follow-up continuity (#729). */
export type CourseScopeConversationContext = {
  priorAssistantText?: string | null;
  priorUserText?: string | null;
};

export type CourseScopeDecision = "allow" | "refuse";

export type EvaluateCourseScopeInput = {
  message: string;
  hasCourse: boolean;
  hits: HybridRagHit[];
  course?: CourseScopeContext | null;
  conversation?: CourseScopeConversationContext | null;
  gateEnabled?: boolean;
  /** Model for the scope classifier pass; required when the gate runs on substantive turns. */
  classifierModel?: LanguageModel | null;
};

export type EvaluateCourseScopeResult = {
  decision: CourseScopeDecision;
  reason: string;
};

export type ScopeClassifierOverride = (
  input: EvaluateCourseScopeInput & { course: CourseScopeContext },
) => Promise<ClassifyCourseScopeResult>;

let scopeClassifierOverride: ScopeClassifierOverride | null = null;

/** Test hook — inject a mock classifier without calling the LLM. */
export function setScopeClassifierOverride(override: ScopeClassifierOverride | null): void {
  scopeClassifierOverride = override;
}

const GREETING_PATTERN =
  /^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|ok|okay|bye)\b/i;

const META_SCOPE_PATTERN =
  /\b(what can you help|how can you help|what do you do|who are you|what are you)\b/i;

/** Layer B gate. Set `CHAT_SCOPE_ZERO_CHUNK_GATE=0` to disable. */
export function isCourseScopeGateEnabled(): boolean {
  const raw = process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;
  if (raw === "0" || raw === "false") return false;
  return true;
}

/** Greetings, thanks, meta questions, and very short turns skip the classifier. */
export function isScopeAllowlisted(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  if (trimmed.length <= 3) return true;
  if (GREETING_PATTERN.test(trimmed)) return true;
  if (META_SCOPE_PATTERN.test(trimmed.toLowerCase())) return true;
  return false;
}

/** Substantive turns are sent to the scope classifier. */
export function isSubstantiveForScope(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || isScopeAllowlisted(trimmed)) return false;
  return trimmed.includes("?") || trimmed.length >= 20;
}

/** Build conversation context from merged chat history (excludes current user turn for priorUser). */
export function buildScopeConversationContext(
  messages: Array<{ role?: unknown }>,
  extractText: (message?: { role?: unknown }) => string,
): CourseScopeConversationContext {
  const thread = messages.filter((m) => m.role === "user" || m.role === "assistant");
  const users = thread.filter((m) => m.role === "user");
  const priorUserText =
    users.length >= 2 ? extractText(users[users.length - 2]) : "";

  const priorAssistantText = extractText(
    [...thread].reverse().find((m) => m.role === "assistant"),
  );

  return { priorAssistantText, priorUserText };
}

/**
 * Layer B (#729 v3): classifier decides in-scope before the main model runs.
 * No hardcoded off-topic word lists — scope is defined per course + corpus + thread.
 */
export async function evaluateCourseScope(
  input: EvaluateCourseScopeInput,
): Promise<EvaluateCourseScopeResult> {
  if (!input.hasCourse) {
    return { decision: "allow", reason: "no_course" };
  }

  const gateOn = input.gateEnabled ?? isCourseScopeGateEnabled();
  if (!gateOn) {
    return { decision: "allow", reason: "gate_disabled" };
  }

  if (isScopeAllowlisted(input.message)) {
    return { decision: "allow", reason: "allowlisted" };
  }

  if (!isSubstantiveForScope(input.message)) {
    return { decision: "allow", reason: "not_substantive" };
  }

  if (!isScopeClassifierEnabled()) {
    return { decision: "allow", reason: "classifier_disabled" };
  }

  const course = input.course;
  if (!course) {
    return { decision: "allow", reason: "no_course_context" };
  }

  if (!input.classifierModel) {
    return { decision: "allow", reason: "classifier_model_unavailable" };
  }

  const classification = scopeClassifierOverride
    ? await scopeClassifierOverride({ ...input, course })
    : await classifyCourseScope({
        message: input.message,
        course,
        hits: input.hits,
        conversation: input.conversation,
        classifierModel: input.classifierModel,
      });

  if (!classification.inScope) {
    return { decision: "refuse", reason: classification.reason };
  }

  return { decision: "allow", reason: classification.reason };
}

/** Layer A: course identity + soft scope policy for every course-scoped turn. */
export function buildCourseScopePromptBlock(course: CourseScopeContext): string {
  const lines: string[] = [
    `You are the EduAI course assistant for ${course.code} — ${course.name}.`,
  ];

  if (course.description?.trim()) {
    lines.push(`Course description: ${course.description.trim()}`);
  }

  if (course.topics?.length) {
    lines.push(`Course topics: ${course.topics.join(", ")}.`);
  }

  if (course.aiInstructions?.trim()) {
    lines.push(`Instructor AI instructions: ${course.aiInstructions.trim()}`);
  }

  lines.push(
    "",
    "SCOPE POLICY:",
    "- Answer questions related to this course, its subject area, and supporting prerequisite concepts.",
    "- Use uploaded course materials when available; say clearly when you are giving general background.",
    "- Politely decline unrelated topics — the system may already block clearly off-scope questions before you respond.",
    "- In an ongoing conversation, continue the current course concept; do not pivot into unrelated life or career coaching.",
  );

  return lines.join("\n");
}

/** Canned refusal when Layer B short-circuits before the main model (#729). */
export function buildScopeRefusalMessage(course: CourseScopeContext): string {
  const codeLabel = course.code ? `**${course.code}**` : course.name;
  const nameSuffix =
    course.name && course.code && course.name !== course.code
      ? ` (${course.name})`
      : "";

  return `I'm the assistant for ${codeLabel}${nameSuffix}. I can help with course content, assignments, and concepts from your materials — but I can't help with unrelated topics. Try asking about this week's lecture, an assignment, or a concept from the course.`;
}

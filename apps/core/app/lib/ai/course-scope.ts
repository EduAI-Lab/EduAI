import type { HybridRagHit } from "~/lib/chat-rag";
import { ragScopeAllowSimilarity } from "~/lib/ai/course-rag-policy";

/** Course fields injected into the chat system prompt (Layer A). */
export type CourseScopeContext = {
  code: string;
  name: string;
  description?: string | null;
  aiInstructions?: string | null;
  topics?: string[];
};

/** Recent thread context for follow-up continuity (#729 v2). */
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
};

export type EvaluateCourseScopeResult = {
  decision: CourseScopeDecision;
  reason: string;
};

const GREETING_PATTERN =
  /^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|ok|okay|bye)\b/i;

const META_SCOPE_PATTERN =
  /\b(what can you help|how can you help|what do you do|who are you|what are you)\b/i;

/** High-confidence distraction domains — hard-refuse only when these match (#729). */
const NON_FOUNDATIONAL_TOPIC_PATTERN =
  /\b(world war|wwii|ww2|war ii|social media|walking every|overall health|wellness|physical health|super bowl|netflix|capital of|stock market|roman empire|poem about|joke about|dinosaur|celebrity|football|basketball|recipe|bake|baking|cookie|marathon|movie|tv show|invest in)\b/i;

const LEARNING_INTENT_PATTERN =
  /^(what|why|how|who|when|where|which|explain|define|describe|tell me|can you|could you|help me|is there|are there)\b/i;

/** User wants off-topic content delivered (recipe, how-to), not a course-concept discussion. */
const DIRECT_OFF_TOPIC_PAYLOAD_PATTERN =
  /\b(tell me how to|tell me about|give me|show me how to|write me|what are the steps|step by step|instructions for|recipe for|how do i bake|how do i make|how to bake|how to make|how can i bake|how can i make)\b/i;

/** Off-topic term used as illustration/comparison for a course concept (#729 v2.1). */
const ANALOGY_FRAMING_PATTERN =
  /\b(is (that|this|it)( \w+){0,4} (like|an example|considered|part of|a form of|similar to|related to)|would (that|this|it)( \w+){0,3} (be|count)|does (that|this|it)( \w+){0,3} (count|relate|mean|apply)|could (that|this|it)( \w+){0,3} (be|count)|count as|an example of|in that sense|same as|similar to)\b/i;

const SCOPE_REFUSAL_SNIPPET = "can't help with unrelated topics";

/** Clearly off-topic domains — used for deny-list hard refuse only. */
export function isOffTopicDomain(message: string): boolean {
  return NON_FOUNDATIONAL_TOPIC_PATTERN.test(message.toLowerCase());
}

/**
 * Direct request for off-topic payload (recipe, how-to steps) — not an analogy
 * question about whether an example illustrates a course concept.
 */
export function isDirectOffTopicRequest(message: string): boolean {
  if (!isOffTopicDomain(message)) return false;
  return DIRECT_OFF_TOPIC_PAYLOAD_PATTERN.test(message.toLowerCase());
}

/**
 * Deny-list term appears in a comparison / "is X like Y?" question — allow Layer A
 * to answer conceptually without delivering the off-topic payload.
 */
export function isAnalogyOrConceptQuestion(message: string): boolean {
  if (!isOffTopicDomain(message)) return false;

  const trimmed = message.trim();
  const lower = trimmed.toLowerCase();
  const isQuestion =
    trimmed.includes("?") ||
    /^(is|are|would|could|does|do|should|can|if)\b/i.test(trimmed);

  if (!isQuestion) return false;
  return ANALOGY_FRAMING_PATTERN.test(lower);
}

/** Course-logistics signals — course-framing in the question itself. */
const COURSE_INTENT_KEYWORDS = [
  "assignment",
  "chapter",
  "class",
  "course",
  "cosc",
  "exam",
  "final",
  "homework",
  "instructor",
  "lab",
  "lecture",
  "material",
  "materials",
  "midterm",
  "module",
  "professor",
  "project",
  "quiz",
  "reading",
  "syllabus",
  "textbook",
  "this course",
  "tutorial",
  "week ",
];

/** Tokens from generic titles/descriptions that must not alone signal overlap. */
const GENERIC_METADATA_TOKENS = new Set([
  "basic",
  "computer",
  "course",
  "cs",
  "faculty",
  "first",
  "fundamental",
  "general",
  "help",
  "intro",
  "introduction",
  "okanagan",
  "overview",
  "programming",
  "science",
  "student",
  "students",
  "ubco",
  "year",
]);

const SCOPE_STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
  "are",
  "ask",
  "can",
  "could",
  "did",
  "does",
  "explain",
  "for",
  "from",
  "have",
  "help",
  "how",
  "into",
  "just",
  "like",
  "make",
  "more",
  "much",
  "need",
  "not",
  "our",
  "out",
  "say",
  "some",
  "tell",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "use",
  "using",
  "want",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

/** Zero-chunk hard gate (#729 Layer B). Set `CHAT_SCOPE_ZERO_CHUNK_GATE=0` to disable. */
export function isCourseScopeGateEnabled(): boolean {
  const raw = process.env.CHAT_SCOPE_ZERO_CHUNK_GATE;
  if (raw === "0" || raw === "false") return false;
  return true;
}

/** Greetings, thanks, meta questions, and very short turns never hard-refuse. */
export function isScopeAllowlisted(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  if (trimmed.length <= 3) return true;
  if (GREETING_PATTERN.test(trimmed)) return true;
  if (META_SCOPE_PATTERN.test(trimmed.toLowerCase())) return true;
  return false;
}

/** Substantive turns are candidates for the scope gate deny-list check. */
export function isSubstantiveForScope(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || isScopeAllowlisted(trimmed)) return false;
  return trimmed.includes("?") || trimmed.length >= 20;
}

/** Plausible learning question in a course chat (fail-open signal). */
export function isLearningIntentQuestion(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  return trimmed.includes("?") || LEARNING_INTENT_PATTERN.test(trimmed);
}

export function hasCourseIntentSignals(message: string): boolean {
  const lower = message.toLowerCase();
  for (const keyword of COURSE_INTENT_KEYWORDS) {
    if (keyword === "course") {
      if (/\bof course\b/.test(lower)) continue;
      if (/\bcourse\b/.test(lower)) return true;
      continue;
    }
    if (lower.includes(keyword)) return true;
  }
  return false;
}

function tokenizeForScope(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((word) => word.length >= 3 && !SCOPE_STOP_WORDS.has(word)),
  );
}

function normalizeCourseCode(code: string): string {
  return code.trim().toLowerCase().replace(/\s+/g, " ");
}

function isScopeRefusalMessage(text: string): boolean {
  return text.includes(SCOPE_REFUSAL_SNIPPET);
}

/** Lower bar than RAG inject — weak affinity still means "probably course-related". */
export function hasScopeAffinityRagHits(hits: HybridRagHit[]): boolean {
  const threshold = ragScopeAllowSimilarity();
  return hits.some((hit) => (hit.similarity ?? 0) >= threshold);
}

/**
 * Strong overlap: course code/name, multi-word topics, or topic tokens with
 * explicit course-intent signals.
 */
export function hasCourseMetadataOverlap(
  message: string,
  course: CourseScopeContext,
): boolean {
  const lower = message.toLowerCase();
  const codeNorm = normalizeCourseCode(course.code);

  if (codeNorm.length >= 4 && lower.includes(codeNorm)) {
    return true;
  }

  const codeCompact = codeNorm.replace(/\s/g, "");
  if (codeCompact.length >= 4 && lower.replace(/\s/g, "").includes(codeCompact)) {
    return true;
  }

  const courseName = course.name.trim().toLowerCase();
  if (courseName.length >= 8 && lower.includes(courseName)) {
    return true;
  }

  for (const topic of course.topics ?? []) {
    const normalizedTopic = topic.trim().toLowerCase();
    if (normalizedTopic.includes(" ") && normalizedTopic.length >= 6 && lower.includes(normalizedTopic)) {
      return true;
    }
  }

  if (!hasCourseIntentSignals(message)) {
    return false;
  }

  const messageTokens = tokenizeForScope(message);
  const topicTokens = tokenizeForScope((course.topics ?? []).join(" "));
  for (const token of messageTokens) {
    if (topicTokens.has(token) && !GENERIC_METADATA_TOKENS.has(token)) {
      return true;
    }
  }

  for (const token of tokenizeForScope(course.description ?? "")) {
    if (!GENERIC_METADATA_TOKENS.has(token) && messageTokens.has(token)) {
      return true;
    }
  }

  for (const token of tokenizeForScope(course.aiInstructions ?? "")) {
    if (messageTokens.has(token)) {
      return true;
    }
  }

  return false;
}

/**
 * Active course thread: prior assistant answered substantively, or prior user
 * turn was course-framed. Enables short follow-ups ("why?", "who created it?").
 */
export function hasConversationCourseContext(
  conversation: CourseScopeConversationContext | null | undefined,
  course: CourseScopeContext | null | undefined,
): boolean {
  if (!conversation) return false;

  const priorAssistant = conversation.priorAssistantText?.trim() ?? "";
  if (priorAssistant.length >= 30 && !isScopeRefusalMessage(priorAssistant)) {
    return true;
  }

  const priorUser = conversation.priorUserText?.trim() ?? "";
  if (!priorUser) return false;
  if (hasCourseIntentSignals(priorUser)) return true;
  if (course && hasCourseMetadataOverlap(priorUser, course)) return true;

  return false;
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
 * Hard-refuse when deny-list matches unless course-framed or analogy question.
 * Conversation continuity does NOT bypass deny-list (#729 v2.1 — topic laundering fix).
 * Direct payload requests (recipes, how-tos) always refuse mid-thread.
 */
export function shouldHardRefuseOffTopic(input: EvaluateCourseScopeInput): boolean {
  if (!isOffTopicDomain(input.message)) {
    return false;
  }

  if (hasCourseIntentSignals(input.message)) {
    return false;
  }

  if (input.course && hasCourseMetadataOverlap(input.message, input.course)) {
    return false;
  }

  if (isAnalogyOrConceptQuestion(input.message)) {
    return false;
  }

  return true;
}

/**
 * Layer B pre-check (#729 v2): deny-list default — allow unless clearly off-topic.
 * Grey-area and concept exploration defer to Layer A (system prompt) + the LLM.
 */
export function evaluateCourseScope(
  input: EvaluateCourseScopeInput,
): EvaluateCourseScopeResult {
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

  if (shouldHardRefuseOffTopic(input)) {
    const reason = isDirectOffTopicRequest(input.message)
      ? "direct_off_topic_payload"
      : "clearly_off_topic";
    return { decision: "refuse", reason };
  }

  const course = input.course;

  if (hasConversationCourseContext(input.conversation, course)) {
    return { decision: "allow", reason: "conversation_continuity" };
  }

  if (hasCourseIntentSignals(input.message)) {
    return { decision: "allow", reason: "course_material_intent" };
  }

  if (course && hasCourseMetadataOverlap(input.message, course)) {
    return { decision: "allow", reason: "course_metadata_overlap" };
  }

  if (hasScopeAffinityRagHits(input.hits)) {
    return { decision: "allow", reason: "scope_rag_affinity" };
  }

  if (isLearningIntentQuestion(input.message)) {
    return { decision: "allow", reason: "learning_intent" };
  }

  return { decision: "allow", reason: "default_course_chat" };
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
    "- Prioritize questions related to this course and its subject area.",
    "- Answer foundational and prerequisite concepts when they support course learning, even if not in uploaded materials — note when you are giving general background vs citing course materials.",
    "- Politely decline clearly unrelated questions (e.g. hobbies, recipes, unrelated subjects).",
    "- When the user asks whether an everyday example illustrates a course concept, explain the concept — do not provide step-by-step off-topic instructions (recipes, hobby how-tos) when asked directly.",
    "- When course materials do not contain an answer, say so clearly — do not invent syllabus-specific facts.",
    "- In an ongoing conversation, treat follow-up questions as continuing the current course topic — not as permission to deliver unrelated content.",
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

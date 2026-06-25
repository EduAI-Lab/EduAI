import type { HybridRagHit } from "~/lib/chat-rag";

/** Course fields injected into the chat system prompt (Layer A). */
export type CourseScopeContext = {
  code: string;
  name: string;
  description?: string | null;
  aiInstructions?: string | null;
  topics?: string[];
};

export type CourseScopeDecision = "allow" | "refuse";

export type EvaluateCourseScopeInput = {
  message: string;
  hasCourse: boolean;
  hits: HybridRagHit[];
  course?: CourseScopeContext | null;
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

const CODE_REQUEST_PATTERN =
  /\b(write|implement|create|debug|fix)\b.*\b(code|function|program|script|algorithm)\b|\b(python|javascript|typescript|java|c\+\+)\b.*\b(code|function|implement)\b/i;

/** Hobby/lifestyle topics that are unrelated to typical course chat (#729 v1.1).
 *  Intentionally narrow: only these get a pre-LLM hard refuse. Everything else
 *  with zero RAG hits defers to Layer A (scope prompt) + the model. */
const CLEARLY_OFF_TOPIC_PATTERN =
  /\b(bake|baking|cookie|cookies|recipe|recipes|cooking|kitchen|sourdough|meal prep|marathon training)\b/i;

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

/** Coding help may have zero material hits but is still plausibly in-scope (#729). */
export function isCodingScopeAllowlisted(message: string): boolean {
  return CODE_REQUEST_PATTERN.test(message.trim().toLowerCase());
}

/** Substantive turns are candidates for the zero-chunk gate. */
export function isSubstantiveForScope(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || isScopeAllowlisted(trimmed)) return false;
  return trimmed.includes("?") || trimmed.length >= 20;
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

/** Shared tokens between the user message and course metadata (name, topics, description, etc.). */
export function hasCourseMetadataOverlap(
  message: string,
  course: CourseScopeContext,
): boolean {
  const messageTokens = tokenizeForScope(message);
  const courseTokens = tokenizeForScope(
    [
      course.code,
      course.name,
      course.description ?? "",
      course.aiInstructions ?? "",
      ...(course.topics ?? []),
    ].join(" "),
  );

  for (const token of messageTokens) {
    if (courseTokens.has(token)) {
      return true;
    }
  }

  const lower = message.toLowerCase();
  if (course.name.length >= 4 && lower.includes(course.name.toLowerCase())) {
    return true;
  }

  for (const topic of course.topics ?? []) {
    if (topic.length >= 4 && lower.includes(topic.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Hard-refuse only when the message matches obvious off-topic domains and does
 * not overlap course metadata (#729 v1.1 — avoids refusing related foundations
 * like linear algebra in an image-processing course).
 */
export function isClearlyOffTopic(message: string, course: CourseScopeContext): boolean {
  if (!CLEARLY_OFF_TOPIC_PATTERN.test(message.toLowerCase())) {
    return false;
  }
  return !hasCourseMetadataOverlap(message, course);
}

/**
 * Layer B pre-check (#729 v1.1): hard-refuse only clearly off-topic substantive
 * turns with zero RAG chunks. Related questions without material hits defer to
 * Layer A (system prompt) + empty-RAG instruction so the model can answer
 * foundational course-adjacent concepts or decline politely.
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

  if (isCodingScopeAllowlisted(input.message)) {
    return { decision: "allow", reason: "coding_allowlisted" };
  }

  if (!isSubstantiveForScope(input.message)) {
    return { decision: "allow", reason: "not_substantive" };
  }

  if (input.hits.length > 0) {
    return { decision: "allow", reason: "rag_hits_present" };
  }

  const course = input.course;
  if (!course) {
    return { decision: "allow", reason: "soft_scope_llm" };
  }

  if (hasCourseMetadataOverlap(input.message, course)) {
    return { decision: "allow", reason: "course_metadata_overlap" };
  }

  if (isClearlyOffTopic(input.message, course)) {
    return { decision: "refuse", reason: "clearly_off_topic" };
  }

  return { decision: "allow", reason: "soft_scope_llm" };
}

/** Layer A: course identity + strict scope policy for every course-scoped turn. */
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
    "SCOPE POLICY (strict):",
    "- Only discuss topics related to this course.",
    "- Politely decline unrelated questions (e.g. hobbies or subjects outside this course).",
    "- You may explain foundational concepts clearly related to this course's subject even when they are not in the uploaded materials (e.g. prerequisite math for a technical course).",
    "- Do not substitute general world knowledge when the question is clearly off-topic for this course.",
    "- When course materials do not contain an answer, say so clearly — do not invent off-topic answers.",
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

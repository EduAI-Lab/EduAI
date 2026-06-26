import type { HybridRagHit } from "~/lib/chat-rag";
import { ragInjectModerateSimilarity } from "~/lib/ai/course-rag-policy";

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

const FOUNDATIONAL_QUESTION_PATTERN =
  /^(what is|what are|explain|how does|define|describe|tell me about)\b/i;

const NON_FOUNDATIONAL_TOPIC_PATTERN =
  /\b(world war|wwii|ww2|war ii|social media|walking every|overall health|wellness|physical health|super bowl|netflix|capital of|stock market|roman empire|poem about|joke about|dinosaur|celebrity|football|basketball|recipe|bake|baking|cookie|marathon|movie|tv show|invest in)\b/i;

/** Clearly off-topic domains — used to block RAG-hit bypass and foundational allowance. */
export function isOffTopicDomain(message: string): boolean {
  return NON_FOUNDATIONAL_TOPIC_PATTERN.test(message.toLowerCase());
}

/** Course-logistics signals — bare topic tokens only count with these present. */
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

/** Coding help only when the request is plausibly for this course (#729 v1.2). */
export function isCodingScopeAllowlisted(message: string): boolean {
  const lower = message.trim().toLowerCase();
  if (!CODE_REQUEST_PATTERN.test(lower)) return false;
  return hasCourseIntentSignals(message);
}

/** Substantive turns are candidates for the zero-chunk gate. */
export function isSubstantiveForScope(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed || isScopeAllowlisted(trimmed)) return false;
  return trimmed.includes("?") || trimmed.length >= 20;
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

/** RAG hits must clear the moderate inject bar before they bypass the scope gate. */
export function hasScopeRelevantRagHits(hits: HybridRagHit[]): boolean {
  const threshold = ragInjectModerateSimilarity();
  return hits.some((hit) => (hit.similarity ?? 0) >= threshold);
}

/**
 * Strong overlap: course code/name, multi-word topics, or topic tokens with
 * explicit course-intent signals. Avoids false positives like "year" or bare
 * topic names in unrelated contexts (#729 v1.2).
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

function isTechnicalCourse(course: CourseScopeContext): boolean {
  if (/\b(cosc|cmps|cpsc|cs)\s*\d+/i.test(course.code)) {
    return true;
  }

  const blob = [course.code, course.name, course.description ?? "", ...(course.topics ?? [])]
    .join(" ")
    .toLowerCase();
  return /\b(programming|computer|processing|vision|algorithm|software|engineering|math|calculus|data|image|filters|convolution)\b/.test(
    blob,
  );
}

/** Prerequisite-style STEM questions for technical courses (#729 v1.1). */
export function isFoundationalAdjacent(
  message: string,
  course: CourseScopeContext,
): boolean {
  const trimmed = message.trim();
  if (!FOUNDATIONAL_QUESTION_PATTERN.test(trimmed)) {
    return false;
  }
  if (NON_FOUNDATIONAL_TOPIC_PATTERN.test(trimmed.toLowerCase())) {
    return false;
  }
  return isTechnicalCourse(course);
}

/**
 * Layer B pre-check (#729 v1.2): hard-refuse substantive zero-hit off-topic turns.
 * Allow greetings, course-intent coding help, strong metadata overlap, relevant
 * RAG hits, and foundational STEM questions for technical courses.
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

  const course = input.course;

  if (hasScopeRelevantRagHits(input.hits)) {
    if (
      course &&
      isOffTopicDomain(input.message) &&
      !hasCourseMetadataOverlap(input.message, course)
    ) {
      return { decision: "refuse", reason: "off_topic_despite_rag" };
    }
    return { decision: "allow", reason: "rag_hits_present" };
  }

  if (!course) {
    return { decision: "refuse", reason: "zero_hit_off_topic" };
  }

  if (hasCourseIntentSignals(input.message)) {
    return { decision: "allow", reason: "course_material_intent" };
  }

  if (hasCourseMetadataOverlap(input.message, course)) {
    return { decision: "allow", reason: "course_metadata_overlap" };
  }

  if (isFoundationalAdjacent(input.message, course)) {
    return { decision: "allow", reason: "foundational_adjacent" };
  }

  return { decision: "refuse", reason: "zero_hit_off_topic" };
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

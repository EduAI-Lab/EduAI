const COURSE_RAG_KEYWORDS = [
  "course",
  "material",
  "materials",
  "document",
  "chapter",
  "lecture",
  "assignment",
  "syllabus",
  "reading",
  "textbook",
  "slide",
  "slides",
  "module",
  "week ",
  "summarize",
  "summary",
  "what did",
  "what does",
  "according to",
  "from the",
  "in class",
  "professor",
  "instructor",
  "exam",
  "midterm",
  "final",
  "quiz",
  "lab",
  "tutorial",
  "content",
  "about the",
];

const GREETING_PATTERN = /^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|ok|okay|bye)\b/i;

const GENERIC_KNOWLEDGE_PATTERN = /^what is\b/i;

const CODE_REQUEST_PATTERN =
  /\b(write|implement|create|debug|fix)\b.*\b(code|function|program|script|algorithm)\b|\b(python|javascript|typescript|java|c\+\+)\b.*\b(code|function|implement)\b/i;

/**
 * Returns true when a turn should use course-material RAG (auto-inject or tool path).
 * Borderline cases escalate to true when a course is selected (correctness over speed).
 */
export function needsCourseRag(message: string, hasCourse: boolean): boolean {
  if (!hasCourse) return false;

  const trimmed = message.trim();
  if (!trimmed) return false;

  const lower = trimmed.toLowerCase();

  if (GREETING_PATTERN.test(trimmed)) {
    return false;
  }

  if (CODE_REQUEST_PATTERN.test(lower)) {
    return false;
  }

  if (GENERIC_KNOWLEDGE_PATTERN.test(lower) && !COURSE_RAG_KEYWORDS.some((kw) => lower.includes(kw))) {
    return false;
  }

  if (COURSE_RAG_KEYWORDS.some((kw) => lower.includes(kw))) {
    return true;
  }

  // Substantive question with course context — escalate for correctness.
  if (trimmed.includes("?") && trimmed.length >= 12) {
    return true;
  }

  return false;
}

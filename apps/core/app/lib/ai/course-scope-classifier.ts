import { generateText, type LanguageModel } from "ai";
import { z } from "zod";
import type { HybridRagHit } from "~/lib/chat-rag";
import type {
  CourseScopeContext,
  CourseScopeConversationContext,
} from "~/lib/ai/course-scope";

export type ClassifyCourseScopeInput = {
  message: string;
  course: CourseScopeContext;
  hits: HybridRagHit[];
  conversation?: CourseScopeConversationContext | null;
  classifierModel: LanguageModel;
};

export type ClassifyCourseScopeResult = {
  inScope: boolean;
  reason: string;
};

const classifierResultSchema = z.object({
  inScope: z.boolean(),
  reason: z.string().max(120),
});

const SCOPE_CLASSIFIER_SYSTEM = `You are a course-scope classifier for a university course chat assistant.
Decide whether the student's latest message should be answered in this course context.

IN SCOPE — answer is appropriate:
- Course materials, assignments, lectures, exams, syllabus, labs, projects
- Foundational or prerequisite concepts that support learning this subject (even if not in uploaded files)
- Short follow-ups that continue the current course discussion (e.g. "why was ASCII created?" after a chapter answer)
- Brief meta questions about what the assistant can help with in this course

OUT OF SCOPE — refuse before answering:
- Topics with no meaningful connection to this course's subject, materials, or legitimate prerequisites
- Unrelated hobbies, recipes, entertainment, or general world trivia
- Career coaching, job search, LinkedIn, résumés, interview prep — unless course materials explicitly cover careers
- Slow topic drift: a thread that started on course content but pivoted to unrelated advice

Use the course definition, retrieved material excerpts, and recent conversation.
When retrieved materials are weak or empty, still allow clear prerequisite/CS/math questions for technical courses.
When the message is a topic pivot away from the course thread, mark OUT OF SCOPE even if phrased politely.

Respond with JSON only, no markdown:
{"inScope": true|false, "reason": "brief_snake_case_reason"}`;

function truncate(text: string, max: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

export function buildCourseScopeClassifierPrompt(input: ClassifyCourseScopeInput): string {
  const { course, message, hits, conversation } = input;
  const lines: string[] = [
    `Course: ${course.code} — ${course.name}`,
  ];

  if (course.description?.trim()) {
    lines.push(`Description: ${truncate(course.description, 400)}`);
  }
  if (course.topics?.length) {
    lines.push(`Topics: ${course.topics.join(", ")}`);
  }
  if (course.aiInstructions?.trim()) {
    lines.push(`Instructor notes: ${truncate(course.aiInstructions, 300)}`);
  }

  lines.push("", "Retrieved material excerpts (may be empty):");
  if (hits.length === 0) {
    lines.push("- (none above relevance threshold)");
  } else {
    for (const hit of hits.slice(0, 4)) {
      const sim = hit.similarity?.toFixed(2) ?? "?";
      lines.push(
        `- [${sim}] ${hit.materialTitle}: ${truncate(hit.content, 220)}`,
      );
    }
  }

  if (conversation?.priorUserText?.trim() || conversation?.priorAssistantText?.trim()) {
    lines.push("", "Recent conversation (before latest message):");
    if (conversation.priorUserText?.trim()) {
      lines.push(`Student: ${truncate(conversation.priorUserText, 300)}`);
    }
    if (conversation.priorAssistantText?.trim()) {
      lines.push(`Assistant: ${truncate(conversation.priorAssistantText, 400)}`);
    }
  }

  lines.push("", `Latest student message: ${message.trim()}`);
  lines.push("", "Classify the latest message only. JSON:");

  return lines.join("\n");
}

function parseClassifierJson(text: string): ClassifyCourseScopeResult | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = classifierResultSchema.safeParse(JSON.parse(match[0]));
    if (!parsed.success) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

/** Fail-open on classifier errors unless CHAT_SCOPE_CLASSIFIER_FAIL_OPEN=0. */
export function isScopeClassifierFailOpen(): boolean {
  const raw = process.env.CHAT_SCOPE_CLASSIFIER_FAIL_OPEN;
  if (raw === "0" || raw === "false") return false;
  return true;
}

export function isScopeClassifierEnabled(): boolean {
  const raw = process.env.CHAT_SCOPE_CLASSIFIER_ENABLED;
  if (raw === "0" || raw === "false") return false;
  return true;
}

/**
 * Layer B (#729 v3): second LLM pass — in-scope vs refuse before main generation.
 * No hardcoded off-topic word lists; scope comes from course definition + corpus signals.
 */
export async function classifyCourseScope(
  input: ClassifyCourseScopeInput,
): Promise<ClassifyCourseScopeResult> {
  const prompt = buildCourseScopeClassifierPrompt(input);

  try {
    const { text } = await generateText({
      model: input.classifierModel,
      system: SCOPE_CLASSIFIER_SYSTEM,
      prompt,
      temperature: 0,
      maxTokens: 120,
    });

    const parsed = parseClassifierJson(text);
    if (parsed) return parsed;

    console.warn("[course-scope] classifier returned unparseable JSON:", text.slice(0, 200));
    return isScopeClassifierFailOpen()
      ? { inScope: true, reason: "classifier_parse_error_fail_open" }
      : { inScope: false, reason: "classifier_parse_error_fail_closed" };
  } catch (error) {
    console.error("[course-scope] classifier LLM error:", error);
    return isScopeClassifierFailOpen()
      ? { inScope: true, reason: "classifier_error_fail_open" }
      : { inScope: false, reason: "classifier_error_fail_closed" };
  }
}

/**
 * Course-scope chat guardrail — second-pass 7B classification on every course
 * chat turn. When enabled, an off-topic message gets a canned redirect instead
 * of reaching the main model. Fails open on classifier error/timeout: an
 * unreachable classifier host must never block a student's real question.
 */
import { generateText } from "ai";
import { z } from "zod";
import { createClassifierClient } from "./routing/classifier-client";
import { chatApiDebug } from "~/lib/chat-api-log";

export type CourseScopeContext = {
  courseName: string;
  courseCode: string | null;
  courseDescription: string | null;
  aiInstructions: string | null;
};

export const courseScopeSchema = z.object({
  onTopic: z.boolean(),
  confidence: z.number().min(0).max(100),
});

export type CourseScopeClassification = z.infer<typeof courseScopeSchema>;

export type CourseScopeVerdict = {
  blocked: boolean;
  classification: CourseScopeClassification | null;
};

export function courseScopeGuardrailEnabled(): boolean {
  const raw = process.env.COURSE_SCOPE_GUARDRAIL_ENABLED?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

function classifierModelId(): string {
  return process.env.COURSE_SCOPE_CLASSIFIER_MODEL?.trim() || "qwen2.5-7b-instruct";
}

function courseScopeMinConfidence(): number {
  // 75 (not 60): a 7B classifier's low-confidence "off-topic" calls are mostly
  // false positives (e.g. "what is COSC 101" scored 70 and blocked a legit
  // meta question). Blocking only high-confidence off-topic keeps false
  // positives — which silently swallow real course questions — rare.
  const n = Number(process.env.COURSE_SCOPE_MIN_CONFIDENCE ?? "75");
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 75;
}

function courseScopeTimeoutMs(): number {
  // 1 second: the classifier sits on the critical path before
  // streamText(), so a slow/unreachable host taxes every course turn up to the
  // full timeout before failing open. Keep the fail-open cost small.
  const n = Number(process.env.COURSE_SCOPE_CLASSIFIER_TIMEOUT_MS ?? "1000");
  return Number.isFinite(n) && n > 0 ? n : 1_000;
}

/** Parse classifier JSON from model text (vLLM lacks tool-call-parser for generateObject). */
export function parseCourseScopeJson(text: string): CourseScopeClassification {
  const trimmed = text.trim();
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("Course-scope classifier response contained no JSON object");
  }
  const parsed = courseScopeSchema.safeParse(JSON.parse(jsonMatch[0]));
  if (!parsed.success) {
    throw new Error(`Course-scope classifier JSON invalid: ${parsed.error.message}`);
  }
  return parsed.data;
}

function buildCourseScopeSystemPrompt(context: CourseScopeContext): string {
  return `You are a scope-enforcement classifier for a university course AI assistant.
Course: ${context.courseName} (${context.courseCode ?? "no code"}).
Course description: ${context.courseDescription?.trim() || "none"}.
Instructor notes: ${context.aiInstructions?.trim() || "none"}.

A message is ON-TOPIC if it relates to this course in any way, including:
- course content, concepts, lectures, readings
- assignments, exams, grading, deadlines, or other logistics
- questions about the course itself: what it covers, prerequisites, or asking
  what the course code means (e.g. "what is ${context.courseCode ?? "this course"}")
- a natural follow-up, clarification, or greeting in an ongoing course conversation

A message is OFF-TOPIC only when it is clearly unrelated to the course — small
talk or a request about an unrelated subject or task. When you are unsure,
treat the message as ON-TOPIC.

"confidence" is how sure you are (0-100) that your onTopic value is correct.

Respond with a single JSON object only (no markdown fences):
{"onTopic": true|false, "confidence": 0-100}`;
}

export async function classifyCourseScope(
  message: string,
  context: CourseScopeContext,
): Promise<CourseScopeClassification> {
  const openai = createClassifierClient();
  const model = openai(classifierModelId());

  const { text } = await generateText({
    model,
    system: buildCourseScopeSystemPrompt(context),
    prompt: `Student message:\n${message.trim()}`,
    temperature: 0,
    // ~48 comfortably fits the JSON verdict (20 truncated it) without letting a
    // non-stopping model ramble up to 128 tokens on the critical path.
    maxTokens: 48,
    abortSignal: AbortSignal.timeout(courseScopeTimeoutMs()),
  });

  return parseCourseScopeJson(text);
}

/** Static, no-model-call redirect — keeps the guardrail's total extra output to just the classifier label. */
export function buildCourseScopeRedirectMessage(courseName: string | null): string {
  const name = courseName?.trim() || "this course";
  return `That looks outside the scope of ${name}. I'm here to help with course content, so let's get back on track — ask me about lecture material, assignments, or anything else from the course and I'll do my best to help.`;
}

const GREETING_WORDS =
  /\b(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|ok|okay|bye)\b/gi;

/**
 * Never trips the gate: empty messages and messages that are *nothing but*
 * greetings/thanks don't need a classifier round-trip. Unlike a leading-anchor
 * match, this won't skip off-topic requests that merely open with a greeting
 * word ("ok what's the weather", "hey write me a poem") — those still get
 * classified.
 */
export function shouldSkipCourseScopeCheck(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  // Strip greeting words, then anything non-alphanumeric. If nothing is left,
  // the message carried no real content beyond greetings.
  const residue = trimmed.replace(GREETING_WORDS, "").replace(/[^a-z0-9]/gi, "");
  return residue.length === 0;
}

/**
 * Orchestrates the guardrail decision for one chat turn. Fails open: any
 * classifier error/timeout returns `blocked: false` rather than throwing.
 */
export async function resolveCourseScopeVerdict(input: {
  message: string;
  context: CourseScopeContext;
}): Promise<CourseScopeVerdict> {
  if (shouldSkipCourseScopeCheck(input.message)) {
    return { blocked: false, classification: null };
  }

  try {
    const classification = await classifyCourseScope(input.message, input.context);
    const blocked =
      !classification.onTopic && classification.confidence >= courseScopeMinConfidence();
    chatApiDebug("Course-scope classifier verdict", {
      onTopic: classification.onTopic,
      confidence: classification.confidence,
      blocked,
      minConfidence: courseScopeMinConfidence(),
    });
    return { blocked, classification };
  } catch (err) {
    // Always surface fail-open — silent chatApiDebug made production misses invisible.
    console.warn("[course-scope] classifier failed; failing open", err);
    return { blocked: false, classification: null };
  }
}

/**
 * Course-scope chat guardrail — second-pass 7B classification on every course
 * chat turn. When enabled, an off-topic message gets a canned redirect instead
 * of reaching the main model. Fails open on classifier error/timeout: an
 * unreachable classifier host must never block a student's real question.
 */
import { generateText } from "ai";
import { z } from "zod";
import { createClassifierClient } from "./routing/classifier-client";
import { GREETING_PATTERN } from "./chat-intent";
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
  const n = Number(process.env.COURSE_SCOPE_MIN_CONFIDENCE ?? "60");
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 60;
}

function courseScopeTimeoutMs(): number {
  const n = Number(process.env.COURSE_SCOPE_CLASSIFIER_TIMEOUT_MS ?? "6000");
  return Number.isFinite(n) && n > 0 ? n : 6_000;
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

Decide whether the student's message is reasonably related to this course
(course content, assignments, logistics, or a natural follow-up/greeting in
an ongoing course conversation) versus clearly unrelated small talk or an
off-topic request.

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
    maxTokens: 20,
    abortSignal: AbortSignal.timeout(courseScopeTimeoutMs()),
  });

  return parseCourseScopeJson(text);
}

/** Static, no-model-call redirect — keeps the guardrail's total extra output to just the classifier label. */
export function buildCourseScopeRedirectMessage(courseName: string | null): string {
  const name = courseName?.trim() || "this course";
  return `That looks outside the scope of ${name}. I'm here to help with course content, so let's get back on track — ask me about lecture material, assignments, or anything else from the course and I'll do my best to help.`;
}

/** Never trips the gate: empty messages and greetings/thanks don't need a classifier round-trip. */
function shouldSkipCourseScopeCheck(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return true;
  return GREETING_PATTERN.test(trimmed);
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
    return { blocked, classification };
  } catch (err) {
    chatApiDebug("Course-scope classifier failed; failing open", { err });
    return { blocked: false, classification: null };
  }
}

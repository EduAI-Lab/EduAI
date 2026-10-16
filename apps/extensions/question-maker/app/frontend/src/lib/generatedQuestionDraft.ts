/**
 * Maps one AI-generated question onto the composer's form fields (#1973).
 * Shared by single and batch generation so both paths normalise identically.
 */
import type { JsonValue } from "@eduai/types";
import { isString } from "@eduai/ui/primitive-union";
import type { EduAIQuestionGenerationResponse } from "@/services/eduaiService";
import type { MCQChoice, QuestionDifficulty, QuestionType, ReasoningLevel } from "@/types/question";

export type GeneratedQuestion = EduAIQuestionGenerationResponse["data"]["questions"][number];

export const DEFAULT_CHOICES: MCQChoice[] = [
  { letter: "A", text: "" },
  { letter: "B", text: "" },
  { letter: "C", text: "" },
  { letter: "D", text: "" },
];

export const createDescriptionFromText = (text: string) => {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const sentenceMatch = normalized.match(/[^.!?]+[.!?]?/);
  const base = (sentenceMatch ? sentenceMatch[0] : normalized).trim();
  const words = base.split(" ");
  if (words.length <= 12) return base;
  return `${words.slice(0, 12).join(" ")}…`;
};

/** The form fields a generated question can fill. */
export interface GeneratedDraftFields {
  questionType: QuestionType;
  questionText: string;
  difficulty: QuestionDifficulty;
  reasoningLevel: ReasoningLevel;
  answer: string;
  choices: MCQChoice[];
  primaryTopicId: string;
  secondaryTopicIds: string[];
  description: string;
}

export function inferGeneratedType(generated: GeneratedQuestion): QuestionType {
  return generated.type === "SA" || generated.type === "MCQ" || generated.type === "LA"
    ? generated.type
    : "MCQ";
}

/**
 * Returns `prev` with the generated question's fields applied. Variant mode keeps the
 * base question's type, primary topic and description.
 */
export function applyGeneratedQuestion<T extends GeneratedDraftFields>(
  prev: T,
  generated: GeneratedQuestion,
  topicIds: readonly string[],
  mode: "create" | "variant",
): T {
  const inferredType = inferGeneratedType(generated);
  const inferredDifficulty: QuestionDifficulty =
    generated.difficulty === "easy" || generated.difficulty === "hard"
      ? generated.difficulty
      : "medium";
  const inferredReasoningLevel: ReasoningLevel =
    generated.reasoning_level === "analytical" || generated.reasoning_level === "application"
      ? generated.reasoning_level
      : "factual";

  const topicIdSet = new Set(topicIds);
  const primaryCandidate =
    generated.primary_topic_id != null ? String(generated.primary_topic_id).trim() : "";
  const primaryTopicId =
    primaryCandidate && topicIdSet.has(primaryCandidate) ? primaryCandidate : null;
  const resolvedSecondary = Array.isArray(generated.secondary_topic_ids)
    ? Array.from(
        new Set(
          generated.secondary_topic_ids
            .map((v: JsonValue) => String(v).trim())
            .filter((v) => v !== "" && topicIdSet.has(v) && v !== primaryTopicId),
        ),
      )
    : [];
  const resolvedAnswer =
    isString(generated.answer) && generated.answer.trim().length > 0 ? generated.answer.trim() : "";

  let resolvedChoices: MCQChoice[] = prev.choices;
  if (inferredType === "MCQ" && Array.isArray(generated.choices) && generated.choices.length > 0) {
    resolvedChoices = generated.choices
      .map((c: { letter?: string; text?: string }) => ({
        letter: isString(c.letter) ? c.letter.toUpperCase() : String(c.letter ?? ""),
        text: isString(c.text) ? c.text.trim() : String(c.text ?? ""),
      }))
      .filter((c: MCQChoice) => c.text.length > 0);
    if (resolvedChoices.length < 2) resolvedChoices = prev.choices;
  } else if (inferredType !== "MCQ") {
    resolvedChoices = DEFAULT_CHOICES.map((c) => ({ ...c }));
  }

  if (mode === "variant") {
    return {
      ...prev,
      questionText: generated.content ?? prev.questionText,
      difficulty: inferredDifficulty,
      reasoningLevel: inferredReasoningLevel,
      answer: resolvedAnswer || prev.answer,
      choices: resolvedChoices,
      secondaryTopicIds: resolvedSecondary.length > 0 ? resolvedSecondary : prev.secondaryTopicIds,
    };
  }

  const resolvedPrimary = primaryTopicId !== null ? primaryTopicId : prev.primaryTopicId;
  const resolvedDescription =
    isString(generated.description) && generated.description.trim().length > 0
      ? generated.description.trim()
      : prev.description.trim() || createDescriptionFromText(generated.content ?? "");

  return {
    ...prev,
    questionType: inferredType,
    questionText: generated.content ?? prev.questionText,
    difficulty: inferredDifficulty,
    reasoningLevel: inferredReasoningLevel,
    description: resolvedDescription,
    answer: resolvedAnswer,
    choices: resolvedChoices,
    primaryTopicId: resolvedPrimary,
    secondaryTopicIds: resolvedSecondary.length > 0 ? resolvedSecondary : prev.secondaryTopicIds,
  };
}

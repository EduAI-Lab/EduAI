import {
  buildEduaiDiagramFence,
  extractStagesFromDraft,
  normalizeStagesForType,
  type EduaiDiagramStage,
} from "~/lib/ai/eduai-diagram-payload";
import {
  resolveEduaiDiagramTypeId,
  type EduaiDiagramCanonicalId,
} from "~/lib/ai/eduai-diagram-type";
import { userRequestedDiagram, type AdhdTurnProfile } from "~/lib/ai/adhd-turn-profile";
import { jsonObjectSchema, type JsonObject, type JsonValue } from "~/lib/json-value";

/**
 * The model supplies semantics; the application supplies the learner-facing
 * Markdown shape. vLLM applies this schema with constrained decoding, so small
 * models cannot omit the later stages or stop before the visual payload.
 */
const STAGE_COUNT_WORDS = {
  three: 3,
  four: 4,
  five: 5,
} as const;

function stageCountWordValue(token: string): number | undefined {
  if (token === "three" || token === "four" || token === "five") {
    return STAGE_COUNT_WORDS[token];
  }
  return undefined;
}

/**
 * Honor an explicit learner request such as "exactly five ordered stages".
 * The value becomes part of the constrained schema, rather than relying on a
 * small model to remember a stage-count instruction in its prompt.
 */
export function resolveRequestedAssistStageCount(userText?: string): number | null {
  const match =
    /\b(?:exactly\s+)?(3|4|5|three|four|five)(?:\s+(?:ordered|labeled|labelled|clear|simple))*\s+(?:stages?|steps?)\b/i.exec(
      userText ?? "",
    );
  if (!match) return null;
  const token = match[1].toLowerCase();
  const count = Number(token) || stageCountWordValue(token) || 0;
  return count >= 3 && count <= 5 ? count : null;
}

export function buildAdhdAssistStructuredResponseSchema(
  exactStageCount?: number | null,
  diagramType?: EduaiDiagramCanonicalId,
) {
  const stageCount =
    exactStageCount != null && exactStageCount >= 3 && exactStageCount <= 5
      ? exactStageCount
      : null;
  // The compare visual is intentionally two-sided. Keep the default process
  // flow contract at 3-5 stages, while allowing compare prompts to satisfy
  // their own two-stage payload without being silently truncated later.
  const compareWithoutExplicitCount = diagramType === "compare" && stageCount == null;

  return {
    type: "object" as const,
    properties: {
      title: { type: "string" as const },
      answer: { type: "string" as const },
      stages: {
        type: "array" as const,
        minItems: stageCount ?? (compareWithoutExplicitCount ? 2 : 3),
        maxItems: stageCount ?? (compareWithoutExplicitCount ? 2 : 5),
        items: {
          type: "object" as const,
          properties: {
            label: { type: "string" as const },
            detail: { type: "string" as const },
          },
          required: ["label", "detail"],
          additionalProperties: false,
        },
      },
      tldr: { type: "string" as const },
      next: { type: "string" as const },
    },
    required: ["title", "answer", "stages", "tldr", "next"],
    additionalProperties: false,
  };
}

export const ADHD_ASSIST_STRUCTURED_RESPONSE_SCHEMA = buildAdhdAssistStructuredResponseSchema();

export type AdhdStructuredResponse = {
  title: string;
  answer: string;
  stages: EduaiDiagramStage[];
  tldr: string;
  next: string;
};

export function isVllmStructuredAdhdAssistModel(modelIdentifier: string): boolean {
  return /^vllm:qwen3\.5-(?:2b|9b)-instruct$/i.test(modelIdentifier);
}

export function isStructuredAdhdAssistCandidate(options: {
  modelIdentifier: string;
  adhdAssist: boolean;
  imagesPresent: boolean;
  chatMode: "admin" | "learning";
  profile?: AdhdTurnProfile;
  toolsEnabled?: boolean;
}): boolean {
  return (
    options.adhdAssist === true &&
    options.imagesPresent !== true &&
    options.chatMode === "learning" &&
    options.profile === "full_tutoring" &&
    options.toolsEnabled !== true &&
    isVllmStructuredAdhdAssistModel(options.modelIdentifier)
  );
}

function asNonEmptyString(value: JsonValue | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJsonObject(text: string): JsonObject | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return null;

  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed)?.[1]?.trim();
  if (fenced) candidates.push(fenced);

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      const decoded = jsonObjectSchema.safeParse(parsed);
      if (decoded.success) return decoded.data;
    } catch {
      // The ordinary Markdown path remains available when a provider ignores
      // the response format or truncates before the closing brace.
    }
  }
  return null;
}

export function parseAdhdStructuredResponse(
  text: string,
  expectedStageCount?: number | null,
  diagramType?: EduaiDiagramCanonicalId,
): AdhdStructuredResponse | null {
  const object = parseJsonObject(text);
  if (!object) return null;

  const title = asNonEmptyString(object.title);
  const answer = asNonEmptyString(object.answer);
  const tldr = asNonEmptyString(object.tldr);
  const next = asNonEmptyString(object.next);
  const rawStages = Array.isArray(object.stages) ? object.stages : [];
  const stages = rawStages
    .map((stage) => {
      const decoded = jsonObjectSchema.safeParse(stage);
      if (!decoded.success) return null;
      const label = asNonEmptyString(decoded.data.label);
      const detail = asNonEmptyString(decoded.data.detail);
      return label && detail ? { label, detail } : null;
    })
    .filter((stage): stage is EduaiDiagramStage => stage !== null);

  const exactStageCount =
    expectedStageCount != null && expectedStageCount >= 3 && expectedStageCount <= 5
      ? expectedStageCount
      : null;
  const minimumStageCount = diagramType === "compare" && exactStageCount == null ? 2 : 3;
  const maximumStageCount = diagramType === "compare" && exactStageCount == null ? 2 : 5;
  if (
    !title ||
    !answer ||
    !tldr ||
    !next ||
    stages.length < minimumStageCount ||
    stages.length > maximumStageCount ||
    (exactStageCount != null && stages.length !== exactStageCount)
  ) {
    return null;
  }
  return { title, answer, stages: stages.slice(0, 5), tldr, next };
}

function cleanNextPrompt(next: string): string {
  const cleaned = next.replace(/^\*{0,2}next\??\*{0,2}\s*:?\s*/i, "").trim();
  return cleaned.endsWith("?") ? cleaned : `${cleaned}?`;
}

/**
 * Convert the constrained model object into the stable Markdown contract the
 * UI and persisted chat history already understand.
 */
export function renderAdhdStructuredResponse(args: {
  text: string;
  userText?: string;
}): string | null {
  const requestedStageCount = resolveRequestedAssistStageCount(args.userText);
  const requestedTypeId = resolveEduaiDiagramTypeId({ userText: args.userText });
  const parsed = parseAdhdStructuredResponse(
    args.text,
    requestedStageCount,
    requestedStageCount && requestedStageCount > 2 ? "process-flow" : requestedTypeId,
  );
  if (!parsed) return null;

  const resolvedTypeId = resolveEduaiDiagramTypeId({
    userText: args.userText,
    draftText: `${parsed.title}\n${parsed.answer}\n${parsed.stages.map((stage) => stage.label).join("\n")}`,
  });
  // The comparison visual supports only two sides. An explicit request for
  // three to five stages must remain a process flow even when a topic (for
  // example, binary search) contains comparison-like wording.
  const typeId = requestedStageCount && requestedStageCount > 2 ? "process-flow" : resolvedTypeId;
  const stages = normalizeStagesForType(typeId, parsed.stages);
  const summary = stages.map((stage) => `- **${stage.label}** — ${stage.detail}`).join("\n");
  const ladder = stages
    .map((stage, index) => `${index + 1}. **${stage.label}** — ${stage.detail}`)
    .join("\n");
  const diagram = userRequestedDiagram(args.userText)
    ? `\n\n${buildEduaiDiagramFence({
        typeId,
        title: parsed.title,
        stages,
        userText: args.userText,
      })}`
    : "";

  return [
    "**Top summary**",
    summary,
    "",
    "### Step ladder",
    `Start here: **${stages[0]?.label ?? "the first stage"}** (~5 min)`,
    ladder,
    diagram,
    "",
    parsed.answer,
    "",
    `**Next?** ${cleanNextPrompt(parsed.next)}`,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Add the canonical visual after oversight when a provider fell back to Markdown. */
export function ensureAdhdAssistDiagram(args: { text: string; userText?: string }): string {
  if (!userRequestedDiagram(args.userText) || /```eduai-diagram\b/i.test(args.text)) {
    return args.text;
  }

  const requestedStageCount = resolveRequestedAssistStageCount(args.userText);
  const extracted = extractStagesFromDraft(args.text);
  if (extracted.length < 3) return args.text;
  const typeId =
    requestedStageCount && requestedStageCount > 2
      ? "process-flow"
      : resolveEduaiDiagramTypeId({
          userText: args.userText,
          draftText: args.text,
        });
  const stages = normalizeStagesForType(typeId, extracted);
  return `${args.text.trim()}\n\n${buildEduaiDiagramFence({
    typeId,
    title: "Steps",
    stages,
    userText: args.userText,
  })}`;
}

import {
  buildEduaiDiagramFence,
  normalizeStagesForType,
  type EduaiDiagramStage,
} from "~/lib/ai/eduai-diagram-payload";
import { resolveEduaiDiagramTypeId } from "~/lib/ai/eduai-diagram-type";
import {
  userRequestedDiagram,
  type AdhdTurnProfile,
} from "~/lib/ai/adhd-turn-profile";

/**
 * The model supplies semantics; the application supplies the learner-facing
 * Markdown shape. vLLM applies this schema with constrained decoding, so small
 * models cannot omit the later stages or stop before the visual payload.
 */
const STAGE_COUNT_WORDS: Record<string, number> = {
  three: 3,
  four: 4,
  five: 5,
};

/**
 * Honor an explicit learner request such as "exactly five ordered stages".
 * The value becomes part of the constrained schema, rather than relying on a
 * small model to remember a stage-count instruction in its prompt.
 */
export function resolveRequestedAssistStageCount(
  userText?: string,
): number | null {
  const match =
    /\b(?:exactly\s+)?(3|4|5|three|four|five)(?:\s+(?:ordered|labeled|labelled|clear|simple))*\s+(?:stages?|steps?)\b/i.exec(
      userText ?? "",
    );
  if (!match) return null;
  const token = match[1].toLowerCase();
  const count = Number(token) || STAGE_COUNT_WORDS[token];
  return count >= 3 && count <= 5 ? count : null;
}

export function buildAdhdAssistStructuredResponseSchema(
  exactStageCount?: number | null,
) {
  const stageCount =
    exactStageCount != null && exactStageCount >= 3 && exactStageCount <= 5
      ? exactStageCount
      : null;

  return {
    type: "object" as const,
    properties: {
      title: { type: "string" as const },
      answer: { type: "string" as const },
      stages: {
        type: "array" as const,
        minItems: stageCount ?? 3,
        maxItems: stageCount ?? 5,
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

export const ADHD_ASSIST_STRUCTURED_RESPONSE_SCHEMA =
  buildAdhdAssistStructuredResponseSchema();

export type AdhdStructuredResponse = {
  title: string;
  answer: string;
  stages: EduaiDiagramStage[];
  tldr: string;
  next: string;
};

export function isVllmStructuredAdhdAssistModel(
  modelIdentifier: string,
): boolean {
  return /^vllm:[^:]+$/i.test(modelIdentifier);
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

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
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
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // The ordinary Markdown path remains available when a provider ignores
      // the response format or truncates before the closing brace.
    }
  }
  return null;
}

export function parseAdhdStructuredResponse(
  text: string,
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
      if (!stage || typeof stage !== "object") return null;
      const value = stage as Record<string, unknown>;
      const label = asNonEmptyString(value.label);
      const detail = asNonEmptyString(value.detail);
      return label && detail ? { label, detail } : null;
    })
    .filter((stage): stage is EduaiDiagramStage => stage !== null);

  if (!title || !answer || !tldr || !next || stages.length < 3) return null;
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
  const parsed = parseAdhdStructuredResponse(args.text);
  if (!parsed) return null;

  const typeId = resolveEduaiDiagramTypeId({
    userText: args.userText,
    draftText: `${parsed.title}\n${parsed.answer}\n${parsed.stages.map((stage) => stage.label).join("\n")}`,
  });
  const stages = normalizeStagesForType(typeId, parsed.stages);
  const summary = stages
    .map((stage) => `- **${stage.label}** — ${stage.detail}`)
    .join("\n");
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
    parsed.answer,
    "",
    "### Step ladder",
    `Start here: **${stages[0]?.label ?? "the first stage"}** (~5 min)`,
    ladder,
    diagram,
    "",
    `**TLDR** ${parsed.tldr}`,
    "",
    `**Next?** ${cleanNextPrompt(parsed.next)}`,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

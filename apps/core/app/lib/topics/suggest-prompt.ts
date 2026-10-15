import { cleanTopicName, isUsableTopicName, MAX_TOPIC_NAME_LENGTH } from "~/lib/topics/candidates";
import { asFiniteNumber, asJsonArray, asJsonObject, asText, parseJsonText } from "~/lib/json-value";

/** Most topics one Suggest run may propose. */
export const MAX_SUGGESTIONS_PER_RUN = 10;

/**
 * Most materials described in one prompt. Each summary is bounded below, so
 * this keeps the whole prompt well inside the campus model's context.
 */
export const MAX_SUGGEST_MATERIALS = 150;

/** Longest summary line for one material. */
export const MAX_SUMMARY_CHARS = 400;

/** Excerpt length used for a material that has no headings to describe it. */
const EXCERPT_CHARS = 200;

/** Headings listed per material. */
const MAX_SUMMARY_HEADINGS = 5;

export const TOPIC_SUGGEST_SYSTEM_PROMPT = [
  "You review a university course's materials and its topic list, and propose the topics the course is missing.",
  "Rules:",
  "- Only propose a topic that the materials clearly cover and that no existing, pending, or dismissed topic already covers.",
  "- Never propose a rewording, plural, abbreviation, or slightly broader or narrower version of a listed topic.",
  "- Never propose a dismissed topic again.",
  "- Each topic must be a short noun phrase using the materials' wording, not a sentence or a question.",
  `- Each topic name must be at most ${MAX_TOPIC_NAME_LENGTH} characters.`,
  "- List the numbers of the files each topic covers. A topic must cover at least one file.",
  `- Propose at most ${MAX_SUGGESTIONS_PER_RUN} topics. Propose none if nothing is missing.`,
  "- Respond with JSON only, no prose and no code fences, in the form:",
  '  {"topics": [{"name": "<topic>", "files": [1, 3]}]}',
].join("\n");

/** What the prompt says about one material. */
export type MaterialSummary = {
  title: string;
  canvasModules: string[];
  headings: string[];
  /** Used only when there are no headings. */
  excerpt: string | null;
  topics: string[];
};

/** One line describing a material, bounded to `MAX_SUMMARY_CHARS`. */
export function summarizeMaterial(summary: MaterialSummary): string {
  const parts = [summary.title];
  if (summary.canvasModules.length > 0) parts.push(`module: ${summary.canvasModules.join("; ")}`);
  if (summary.headings.length > 0) {
    parts.push(`headings: ${summary.headings.slice(0, MAX_SUMMARY_HEADINGS).join("; ")}`);
  } else if (summary.excerpt) {
    const excerpt = summary.excerpt.replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS);
    if (excerpt) parts.push(`starts: ${excerpt}`);
  }
  parts.push(summary.topics.length > 0 ? `topics: ${summary.topics.join(", ")}` : "no topic yet");
  const line = parts.join(" | ");
  return line.length > MAX_SUMMARY_CHARS ? `${line.slice(0, MAX_SUMMARY_CHARS - 1)}…` : line;
}

export type TopicSuggestPromptInput = {
  accepted: string[];
  pending: string[];
  dismissed: string[];
  /** Already summarized, in the order their numbers refer to (1-based). */
  materials: string[];
};

const bullets = (names: string[]) =>
  names.length > 0 ? names.map((name) => `- ${name}`).join("\n") : "(none)";

/** Build the user prompt: the three topic lists, then the numbered files. */
export function buildTopicSuggestPrompt(input: TopicSuggestPromptInput): string {
  return [
    "## Existing topics",
    bullets(input.accepted),
    "## Suggestions awaiting review",
    bullets(input.pending),
    "## Dismissed topics (never propose these again)",
    bullets(input.dismissed),
    "## Files",
    input.materials.map((line, index) => `${index + 1}. ${line}`).join("\n"),
  ].join("\n\n");
}

/** One proposed topic, before it is checked against the course. */
export type TopicSuggestion = {
  name: string;
  /** 0-based indexes into the prompt's file list, deduplicated and in range. */
  files: number[];
};

/** Strip the code fence a model adds despite being told not to. */
function stripCodeFence(raw: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(raw);
  return fenced ? fenced[1] : raw;
}

/**
 * Parse the model's reply into proposals, keeping only well-formed ones: a
 * usable name and at least one file number that exists in the prompt. Returns
 * `[]` for a reply that is not the expected shape.
 *
 * The caller still has to check each name against the course's topics.
 */
export function parseTopicSuggestResponse(
  content: string,
  materialCount: number,
): TopicSuggestion[] {
  const reply = asJsonObject(parseJsonText(stripCodeFence(content.trim())));
  const topics = asJsonArray(reply?.topics) ?? [];

  const suggestions: TopicSuggestion[] = [];
  for (const entry of topics) {
    const topic = asJsonObject(entry);
    const raw = asText(topic?.name);
    if (raw === null) continue;
    const name = cleanTopicName(raw);
    if (!isUsableTopicName(name)) continue;

    const files = new Set<number>();
    for (const value of asJsonArray(topic?.files) ?? []) {
      const number = asFiniteNumber(value);
      if (number !== null && Number.isInteger(number) && number >= 1 && number <= materialCount) {
        files.add(number - 1);
      }
    }
    if (files.size === 0) continue;

    suggestions.push({ name, files: [...files] });
    if (suggestions.length >= MAX_SUGGESTIONS_PER_RUN) break;
  }
  return suggestions;
}

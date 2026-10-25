import {
  asFiniteNumber,
  asJsonObject,
  asText,
  parseJsonText,
  type JsonValue,
} from "~/lib/json-value";

/** How much of the material's text is shown to the model. */
export const MATCH_EXCERPT_CHARS = 4000;

/**
 * Most topics listed in one prompt. A real course has a few dozen; the cap only
 * bounds a pathological one so the prompt cannot grow without limit.
 */
export const MAX_PROMPT_TOPICS = 200;

export const TOPIC_MATCH_SYSTEM_PROMPT = [
  "You file one university course material under the course's existing topics.",
  "You are given the course's topics and one material.",
  "Choose the topic that covers the material's main subject, if any does.",
  "Rules:",
  "- Only choose a topic from the list. Never invent a new topic.",
  "- A topic fits when it covers the material's main subject, even if the wording differs (abbreviations, plurals, synonyms).",
  "- If no topic clearly fits, answer none. A wrong topic is worse than none.",
  "- Respond with JSON only. No prose, no code fences.",
  '- When a topic fits: {"match": "<the topic name exactly as listed>", "confidence": <0-100, how sure you are it fits>}',
  '- When none fits: {"match": null}',
].join("\n");

export type TopicMatchPromptInput = {
  topics: string[];
  material: { title: string; rawText: string | null };
};

/**
 * Build the user prompt for one material.
 *
 * Topics are listed by name rather than numbered, so the model answers with the
 * name itself and the caller can check it against the list instead of trusting
 * an index.
 */
export function buildTopicMatchPrompt(input: TopicMatchPromptInput): string {
  const topics = input.topics.slice(0, MAX_PROMPT_TOPICS);
  const excerpt = (input.material.rawText ?? "").slice(0, MATCH_EXCERPT_CHARS).trim();

  return [
    "## Topics",
    topics.map((name) => `- ${name}`).join("\n"),
    `## Material: ${input.material.title}`,
    excerpt || "(no extracted text; use the title)",
  ].join("\n\n");
}

/** Strip the code fence a model adds despite being told not to. */
function stripCodeFence(raw: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(raw);
  return fenced ? fenced[1] : raw;
}

/** The model's verdict on one material, before it is checked against the course. */
export type TopicMatchDecision =
  | {
      kind: "match";
      name: string;
      /** The model's own 0–100 estimate (#1998); null when it gave none or an unusable one. */
      confidence: number | null;
    }
  | { kind: "none" };

/** A 0–100 whole number from the model's reply, or null. A 0–1 fraction is scaled up. */
function parseConfidence(raw: JsonValue | undefined): number | null {
  const value = asFiniteNumber(raw);
  if (value === null || value < 0) return null;
  const percent = value > 0 && value <= 1 && !Number.isInteger(value) ? value * 100 : value;
  return percent > 100 ? null : Math.round(percent);
}

/**
 * Parse the model's reply, or null when it is not one of the two allowed shapes.
 *
 * A chosen name is returned as written; the caller must still confirm it names
 * a real topic.
 */
export function parseTopicMatchResponse(content: string): TopicMatchDecision | null {
  const reply = asJsonObject(parseJsonText(stripCodeFence(content.trim())));
  if (!reply || !("match" in reply)) return null;
  if (reply.match === null) return { kind: "none" };
  const name = asText(reply.match)?.trim();
  return name ? { kind: "match", name, confidence: parseConfidence(reply.confidence) } : null;
}

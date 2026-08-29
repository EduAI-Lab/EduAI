import {
  ORIGIN_CONFIDENCE,
  cleanTopicName,
  isUsableTopicName,
  MAX_TOPIC_NAME_LENGTH,
  type TopicCandidate,
} from "~/lib/topics/candidates";

/** Upper bound on topics the model may propose for one course. */
export const MAX_AI_TOPICS = 20;

/** How much of each material's text is shown to the model. */
export const AI_EXCERPT_CHARS = 4000;

/** Materials sampled for the prompt — enough to see the shape of the course, not the whole corpus. */
export const AI_MAX_SAMPLED_MATERIALS = 8;

export const TOPIC_ANALYSIS_SYSTEM_PROMPT = [
  "You organise university course materials into chapter-level topics.",
  `Propose at most ${MAX_AI_TOPICS} topics that describe how this course's content is structured.`,
  "Rules:",
  "- Use wording that appears in the material. Do not invent subject matter that is not there.",
  "- Prefer the course's own structural labels (Chapter, Unit, Week, Module) when the material uses them.",
  "- Each topic must be a short noun phrase, not a sentence or a question.",
  `- Each topic name must be at most ${MAX_TOPIC_NAME_LENGTH} characters.`,
  "- Do not output duplicates or near-duplicates.",
  '- Respond with JSON only, in the form {"topics": ["...", "..."]}. No prose, no code fences.',
].join("\n");

export type SampledMaterial = { id: string; title: string; rawText: string | null };

/**
 * The bounded sample of materials the model is shown.
 *
 * Exported and applied by the caller so the prompt and the recorded provenance
 * are cut from the same list: `CourseTopicSource` must name material the model
 * actually read, never the whole batch it was drawn from.
 */
export function sampleMaterialsForPrompt<T>(materials: T[]): T[] {
  return materials.slice(0, AI_MAX_SAMPLED_MATERIALS);
}

/**
 * Build the user prompt from a bounded sample of the course's materials.
 *
 * Each excerpt is labelled with its material id so the model's ordering is
 * traceable, but ids are deliberately NOT used to attribute individual topics —
 * a model claiming "topic 3 came from material X" is exactly the kind of
 * unverifiable output this feature must not record as provenance. Every
 * AI-derived topic is attributed to the whole sampled set instead.
 */
export function buildTopicAnalysisPrompt(materials: SampledMaterial[]): string {
  const sampled = sampleMaterialsForPrompt(materials);
  const sections = sampled.map((material, index) => {
    const excerpt = (material.rawText ?? "").slice(0, AI_EXCERPT_CHARS).trim();
    return [`### Material ${index + 1}: ${material.title}`, excerpt || "(no extracted text)"].join(
      "\n",
    );
  });

  return [
    "Course materials follow. Propose the topics this course is organised into.",
    "",
    ...sections,
  ].join("\n\n");
}

/** Strip the code fence a model adds despite being told not to. */
function stripCodeFence(raw: string): string {
  const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n\s*```\s*$/.exec(raw);
  return fenced ? fenced[1] : raw;
}

/**
 * Parse the model's reply into candidates, discarding anything that is not a
 * usable topic name.
 *
 * Returns `[]` rather than throwing on malformed output: a model that ignores
 * the format is a "no topics found" outcome, not a job failure, and the caller
 * already has the zero-topic fallback for that case.
 */
export function parseTopicAnalysisResponse(
  content: string,
  materialIds: string[],
): TopicCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(content));
  } catch {
    return [];
  }

  const topics =
    parsed !== null && typeof parsed === "object" && "topics" in parsed
      ? (parsed as { topics: unknown }).topics
      : null;
  if (!Array.isArray(topics)) return [];

  const seen = new Set<string>();
  const candidates: TopicCandidate[] = [];

  for (const entry of topics) {
    if (typeof entry !== "string") continue;
    const name = cleanTopicName(entry);
    if (!isUsableTopicName(name) || seen.has(name)) continue;
    seen.add(name);

    candidates.push({
      name,
      origin: "AI",
      confidence: ORIGIN_CONFIDENCE.AI,
      materialIds: [...materialIds],
    });

    if (candidates.length >= MAX_AI_TOPICS) break;
  }

  return candidates;
}

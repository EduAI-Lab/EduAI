/**
 * Predefined response-style tags instructors can assign per course (#782).
 * Tag prompt snippets are injected into the system prompt at chat time —
 * students never see the raw text.
 */

export type ResponseStyleTagId =
  | "socratic"
  | "concise"
  | "step-by-step"
  | "encouraging"
  | "formal"
  | "example-driven"
  | "scaffolded";

export interface ResponseStyleTag {
  id: ResponseStyleTagId;
  label: string;
  description: string;
  promptSnippet: string;
  /** Short sample shown in the instructor UI when a tag is selected. */
  exampleResponse: string;
}

export const RESPONSE_STYLE_TAGS: readonly ResponseStyleTag[] = [
  {
    id: "socratic",
    label: "Socratic",
    description: "Guide with questions instead of giving direct answers.",
    promptSnippet:
      "Use the Socratic method: ask thoughtful guiding questions that help the student discover the answer. Avoid giving the full solution upfront unless they are stuck after several exchanges.",
    exampleResponse:
      "What do you think happens to the derivative at a local maximum? How might that connect to the slope of the tangent line?",
  },
  {
    id: "concise",
    label: "Concise",
    description: "Short, focused answers without extra padding.",
    promptSnippet:
      "Keep responses brief and focused. Prefer short paragraphs or bullet points. Omit filler and avoid repeating the question.",
    exampleResponse:
      "Three things to remember: the core idea, why it matters, and how to apply it.",
  },
  {
    id: "step-by-step",
    label: "Step-by-step",
    description: "Break explanations into numbered, sequential steps.",
    promptSnippet:
      "Structure explanations as numbered steps. Complete one step before moving to the next. Summarize the result at the end.",
    exampleResponse:
      "1. Identify the known variables.\n2. Choose the appropriate formula.\n3. Substitute values and solve.\n4. Check units and reasonableness.",
  },
  {
    id: "encouraging",
    label: "Encouraging",
    description: "Warm, supportive tone that validates effort.",
    promptSnippet:
      "Use a warm, supportive tone. Acknowledge effort and partial understanding. Encourage persistence without being patronizing.",
    exampleResponse:
      "You're on the right track — setting up the equation correctly is the hardest part. Let's work through the next step together.",
  },
  {
    id: "formal",
    label: "Formal",
    description: "Academic register with precise terminology.",
    promptSnippet:
      "Use formal academic language and precise terminology appropriate for university coursework. Define technical terms on first use.",
    exampleResponse:
      "A binary search tree maintains the invariant that for every node, all keys in the left subtree are less than the node's key.",
  },
  {
    id: "example-driven",
    label: "Example-driven",
    description: "Lead with concrete examples before abstractions.",
    promptSnippet:
      "Prefer concrete examples and analogies before abstract definitions. Use course-relevant scenarios when possible.",
    exampleResponse:
      "Think of a stack like a pile of plates: you add and remove from the top. In code, push() adds and pop() removes the most recent item.",
  },
  {
    id: "scaffolded",
    label: "Scaffolded",
    description: "Start simple, then add complexity gradually.",
    promptSnippet:
      "Start with a simplified version of the concept, then layer in complexity. Check understanding before advancing to harder material.",
    exampleResponse:
      "Let's start with a single variable, then we'll extend to two. Does the basic case make sense before we add the second dimension?",
  },
] as const;

export const RESPONSE_STYLE_TAG_IDS = RESPONSE_STYLE_TAGS.map((t) => t.id);

const tagById = new Map(RESPONSE_STYLE_TAGS.map((t) => [t.id, t]));

export function getResponseStyleTag(id: string): ResponseStyleTag | undefined {
  return tagById.get(id as ResponseStyleTagId);
}

export function resolveResponseStyleTags(tagIds: string[] | null | undefined): ResponseStyleTag[] {
  const seen = new Set<string>();
  const resolved: ResponseStyleTag[] = [];
  for (const id of tagIds ?? []) {
    if (seen.has(id)) continue;
    const tag = getResponseStyleTag(id);
    if (tag) {
      seen.add(id);
      resolved.push(tag);
    }
  }
  return resolved;
}

/** Whether the course has any AI behaviour configuration applied. */
export function courseHasAiConfig(
  tagIds: string[],
  aiInstructions?: string | null,
): boolean {
  return tagIds.length > 0 || Boolean(aiInstructions?.trim());
}

/**
 * Compose the instructor-configured style block for injection into the system prompt.
 * Returns an empty string when nothing is configured.
 */
export function buildCourseResponseStylePrompt(
  tagIds: string[],
  customInstructions?: string | null,
): string {
  const tags = resolveResponseStyleTags(tagIds);
  const parts: string[] = [];

  if (tags.length > 0) {
    const lines = tags.map((t) => `- **${t.label}**: ${t.promptSnippet}`);
    parts.push(`## Course response style\nFollow these instructor preferences:\n${lines.join("\n")}`);
  }

  const trimmed = customInstructions?.trim();
  if (trimmed) {
    parts.push(`## Additional course instructions\n${trimmed}`);
  }

  return parts.join("\n\n");
}

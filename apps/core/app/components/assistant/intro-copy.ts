/**
 * @file The assistant's empty-state introduction (#1824). Pure.
 *
 * Two rules it has to keep:
 * 1. The in-course variant still advertises platform help — documentation
 *    retrieval runs on every question, so "how do I…" works inside a course too,
 *    and an intro offering only course help would teach readers the opposite.
 * 2. Every example question names a guide page that really exists in the asking
 *    role's OWN slice. An example the corpus can't answer would make the very
 *    first reply "that isn't in the documentation".
 */
import { ASSISTANT_DISPLAY_NAME } from "~/lib/assistant/assistant-settings";
import { helpSliceForRole, type HelpSlice } from "~/lib/help/role-slices";

export type IntroExample =
  /** A platform how-to question, answered from guide page `pageId`. */
  | { kind: "docs"; question: string; pageId: string }
  /** A question about the course or material in scope. */
  | { kind: "material"; question: string };

export type AssistantIntro = {
  title: string;
  lines: string[];
  examples: IntroExample[];
};

type DocsExample = Extract<IntroExample, { kind: "docs" }>;

/** Docs examples by the slice whose pages answer them. */
export const DOCS_EXAMPLES = {
  student: [
    { kind: "docs", question: "How do I find my courses?", pageId: "find-a-course" },
    {
      kind: "docs",
      question: "How do I ask a question about my course materials?",
      pageId: "course-chat",
    },
    { kind: "docs", question: "How do I report a bug?", pageId: "navigation" },
  ],
  instructor: [
    { kind: "docs", question: "How do I connect my Canvas account?", pageId: "canvas-sync" },
    { kind: "docs", question: "How do I add students from a CSV file?", pageId: "bulk-enrollment" },
  ],
  admin: [
    {
      kind: "docs",
      question: "Where do I manage AI providers and models?",
      pageId: "platform-admin",
    },
    {
      kind: "docs",
      question: "How do unit administrators invite users?",
      pageId: "unit-admin-invitations",
    },
  ],
} satisfies Record<HelpSlice, DocsExample[]>;

const MAX_EXAMPLES = 3;

/** The asking role's own top-slice examples first, topped up from the student slice. */
export function docsExamplesForRole(role: string | null | undefined): DocsExample[] {
  const top = helpSliceForRole(role);
  const ordered: DocsExample[] =
    top === "student" ? DOCS_EXAMPLES.student : [...DOCS_EXAMPLES[top], ...DOCS_EXAMPLES.student];
  return ordered.slice(0, MAX_EXAMPLES);
}

export function buildAssistantIntro(input: {
  role: string | null | undefined;
  /** Set when the panel is scoped to a course or material. */
  scopeLabel: string | null;
  isMaterial: boolean;
  /** Whether the documentation half is on. */
  docs: boolean;
}): AssistantIntro {
  const title = `Hi, I'm ${ASSISTANT_DISPLAY_NAME}.`;
  const lines: string[] = [];
  const examples: IntroExample[] = [];

  if (input.scopeLabel) {
    lines.push(
      input.isMaterial
        ? `Ask me about ${input.scopeLabel} — I'll answer from what's in that material.`
        : `Ask me about ${input.scopeLabel} — I'll answer from its course materials.`,
    );
    examples.push({
      kind: "material",
      question: input.isMaterial
        ? "What are the key ideas in this material?"
        : "What topics do this course's materials cover?",
    });
  }
  if (input.docs) {
    lines.push(
      input.scopeLabel
        ? "I can still help with how EduAI works, too — I answer those from the EduAI user guide for your role."
        : "Ask me how to do something in EduAI. I answer from the EduAI user guide for your role and link the pages I used.",
    );
    examples.push(...docsExamplesForRole(input.role).slice(0, input.scopeLabel ? 2 : MAX_EXAMPLES));
  }
  lines.push(
    "If something isn't covered, I'll say so rather than guess. Check anything important against your course or instructor.",
  );
  return { title, lines, examples };
}

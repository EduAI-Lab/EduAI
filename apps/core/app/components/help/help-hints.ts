/**
 * Core's progressive-help copy for `HelpHint` (#1053). Every `href` must point
 * at a topic id in `help-view.tsx`; `help-hints.test.ts` enforces that.
 */
import type { HelpHintContent } from "@eduai/ui";

export const CORE_HELP = {
  materialStates: {
    title: "Material status",
    summary: "Whether a file is still being prepared, live for chat, or needs attention.",
    details:
      "Processing: the file is being read and indexed. Embedded: it's ready and the course chatbot can search and cite it. Failed: it couldn't be indexed; the row explains why and offers a retry when one can work.",
    href: "/help#material-status",
  },
  coursePublishing: {
    title: "Publishing",
    summary: "Unpublished courses are hidden from students until you publish them.",
    details:
      "While a course is unpublished, only course staff and administrators can open it, and self-enrollment links won't let anyone join. Publish it when it's ready; unpublishing removes student access again without deleting anything.",
    href: "/help#publishing",
  },
  materialVisibility: {
    title: "What students see",
    summary:
      "Show or hide course files for students: all at once, by topic, or one file at a time.",
    details:
      "A hidden file isn't shown to students and isn't used to answer their chat questions. Hiding a topic hides its files and its name. A scheduled file stays hidden until its date. Instructors and TAs always see every file.",
    href: "/help#publishing",
  },
  chatScope: {
    title: "Course chat vs. general chat",
    summary: "Course chat answers only from one course's materials.",
    details:
      "Course Chat searches the selected course's uploaded materials and cites them, so switching course starts a separately scoped conversation. The admin chatbot and the instructors' course assistant are operational helpers: they work with platform or roster data, not course content.",
    href: "/help#chat-scope",
  },
  aiModels: {
    title: "AI models",
    summary: "The specific models people can pick in chat, and which ones power embeddings.",
    details:
      "Each model belongs to a provider. Only active models on an active provider are offered. Chat models appear in the chat model picker; embedding models turn course materials into searchable text. Auto routing and Assist use the models you assign to them here.",
    href: "/help#ai-models",
  },
  aiProviders: {
    title: "AI providers",
    summary: "The services EduAI connects to for AI, such as a cloud API or a campus server.",
    details:
      "A provider holds the connection details (endpoint and API key). Turning a provider off hides all of its models at once. Add a provider before adding or syncing its models.",
    href: "/help#ai-models",
  },
  platformPolicies: {
    title: "Platform policies",
    summary: "Platform-wide switches that decide what each role may do.",
    details:
      "Each switch applies to every course on the platform as soon as you flip it, with no save step. Turning one off hides or blocks that capability for the whole role, so check who relies on it first.",
    href: "/help#platform-policies",
  },
} satisfies Record<string, HelpHintContent>;

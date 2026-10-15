/**
 * Question Maker's progressive-help copy for `HelpHint` (#1055). Every `href`
 * must match an article id in `pages/HelpPage.tsx`; `helpHints.test.ts`
 * enforces that, and the help page opens the matching accordion from the hash.
 */
import type { HelpHintContent } from "@eduai/ui";

export const QUESTION_MAKER_HELP = {
  draftVsReviewed: {
    title: "Draft vs. reviewed",
    summary: "Drafts are unchecked work; reviewed variants are ready to export and share.",
    details:
      "Every new or AI-generated variant starts as a draft. An instructor marks it reviewed once they've checked it. Drafts can't be exported to Canvas, Word or TXT, and only reviewed variants can be shared with AI Tutor.",
    href: "/help#draft-vs-reviewed",
  },
  questionVsVariant: {
    title: "Questions and variants",
    summary: "A question is the shared idea; each variant is one concrete version of it.",
    details:
      "The question holds what all versions share: its type and primary topic. Each variant has its own wording, answer, difficulty and secondary topics, and is reviewed on its own. Use variants to build equivalent versions of an exam from one bank.",
    href: "/help#variants",
  },
  topics: {
    title: "Primary and secondary topics",
    summary:
      "The primary topic is what a question is about; secondary topics are what else it touches.",
    details:
      "Every question needs exactly one primary topic, and all its variants share it. Secondary topics are optional and set per variant. Assessment searches and blueprints filter on both, so tag secondary topics whenever a question also tests them.",
    href: "/help#topics",
  },
  aiModels: {
    title: "UBC-hosted vs. external models",
    summary: "UBC-hosted models stay on campus; external models send your prompt to a provider.",
    details:
      "UBC-hosted models run on campus infrastructure and need no API key, but only work on UBC wifi or VPN. External models (such as OpenAI, Gemini or Anthropic) need your own API key, and your prompt and course content go to that provider.",
    href: "/help#ai-models",
  },
  exportReadiness: {
    title: "Export readiness",
    summary: "An assessment can export once it has questions and none of them are drafts.",
    details:
      "Export to Canvas, Word or TXT unlocks when the assessment has at least one question and every variant in it is marked reviewed. Canvas export also needs instructor access to the target Canvas course.",
    href: "/help#export-readiness",
  },
} satisfies Record<string, HelpHintContent>;

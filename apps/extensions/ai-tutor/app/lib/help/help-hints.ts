/**
 * AI Tutor's progressive-help copy for `HelpHint` (#1054). Every `href` must
 * point at a topic id in `components/help/HelpView.tsx`; `help-hints.test.tsx`
 * enforces that for each role that can see the hint.
 */
import type { HelpHintContent } from "@eduai/ui";

export const AI_TUTOR_HELP = {
  chatModes: {
    title: "Teach me vs. Guide me",
    summary: "Teach me explains the topic; Guide me hints so you solve it yourself.",
    details:
      "Teach me answers questions and explains concepts directly. Guide me won't hand over the answer: it asks questions and gives hints that lead you there. Your instructor chooses which modes each activity offers, and may add a third, custom mode.",
    href: "/help#chat-modes",
  },
  authoringModes: {
    title: "AI study buddy modes",
    summary: "Choose whether students can ask for explanations, hints, or both.",
    details:
      "Teach me explains the topic and answers questions directly. Guide me withholds the answer and coaches with hints and questions instead. At least one mode must stay on. Each mode keeps its own conversation for the student.",
    href: "/help#chat-modes",
  },
  knowledgeLevel: {
    title: "Knowledge level",
    summary: "Tells the tutor how much you already know, so it pitches answers at your level.",
    details:
      "The tutor is told your level with every message and adjusts how it explains: more basics for Beginner, more depth for Advanced. You set it per activity, and you can change it any time from the level button above the chat.",
    href: "/help#knowledge-level",
  },
  publishingHierarchy: {
    title: "Publishing",
    summary: "Students only see a lesson when its course, module and lesson are all published.",
    details:
      "Publish from the top down: the course is published in EduAI Core, then each module, then each lesson. A module can't be published until its course is, nor a lesson until its module is. Unpublishing a course or module hides everything beneath it.",
    href: "/help#publishing",
  },
  topicSync: {
    title: "Topics",
    summary: "Topics come from the course in EduAI Core and stay in sync automatically.",
    details:
      "The topic list is pulled from Core whenever it's loaded, so topics added in Core appear here without any action. A topic you create here is saved to Core first, so it's shared with the other EduAI apps. Tag each activity with one main topic and any secondary ones.",
    href: "/help#topics",
  },
  grading: {
    title: "Grading",
    summary: "Multiple-choice and keyed short answers grade themselves; open answers wait for you.",
    details:
      "A multiple-choice answer is checked against the correct option. A short answer is compared with the answer key, ignoring case and extra spaces. A short answer with no key is left ungraded until staff review it here. You can override any grade and add a score.",
    href: "/help#grading",
  },
} satisfies Record<string, HelpHintContent>;

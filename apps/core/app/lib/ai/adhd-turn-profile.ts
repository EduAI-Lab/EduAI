import {
  ADHD_CLARIFICATION_USER_WORD_THRESHOLD,
  ADHD_CLARIFICATION_WORD_CAP,
  ADHD_TUTORING_WORD_CAP,
} from "~/lib/ai/adhd-metrics";

/** Turn type for context-aware ADHD Assist policy and oversight. */
export type AdhdTurnProfile =
  | "full_tutoring"
  | "brief_clarification"
  | "confirmation"
  | "greeting"
  | "redirect"
  | "meta";

export type AdhdProfileRequirements = {
  profile: AdhdTurnProfile;
  wordCap: number;
  runDean: boolean;
  expectTopSummary: boolean;
  expectNextLine: boolean;
  /** Dean checks §5 drift / one-topic redirect template. */
  expectRedirectTemplate: boolean;
};

export const ADHD_GREETING_WORD_CAP = 80;

/** Social openers — excludes bare ok/okay (those stay brief or confirmation). */
const ADHD_GREETING_PATTERN =
  /^(hi|hello|hey|good morning|good afternoon|good evening|thanks|thank you|bye)\b/i;

const CONFIRMATION_PATTERN =
  /^(yes|yeah|yep|yup|got it|ok|okay|sure|right|correct|understood|makes sense|i see|gotcha|sounds good|perfect|great)\b/i;

const META_PATTERN =
  /^(what can you do|how does this (work|chat|tutor)|what are you|who are you|what do you do)\b/i;

/** Off-topic or multi-topic injection when a tutor turn already exists. */
const REDIRECT_PATTERN =
  /\b(also explain|in the same answer|ignore (your )?(earlier|previous)|can we (talk|switch|discuss)|let's (talk|switch|discuss)|want to switch)\b/i;

/** Short follow-ups that refer to an ongoing tutoring thread (not bare confirmations). */
const SUBSTANTIVE_CONTINUATION_PATTERN =
  /\b(step \d+|step \w+|the plan|from before|pick up|continue|go back|first \d+ minutes|expand step)\b/i;

/** Short tutoring questions that should not fall through to brief_clarification. */
const SUBSTANTIVE_QUESTION_PATTERN =
  /\b(what is|what are|how does|how do|why|explain|define|describe|walk me through|compare|summarize)\b/i;

/** Learner asked for a visual / ASCII diagram — must not use brief policy (no DIAGRAMS rules). */
export const ADHD_DIAGRAM_REQUEST_PATTERN =
  /\b(diagram|draw|sketch|animat(?:e|ed|ion)|visuali[sz]e|ascii\s*art|show\s+(me\s+)?(a\s+)?(picture|figure|plot|graph)|make\s+(me\s+)?(a\s+)?diagram)\b/i;

export function userRequestedDiagram(userText?: string): boolean {
  return ADHD_DIAGRAM_REQUEST_PATTERN.test((userText ?? "").trim());
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

function hasPriorAssistant(priorAssistantText?: string): boolean {
  return Boolean(priorAssistantText?.trim());
}

/**
 * Rules-first turn classifier (Approach A). Runs before generation when ADHD Assist is on.
 * Priority: redirect → substantive Q/continuation → confirmation → greeting → meta → brief → full.
 *
 * Substantive question/continuation detection runs before confirmation, greeting, and meta so
 * that acknowledgement-prefixed tutoring turns ("Great, what is gradient descent?",
 * "Sure, explain step 2") keep full structure + Dean instead of falling into the low-structure
 * confirmation path. Redirect stays first because redirect phrases ("also explain …") contain
 * substantive keywords but are off-topic injections, not genuine tutoring questions.
 */
export function resolveAdhdTurnProfile(args: {
  userText?: string;
  priorAssistantText?: string;
}): AdhdTurnProfile {
  const trimmed = (args.userText ?? "").trim();
  const prior = args.priorAssistantText?.trim() ?? "";
  const wordCount = countWords(trimmed);

  if (!trimmed) {
    return "full_tutoring";
  }

  if (hasPriorAssistant(prior) && REDIRECT_PATTERN.test(trimmed)) {
    return "redirect";
  }

  if (SUBSTANTIVE_QUESTION_PATTERN.test(trimmed)) {
    return "full_tutoring";
  }

  // Diagram asks are often short ("draw it", "make a diagram") and would otherwise
  // fall into brief_clarification — which omits DIAGRAMS rules and starves the reply.
  if (userRequestedDiagram(trimmed)) {
    return "full_tutoring";
  }

  if (hasPriorAssistant(prior) && SUBSTANTIVE_CONTINUATION_PATTERN.test(trimmed)) {
    return "full_tutoring";
  }

  if (
    hasPriorAssistant(prior) &&
    wordCount <= ADHD_CLARIFICATION_USER_WORD_THRESHOLD &&
    CONFIRMATION_PATTERN.test(trimmed)
  ) {
    return "confirmation";
  }

  if (ADHD_GREETING_PATTERN.test(trimmed)) {
    return "greeting";
  }

  if (META_PATTERN.test(trimmed)) {
    return "meta";
  }

  if (wordCount <= ADHD_CLARIFICATION_USER_WORD_THRESHOLD) {
    return "brief_clarification";
  }

  return "full_tutoring";
}

export function getProfileRequirements(profile: AdhdTurnProfile): AdhdProfileRequirements {
  switch (profile) {
    case "greeting":
      return {
        profile,
        wordCap: ADHD_GREETING_WORD_CAP,
        runDean: false,
        expectTopSummary: false,
        expectNextLine: false,
        expectRedirectTemplate: false,
      };
    case "confirmation":
      return {
        profile,
        wordCap: ADHD_CLARIFICATION_WORD_CAP,
        runDean: false,
        expectTopSummary: false,
        expectNextLine: false,
        expectRedirectTemplate: false,
      };
    case "meta":
      return {
        profile,
        wordCap: ADHD_CLARIFICATION_WORD_CAP,
        runDean: false,
        expectTopSummary: false,
        expectNextLine: false,
        expectRedirectTemplate: false,
      };
    case "redirect":
      return {
        profile,
        wordCap: ADHD_CLARIFICATION_WORD_CAP,
        runDean: true,
        expectTopSummary: false,
        expectNextLine: false,
        expectRedirectTemplate: true,
      };
    case "brief_clarification":
      return {
        profile,
        wordCap: ADHD_CLARIFICATION_WORD_CAP,
        runDean: true,
        expectTopSummary: true,
        expectNextLine: true,
        expectRedirectTemplate: false,
      };
    case "full_tutoring":
    default:
      return {
        profile: "full_tutoring",
        wordCap: ADHD_TUTORING_WORD_CAP,
        runDean: true,
        expectTopSummary: true,
        expectNextLine: true,
        expectRedirectTemplate: false,
      };
  }
}

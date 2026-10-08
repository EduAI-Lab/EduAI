/**
 * @file The help assistant's documentation allowlist (#1819) — pure data.
 *
 * Every citable page is one `##`/`###` section of an indexed guide, named here by
 * its exact heading, with the role slice that may read it and a stable id. The id
 * is the ONLY thing retrieval hands back; content is always re-read from this
 * entry's own resolved section, never from a path built out of model or client
 * output. An id that is not in this list for the reader's slices is dropped.
 *
 * Adding a section to a guide without listing it here (or in `EXCLUDED_SECTIONS`
 * with a reason) fails `help-docs.manifest.test.ts`.
 */
import type { HelpSlice } from "~/lib/help/role-slices";

/** The guides indexed into the corpus. Keys are what `sources.server.ts` loads. */
export const HELP_DOC_SOURCES = {
  "user-guide": { file: "docs/USER_GUIDE.md", label: "User guide" },
  "instructor-onboarding": {
    file: "docs/INSTRUCTOR_ONBOARDING.md",
    label: "Instructor onboarding",
  },
} as const;

export type HelpDocSourceId = keyof typeof HELP_DOC_SOURCES;

export type HelpDocPage = {
  /** Stable, URL-safe id. Also the citation route segment: `/help/guide/<id>`. */
  id: string;
  source: HelpDocSourceId;
  /** The section's heading text, exactly as written in the guide. */
  heading: string;
  /** Display title for citations; defaults to the heading. */
  title?: string;
  slice: HelpSlice;
};

export const HELP_DOC_PAGES: readonly HelpDocPage[] = [
  // ── User guide: everyone ──────────────────────────────────────────────────
  { id: "applications", source: "user-guide", heading: "The three applications", slice: "student" },
  {
    id: "navigation",
    source: "user-guide",
    heading: "Navigation shared across the platform",
    slice: "student",
  },
  {
    id: "penny",
    source: "user-guide",
    heading: "Ask Penny, the help assistant",
    slice: "student",
  },
  { id: "sign-in", source: "user-guide", heading: "Sign in and account setup", slice: "student" },
  { id: "roles", source: "user-guide", heading: "Roles and access", slice: "student" },
  { id: "find-a-course", source: "user-guide", heading: "Find a course", slice: "student" },
  {
    id: "course-chat",
    source: "user-guide",
    heading: "Ask a course-aware question",
    slice: "student",
  },
  {
    id: "course-materials",
    source: "user-guide",
    heading: "Work with course materials",
    slice: "student",
  },
  {
    id: "ai-tutor-activities",
    source: "user-guide",
    heading: "Student: complete an activity with AI guidance",
    title: "AI Tutor: complete an activity",
    slice: "student",
  },
  {
    id: "ta-workflows",
    source: "user-guide",
    heading: "TA and administrator workflows",
    title: "AI Tutor: TA and administrator workflows",
    slice: "student",
  },
  { id: "troubleshooting", source: "user-guide", heading: "Troubleshooting", slice: "student" },

  // ── User guide: instructors ───────────────────────────────────────────────
  {
    id: "canvas-sync",
    source: "user-guide",
    heading: "Instructor: connect and sync Canvas",
    slice: "instructor",
  },
  {
    id: "bulk-enrollment",
    source: "user-guide",
    heading: "Instructor: add students in bulk or by link",
    slice: "instructor",
  },
  {
    id: "course-assistant",
    source: "user-guide",
    heading: "Instructor: the Course Assistant",
    slice: "instructor",
  },
  {
    id: "chat-oversight",
    source: "user-guide",
    heading: "Instructor and unit administrator: chat oversight",
    slice: "instructor",
  },
  {
    id: "ai-tutor-authoring",
    source: "user-guide",
    heading: "Instructor: build course content",
    title: "AI Tutor: build course content",
    slice: "instructor",
  },
  {
    id: "qm-workspace",
    source: "user-guide",
    heading: "Open a course workspace",
    title: "Question Maker: open a course workspace",
    slice: "instructor",
  },
  {
    id: "qm-variants",
    source: "user-guide",
    heading: "Create and approve an AI-assisted question variant",
    title: "Question Maker: create and approve an AI variant",
    slice: "instructor",
  },
  {
    id: "qm-assessments",
    source: "user-guide",
    heading: "Build an assessment and variants",
    title: "Question Maker: build an assessment",
    slice: "instructor",
  },
  {
    id: "qm-import",
    source: "user-guide",
    heading: "Import questions or a Canvas quiz",
    title: "Question Maker: import questions or a Canvas quiz",
    slice: "instructor",
  },

  // ── User guide: administrators ────────────────────────────────────────────
  {
    id: "unit-admin-invitations",
    source: "user-guide",
    heading: "Unit administrator: invitations",
    slice: "admin",
  },
  {
    id: "platform-admin",
    source: "user-guide",
    heading: "Platform administrator",
    slice: "admin",
  },

  // ── Instructor onboarding ─────────────────────────────────────────────────
  {
    id: "onboarding-hosts",
    source: "instructor-onboarding",
    heading: "Where to sign in",
    title: "Onboarding: where to sign in",
    slice: "instructor",
  },
  {
    id: "onboarding-welcome",
    source: "instructor-onboarding",
    heading: "1. Welcome",
    title: "Onboarding: welcome",
    slice: "instructor",
  },
  {
    id: "onboarding-invitation",
    source: "instructor-onboarding",
    heading: "Accept your invitation",
    title: "Onboarding: accept your invitation",
    slice: "instructor",
  },
  {
    id: "onboarding-first-sign-in",
    source: "instructor-onboarding",
    heading: "Sign in",
    title: "Onboarding: sign in",
    slice: "instructor",
  },
  {
    id: "onboarding-dashboard",
    source: "instructor-onboarding",
    heading: "Land on your dashboard",
    title: "Onboarding: your dashboard",
    slice: "instructor",
  },
  {
    id: "onboarding-canvas-token",
    source: "instructor-onboarding",
    heading: "Create a Canvas access token",
    title: "Onboarding: create a Canvas access token",
    slice: "instructor",
  },
  {
    id: "onboarding-canvas-connect",
    source: "instructor-onboarding",
    heading: "Connect it in EduAI",
    title: "Onboarding: connect Canvas in EduAI",
    slice: "instructor",
  },
  {
    id: "onboarding-canvas-fetch",
    source: "instructor-onboarding",
    heading: "Fetch courses into EduAI",
    title: "Onboarding: fetch courses from Canvas",
    slice: "instructor",
  },
  {
    id: "onboarding-course-basics",
    source: "instructor-onboarding",
    heading: "4. Core course basics",
    title: "Onboarding: course page basics",
    slice: "instructor",
  },
  {
    id: "onboarding-materials",
    source: "instructor-onboarding",
    heading: "Materials",
    title: "Onboarding: course materials",
    slice: "instructor",
  },
  {
    id: "onboarding-enrollments",
    source: "instructor-onboarding",
    heading: "Enrollments",
    title: "Onboarding: enrollments",
    slice: "instructor",
  },
  {
    id: "onboarding-publish",
    source: "instructor-onboarding",
    heading: "Publish the course",
    title: "Onboarding: publish the course",
    slice: "instructor",
  },
  {
    id: "onboarding-open-ai-tutor",
    source: "instructor-onboarding",
    heading: "Open AI Tutor",
    title: "Onboarding: open AI Tutor",
    slice: "instructor",
  },
  {
    id: "onboarding-ai-tutor-publish",
    source: "instructor-onboarding",
    heading: "Publish a module or lesson",
    title: "Onboarding: publish an AI Tutor module or lesson",
    slice: "instructor",
  },
  {
    id: "onboarding-open-qm",
    source: "instructor-onboarding",
    heading: "Open Question Maker",
    title: "Onboarding: open Question Maker",
    slice: "instructor",
  },
  {
    id: "onboarding-qm-workspace",
    source: "instructor-onboarding",
    heading: "Open the course workspace",
    title: "Onboarding: the Question Maker workspace",
    slice: "instructor",
  },
  {
    id: "onboarding-qm-variant",
    source: "instructor-onboarding",
    heading: "Create a question, then generate an AI variant",
    title: "Onboarding: create a question and an AI variant",
    slice: "instructor",
  },
  {
    id: "onboarding-qm-bank",
    source: "instructor-onboarding",
    heading: "Confirm it appears in the bank",
    title: "Onboarding: find it in the question bank",
    slice: "instructor",
  },
  {
    id: "onboarding-stuck",
    source: "instructor-onboarding",
    heading: "7. If you're stuck (quick reference)",
    title: "Onboarding: if you're stuck",
    slice: "instructor",
  },
  {
    id: "onboarding-limitations",
    source: "instructor-onboarding",
    heading: "8. Known limitations",
    title: "Onboarding: known limitations",
    slice: "instructor",
  },
];

/**
 * Sections with body text that are deliberately NOT indexed, each with a reason.
 * Headings whose only content is their subsections are skipped automatically and
 * need no entry here.
 */
export const EXCLUDED_SECTIONS: readonly {
  source: HelpDocSourceId;
  heading: string;
  reason: string;
}[] = [
  {
    source: "instructor-onboarding",
    heading: "3. Connect Canvas and fetch courses",
    reason: "A one-line lead-in; its three subsections are indexed individually.",
  },
  {
    source: "instructor-onboarding",
    heading: "9. Walkthrough checklist (team dry-run)",
    reason: "Internal QA checklist, explicitly not part of instructor onboarding.",
  },
  {
    source: "instructor-onboarding",
    heading: "Related documentation",
    reason: "Links to developer documentation that has no in-app route.",
  },
];

/** The citation URL for a page. Every indexed page has one: the in-app guide viewer. */
export function helpDocUrl(pageId: string): string {
  return `/help/guide/${encodeURIComponent(pageId)}`;
}

export function helpDocTitle(page: HelpDocPage): string {
  return page.title ?? page.heading;
}

const PAGES_BY_ID: ReadonlyMap<string, HelpDocPage> = new Map(
  HELP_DOC_PAGES.map((page) => [page.id, page]),
);

/**
 * The allowlist lookup. Returns a page only for an EXACT id match that the given
 * slices may read; anything else — a traversal-shaped string, an unknown id, an
 * id from a slice the reader lacks — is null.
 */
export function findAllowedHelpPage(
  pageId: string,
  slices: readonly HelpSlice[],
): HelpDocPage | null {
  const page = PAGES_BY_ID.get(pageId);
  if (!page) return null;
  return slices.includes(page.slice) ? page : null;
}

export function helpPagesForSlices(slices: readonly HelpSlice[]): HelpDocPage[] {
  return HELP_DOC_PAGES.filter((page) => slices.includes(page.slice));
}

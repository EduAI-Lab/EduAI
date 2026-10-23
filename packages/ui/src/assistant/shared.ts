/**
 * @file The help assistant's pure, server-safe pieces (#1822, #1824, #1958):
 * the persona name, the role → guide-slice mapping, and the visibility rule.
 * No React here, so Core's server modules can import it too.
 *
 * The bubble and the help page's "Ask a question" hand-off both call
 * {@link isAssistantVisible}, so they can never disagree about whether clicking
 * would open anything.
 */

/**
 * The assistant's user-facing name. Copy reads this; nothing else should. "Penny"
 * is a product decision that can change again, so it never appears in routes,
 * modules or setting keys.
 */
export const ASSISTANT_DISPLAY_NAME = "Penny";

/** Documentation slices, lowest first. Slices are cumulative. */
export const HELP_SLICES = ["student", "instructor", "admin"] as const;

export type HelpSlice = (typeof HELP_SLICES)[number];

/** The highest slice a platform role reaches. Unknown or missing roles get the student slice. */
export function helpSliceForRole(role: string | null | undefined): HelpSlice {
  switch (role) {
    case "ADMIN":
    case "UNIT_ADMIN":
      return "admin";
    case "INSTRUCTOR":
      return "instructor";
    default:
      return "student";
  }
}

/** What Core decides server-side for the signed-in user. */
export type AssistantGateSnapshot = {
  /** Render the widget at all (docs available, or material grounding possible). */
  mounted: boolean;
  /** The documentation half applies on every page. */
  docs: boolean;
};

/** What a page publishes about the course or material the reader is viewing. */
export type PublishedAssistantContext = {
  courseId: string;
  materialId: string | null;
  /** Panel-header label for the scope, e.g. "CS101 — Intro" or a material title. */
  label: string;
  /** Server-decided through the same gate the ask endpoint uses. */
  materialScope: boolean;
};

/**
 * Mounted is not visible. Visible when documentation is available everywhere, or
 * the current page published a context whose material scope is true — so in a
 * material-only configuration the bubble stays hidden on every other page.
 */
export function isAssistantVisible(
  gate: AssistantGateSnapshot | null | undefined,
  published: Pick<PublishedAssistantContext, "materialScope"> | null | undefined,
): boolean {
  if (!gate?.mounted) return false;
  return gate.docs || published?.materialScope === true;
}

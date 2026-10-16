/**
 * @file Whether the assistant is visible on a page (#1822, #1824). Client-safe.
 *
 * The bubble and the help page's "Ask a question" hand-off both call
 * {@link isAssistantVisible}, so they can never disagree about whether clicking
 * would open anything.
 */

/** What the root loader decides server-side for the signed-in user. */
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
  /** Server-decided by the page's loader through the same gate. */
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

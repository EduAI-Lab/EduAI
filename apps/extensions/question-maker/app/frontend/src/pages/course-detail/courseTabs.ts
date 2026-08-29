/**
 * Tab identity for the course detail page, shared with the URL `?tab=` param.
 */
export type ActiveTab = "overview" | "questions" | "banks" | "assessments" | "canvas";

export const VALID_TABS: ActiveTab[] = ["overview", "questions", "banks", "assessments", "canvas"];

/**
 * Resolves the tab to show from the URL param. The Canvas tab exists only for
 * courses synced from Canvas, so a link to it on any other course lands on
 * Overview instead — but while the Canvas link is still resolving (`null`) the
 * request is honoured, so a deep link into Canvas is not bounced on load.
 */
export function resolveCourseTab(
  tabParam: string | null,
  isCanvasLinked: boolean | null,
): ActiveTab {
  // SAFETY: the assertion is only read after `VALID_TABS.includes` confirms the
  // param is one of the tab names, so the widening cast cannot escape as a
  // non-tab string.
  const requested = VALID_TABS.includes(tabParam as ActiveTab)
    ? (tabParam as ActiveTab)
    : "overview";
  if (requested === "canvas" && isCanvasLinked === false) return "overview";
  return requested;
}

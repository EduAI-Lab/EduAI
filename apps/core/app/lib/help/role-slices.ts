/**
 * @file The persona → documentation-slice mapping (#1819), defined exactly once.
 *
 * Both the static help page (`components/help/help-view.tsx`) and the help
 * assistant's retrieval (`lib/assistant/help-docs/`) filter documentation through
 * {@link visibleHelpSlices}, so the guide a reader can browse and the guide the
 * assistant may cite for them can never disagree.
 *
 * Slices are cumulative: an instructor sees the student pages too, and both
 * kinds of administrator see everything.
 */

export const HELP_SLICES = ["student", "instructor", "admin"] as const;

export type HelpSlice = (typeof HELP_SLICES)[number];

export function isHelpSlice(value: string): value is HelpSlice {
  return HELP_SLICES.some((slice) => slice === value);
}

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

/** Every slice a role may read, lowest first. Enforced server-side at query time. */
export function visibleHelpSlices(role: string | null | undefined): HelpSlice[] {
  const top = HELP_SLICES.indexOf(helpSliceForRole(role));
  return HELP_SLICES.slice(0, top + 1);
}

export function canReadHelpSlice(role: string | null | undefined, slice: HelpSlice): boolean {
  return visibleHelpSlices(role).includes(slice);
}

import { IconEye } from "@tabler/icons-react";
import { Link } from "react-router";
import { Button } from "@eduai/ui";

/**
 * #1843: shown on the instructor surface when the viewer's platform role is
 * ADMIN or UNIT_ADMIN — i.e. an account that reached the instructor view
 * through a real course enrollment rather than through its platform role.
 *
 * Deliberately modelled on AI Tutor's `StudentPreviewBanner` (#1660) so the
 * two apps do not grow two interaction patterns for the same idea: a label
 * plus a way back, with no mode stored anywhere. Switching views in either app
 * is navigation, not state.
 *
 * Purely a label — it grants and blocks nothing. The instructor surface's own
 * boundary is enforced server-side by `canUseInstructorChatMode`, which admits
 * these accounts only on a course they hold an active INSTRUCTOR enrollment
 * for. Hiding this banner would not narrow that, and showing it does not widen
 * it.
 *
 * One deliberate divergence from AI Tutor, worth writing down: its banner says
 * "previewing", because an instructor looking at the student view is not a
 * student and its writes are refused. This one does not, because the viewer
 * really is an instructor of record on the course — the enrollment is the
 * whole reason they can be here. Calling it a preview would misdescribe it.
 */
export function InstructorViewBanner({
  exitHref = "/admin",
  exitLabel = "Back to admin",
  description = "You are signed in as an administrator and are viewing the courses you teach. Your administrator access is unchanged.",
}: {
  exitHref?: string;
  exitLabel?: string;
  description?: string;
}) {
  return (
    <div
      className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
      data-testid="instructor-view-banner"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex gap-3">
          <IconEye className="mt-0.5 size-5 shrink-0 text-primary-text" aria-hidden />
          <div className="min-w-0 space-y-1">
            <p className="text-sm font-medium text-foreground">Instructor view</p>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" className="shrink-0" asChild>
          <Link to={exitHref} data-testid="instructor-view-exit">
            {exitLabel}
          </Link>
        </Button>
      </div>
    </div>
  );
}

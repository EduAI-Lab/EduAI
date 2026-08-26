import { IconEye } from "@tabler/icons-react";
import { RoleBadge } from "@eduai/ui";
import type { Role } from "~/lib/types";

/**
 * #1660: shown on the /student/* content pages when the viewer isn't a real
 * STUDENT or TA of the course — i.e. an ADMIN, UNIT_ADMIN, or INSTRUCTOR
 * previewing the learner experience "without switching accounts" (issue
 * text). Distinct from AtRoleBanner (which describes what a role's OWN pages
 * can do): this says "you are looking at someone else's view."
 *
 * Purely a label — it does not grant or block anything. The actual
 * preview-vs-real-student boundary is enforced server-side per route
 * (course/module/lesson reads already allow staff; student-only writes like
 * answer submission and AI chat already reject non-STUDENT callers there,
 * unchanged by #1660).
 */
export function StudentPreviewBanner({ role }: { role: Role }) {
  return (
    <div
      className="rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
      data-testid="student-preview-banner"
    >
      <div className="flex gap-3">
        <IconEye className="mt-0.5 size-5 shrink-0 text-primary-text" aria-hidden />
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium text-foreground">Previewing as a student</p>
            <RoleBadge role={role} />
          </div>
          <p className="text-sm text-muted-foreground">
            This is a read-only preview of the learner experience. Answer submissions and AI
            tutoring are only available to enrolled students.
          </p>
        </div>
      </div>
    </div>
  );
}

/** True when `role` should see the preview banner on a /student/* page. */
export function isStudentPreviewRole(role: Role | null | undefined): boolean {
  return role === "ADMIN" || role === "UNIT_ADMIN" || role === "INSTRUCTOR";
}

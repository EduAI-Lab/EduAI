import type { ReactNode } from "react";
import { IconAlertTriangle } from "@tabler/icons-react";

export type SelfEnrollmentLinkStatus = "ACTIVE" | "REVOKED" | "EXPIRED" | "EXHAUSTED";

const SELF_ENROLLMENT_STATUS_LABELS = {
  ACTIVE: "Active",
  REVOKED: "Turned off",
  EXPIRED: "Expired",
  EXHAUSTED: "Limit reached",
} satisfies Record<SelfEnrollmentLinkStatus, string>;

/**
 * The link's status as the instructor should read it. An ACTIVE link on a Draft
 * course turns every student away (`COURSE_NOT_PUBLISHED`), so calling it
 * "Active" there was the misleading part (#1939). The server status is unchanged.
 */
export function selfEnrollmentStatusLabel(
  status: SelfEnrollmentLinkStatus,
  courseIsPublished: boolean,
): string {
  if (status === "ACTIVE" && !courseIsPublished) return "Waiting for publish";
  return SELF_ENROLLMENT_STATUS_LABELS[status];
}

interface SelfEnrollmentDraftNoticeProps {
  /** The publish control, or null when this viewer may not publish. */
  publishControl: ReactNode | null;
}

/** Shown in the self-enrollment section while the course is a Draft (#1939). */
export function SelfEnrollmentDraftNotice({ publishControl }: SelfEnrollmentDraftNoticeProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
      <p className="flex items-start gap-2">
        <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />
        <span>
          This course is a draft. Students who open a self-enrollment link see &ldquo;Can&apos;t
          join this course&rdquo; until it is published.
          {publishControl ? null : " Ask an administrator to publish it."}
        </span>
      </p>
      {publishControl}
    </div>
  );
}

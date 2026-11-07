/**
 * @file The ⋯ menu on a staff course banner: publish/unpublish the course
 * (confirmed by the caller) and a way back to the course in EduAI Core.
 */
import {
  IconDotsVertical,
  IconExternalLink,
  IconWorldOff,
  IconWorldUpload,
} from "@tabler/icons-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@eduai/ui";
import { getEduAiAppUrl } from "~/lib/extension-urls";
import { courseCode } from "~/lib/course-display";
import type { Course } from "~/lib/types";
import { BANNER_MENU_TRIGGER_CLASS } from "~/components/layout/CourseHeader";

export function CourseBannerMenu({
  course,
  canPublish,
  onTogglePublish,
}: {
  course: Course;
  canPublish: boolean;
  onTogglePublish: () => void;
}) {
  const coreHref = course.coreOfferingId
    ? `${getEduAiAppUrl()}/courses/${encodeURIComponent(course.coreOfferingId)}`
    : null;
  if (!canPublish && !coreHref) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`${courseCode(course)} course actions`}
          className={BANNER_MENU_TRIGGER_CLASS}
        >
          <IconDotsVertical className="size-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[200px]">
        {canPublish && (
          <DropdownMenuItem className="gap-2" onSelect={onTogglePublish}>
            {course.isPublished ? (
              <IconWorldOff className="size-4 text-muted-foreground" aria-hidden="true" />
            ) : (
              <IconWorldUpload className="size-4 text-muted-foreground" aria-hidden="true" />
            )}
            {course.isPublished ? "Unpublish course" : "Publish course"}
          </DropdownMenuItem>
        )}
        {canPublish && coreHref && <DropdownMenuSeparator />}
        {coreHref && (
          <DropdownMenuItem asChild className="gap-2">
            <a href={coreHref}>
              <IconExternalLink className="size-4 text-muted-foreground" aria-hidden="true" />
              Open in EduAI
            </a>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { Avatar } from "@eduai/ui";

import type { CourseDetail, CourseDetailInstructor } from "~/hooks/api/use-course-detail";

/**
 * The teaching-team block shared by the manager, TA and student course-detail
 * views (#1841).
 *
 * All three rendered `course.instructor` — a single column — so a course with
 * three instructors displayed one. Extracted rather than fixed three times:
 * the three copies had already drifted in wording, and a fourth surface should
 * not have to rediscover the fallback rules below.
 */

/**
 * What to display, newest contract first.
 *
 * `instructors` is the real set. A payload from before #1841 (or one serialized
 * without `detail`) carries only `instructor`, so fall back to it rather than
 * rendering an empty panel — the extensions and any cached client state can
 * still be on the old shape.
 */
export function resolveDisplayInstructors(
  course: Pick<CourseDetail, "instructor" | "instructors">,
): CourseDetailInstructor[] {
  if (course.instructors && course.instructors.length > 0) return course.instructors;
  if (course.instructor) {
    return [
      {
        // Redacted for students, so the email is no longer a usable key.
        id: course.instructor.id ?? course.instructor.email ?? course.instructor.name,
        name: course.instructor.name,
        email: course.instructor.email,
        isPrimary: true,
      },
    ];
  }
  return [];
}

/**
 * A short label for a course card or list row: names while they fit, a count
 * once they do not. Returns null when a course has no instructor of record, so
 * callers omit the badge entirely rather than render "0 instructors".
 *
 * Lives here rather than in `instructors.server.ts` so the client bundle can
 * import it without pulling Prisma in.
 */
export function instructorsBadgeLabel(
  instructors: Pick<CourseDetailInstructor, "name">[],
): string | null {
  if (instructors.length === 0) return null;
  if (instructors.length === 1) return instructors[0].name;
  if (instructors.length === 2) return `${instructors[0].name} +1`;
  return `${instructors.length} instructors`;
}

type Props = {
  instructors: CourseDetailInstructor[];
  /**
   * Shown under the instructors. Passed as a node because each view already
   * renders its TA row differently (avatars vs. plain names).
   */
  children?: React.ReactNode;
};

/**
 * Renders every instructor. The heading is singular or plural to match, so a
 * course with one instructor reads exactly as it did before.
 */
export function CourseInstructorsPanel({ instructors, children }: Props) {
  return (
    <>
      <p className="text-sm font-semibold text-foreground">
        {instructors.length === 1 ? "Instructor" : "Instructors"}
      </p>
      <div className="flex flex-col gap-3">
        {instructors.map((instructor) => (
          <div key={instructor.id} className="flex items-center gap-3">
            <Avatar name={instructor.name} size={40} radius={9} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">{instructor.name}</p>
              {/* Null for students, who see who teaches the course but not how
                  to reach them — the same boundary as the TA roster. */}
              {instructor.email && (
                <p className="text-xs text-muted-foreground">{instructor.email}</p>
              )}
            </div>
          </div>
        ))}
      </div>
      {children}
    </>
  );
}

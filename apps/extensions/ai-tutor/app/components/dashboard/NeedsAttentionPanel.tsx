/**
 * @file "Needs attention" panel — the dashboard's right column for teaching
 * roles (INSTRUCTOR, UNIT_ADMIN) that manage publish state. Surfaces the draft
 * courses that still need publishing so a ready-to-go course never gets
 * forgotten. Mirrors the learner `ContinueLearningPanel` idiom: a solid
 * accent-fill hero for the top draft plus a compact accent-railed list for the
 * rest. Derived entirely from the real `isPublished` flag on
 * `api.listCourses()` results — no fabrication.
 *
 * "Publish it" publishes. It used to be a label on a card whose only behaviour
 * was to navigate to the course page — which carries no course-level publish
 * control — so the panel promised an action it never performed. The write it
 * now makes (`PATCH /api/courses/:id/publish`) proxies straight through to
 * Core, the owner of course publish state; AI Tutor holds no publish flag of
 * its own. Publishing a course is deliberately non-cascading, so the confirm
 * says so: modules and lessons still have to be published individually.
 *
 * Each draft therefore carries two affordances, not one: publish it here, or
 * open it first. They are separate controls so a click meant for one can never
 * fire the other.
 */
import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router";
import { toast } from "sonner";
import { IconCircleCheck, IconArrowRight, IconEyeOff } from "@tabler/icons-react";
import { Card, CardContent, ConfirmDialog, courseHeroBackgroundStyle } from "@eduai/ui";
import api from "~/lib/api";
import type { Course } from "~/lib/types";
import { useLocalUser } from "~/hooks/useLocalUser";
import { canPublishContent } from "~/lib/rbac/permissions";
import { accentForCourse, courseCode, courseName } from "~/lib/course-display";
import { TruncatedListNotice } from "~/components/common/TruncatedListNotice";

type NeedsAttentionPanelProps = {
  courses: Course[];
  /** Base path for course drilldown links, e.g. "/instructor". */
  coursesBaseHref: string;
  /**
   * Full course count (#1208). `courses` is one bounded page, so when more exist
   * the panel says so — a draft past the page bound would otherwise be invisible
   * here with no hint that anything was left out.
   */
  total?: number;
};

export function NeedsAttentionPanel({ courses, coursesBaseHref, total }: NeedsAttentionPanelProps) {
  const navigate = useNavigate();
  const revalidator = useRevalidator();
  const { user } = useLocalUser();
  const canPublish = canPublishContent(user);

  const [pending, setPending] = useState<Course | null>(null);
  const [publishingId, setPublishingId] = useState<number | null>(null);
  /**
   * Courses published from this panel, hidden immediately.
   *
   * The list comes from the route loader, and `revalidate()` is a round trip —
   * without this the row a user just published sits there still labelled Draft
   * until the refetch lands, which reads as "nothing happened".
   */
  const [publishedHere, setPublishedHere] = useState<Set<number>>(new Set());

  const drafts = courses.filter((c) => !c.isPublished && !publishedHere.has(c.id));

  const publish = async (course: Course) => {
    setPublishingId(course.id);
    try {
      const updated = await api.publishCourse(course.id);
      setPublishedHere((prev) => new Set(prev).add(course.id));
      // #225 SEAM-04: the write reached Core but the read-back didn't, so the
      // flag we just showed is our own optimism. Say so rather than claiming a
      // confirmed publish.
      toast.success(
        updated?.corePublishStale
          ? `Published ${courseCode(course)} — EduAI hasn't confirmed it back yet.`
          : `${courseCode(course)} is now visible to students.`,
      );
      revalidator.revalidate();
    } catch (error) {
      console.error("Failed to publish course", error);
      toast.error(`Could not publish ${courseCode(course)}. Try again.`);
    } finally {
      setPublishingId((current) => (current === course.id ? null : current));
    }
  };

  if (drafts.length === 0) {
    // "All caught up" is a strong claim to make from one bounded page — a draft
    // sitting past the page bound would make it plainly wrong. Disclose here too.
    return (
      <div className="space-y-3">
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <IconCircleCheck size={20} aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">All caught up</p>
              <p className="text-xs text-muted-foreground">
                Every course you can see is published.
              </p>
            </div>
          </CardContent>
        </Card>
        <TruncatedListNotice
          shown={courses.length}
          total={total ?? courses.length}
          action="search your courses to find the rest"
        />
      </div>
    );
  }

  const [primary, ...others] = drafts;
  const accent = accentForCourse(primary);
  // Darkened accent for the CTA label so text-on-white clears AA contrast.
  const ctaTextColor = `color-mix(in oklch, ${accent} 72%, black)`;
  const openCourse = (course: Course) => navigate(`${coursesBaseHref}/courses/${course.id}`);

  return (
    <div className="flex flex-col gap-3">
      {/* Solid accent-fill hero — the primary draft to publish, mirroring the
          CourseHeroCard/ContinueLearning idiom so it reads as the top action.
          A plain container, not a button: the publish CTA inside it is the real
          control, and a button cannot legally nest inside another. */}
      <div
        style={courseHeroBackgroundStyle(accent)}
        className="group relative w-full overflow-hidden rounded-xl p-5 text-left text-white shadow-sm"
      >
        <div className="relative flex flex-col gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="text-[0.7rem] font-semibold uppercase tracking-wide text-white/70">
                {courseCode(primary)}
              </div>
              <h3 className="text-lg font-semibold leading-snug text-white">
                {courseName(primary)}
              </h3>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-0.5 text-xs font-medium text-white ring-1 ring-inset ring-white/20">
              <span className="size-1.5 rounded-full bg-white" aria-hidden="true" />
              Draft
            </span>
          </div>

          <p className="inline-flex items-center gap-1.5 text-sm text-white/80">
            <IconEyeOff size={15} aria-hidden="true" />
            Not visible to students yet
          </p>

          {canPublish && (
            <button
              type="button"
              onClick={() => setPending(primary)}
              disabled={publishingId === primary.id}
              style={{ color: ctaTextColor }}
              className="mt-1 inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold shadow-sm transition-transform hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent disabled:cursor-not-allowed disabled:opacity-70"
            >
              {publishingId === primary.id ? "Publishing…" : `Publish ${courseCode(primary)}`}
              <IconArrowRight size={16} aria-hidden="true" />
            </button>
          )}

          <button
            type="button"
            onClick={() => openCourse(primary)}
            className="inline-flex cursor-pointer items-center justify-center gap-1 self-start rounded-lg px-1 py-0.5 text-sm font-medium text-white/85 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            Open {courseCode(primary)} first
          </button>
        </div>
      </div>

      {others.length > 0 && (
        <Card>
          <CardContent className="p-0">
            {others.slice(0, 4).map((course) => {
              const otherAccent = accentForCourse(course);
              return (
                <div
                  key={course.id}
                  className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left last:border-b-0"
                >
                  <span
                    className="h-9 w-1 shrink-0 rounded-full"
                    style={{ background: otherAccent }}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={() => openCourse(course)}
                    className="min-w-0 flex-1 cursor-pointer text-left transition-colors hover:opacity-80"
                  >
                    <div className="truncate text-sm font-medium text-foreground">
                      {courseCode(course)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{course.title}</div>
                  </button>
                  {canPublish && (
                    <button
                      type="button"
                      onClick={() => setPending(course)}
                      disabled={publishingId === course.id}
                      className="shrink-0 cursor-pointer text-xs font-medium text-primary-text hover:underline disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {publishingId === course.id ? "Publishing…" : `Publish ${courseCode(course)}`}
                    </button>
                  )}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      <TruncatedListNotice
        shown={courses.length}
        total={total ?? courses.length}
        action="search your courses to find the rest"
      />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        title={pending ? `Publish "${courseName(pending)}"?` : ""}
        description="Students will be able to see this course. Its modules and lessons stay hidden until you publish them individually."
        confirmLabel="Publish"
        variant="default"
        onConfirm={() => {
          if (!pending) return;
          void publish(pending);
          setPending(null);
        }}
      />
    </div>
  );
}

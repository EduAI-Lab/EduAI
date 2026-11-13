import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  IconChevronRight,
  IconFiles,
  IconSettings,
  IconTags,
  IconUsers,
} from "@tabler/icons-react";
import { Avatar, StatusBadge, courseThemeVars, resolvePaletteAccent } from "@eduai/ui";

import { CourseInstructorsPanel } from "~/components/courses/course-instructors-panel";
import { CourseNextSteps, type CourseNextStep } from "~/components/courses/course-next-steps";
import { CourseResponseStyleSummary } from "~/components/courses/course-response-style-settings";
import { courseNavSearch } from "~/lib/courses/course-nav-items";
import { courseHasAiConfig } from "~/lib/ai/response-style-tags";
import type { CourseDetail } from "~/hooks/api/use-course-detail";
import type { CourseTA } from "~/hooks/api/use-course-tas";

type Instructor = Parameters<typeof CourseInstructorsPanel>[0]["instructors"][number];

function QuickLink({
  icon: Icon,
  label,
  value,
  hint,
  to,
}: {
  icon: typeof IconFiles;
  label: string;
  value?: number;
  hint: string;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="group flex flex-col gap-1 rounded-lg border border-border bg-card p-4 shadow-xs transition-colors hover:border-[var(--course-accent)] hover:bg-[var(--course-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="flex items-center justify-between gap-2 text-sm font-semibold text-foreground">
        <span className="inline-flex items-center gap-2">
          <Icon className="size-4 text-[var(--course-accent)]" aria-hidden="true" />
          {label}
        </span>
        <IconChevronRight
          className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5"
          aria-hidden="true"
        />
      </span>
      {value !== undefined && (
        <span className="text-2xl font-semibold text-foreground">{value}</span>
      )}
      <span className="text-xs text-muted-foreground">{hint}</span>
    </Link>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between border-b border-border pb-1.5">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/** material added → ready for the AI → published (#2105). */
export function courseSetupSteps({
  materials,
  isPublished,
  canPublish,
}: {
  materials: { status: string }[];
  isPublished: boolean;
  canPublish: boolean;
}): CourseNextStep[] {
  const total = materials.length;
  const ready = materials.filter((m) => m.status === "READY").length;
  const processing = materials.filter((m) => m.status === "PROCESSING").length;
  const failed = materials.filter((m) => m.status === "FAILED").length;
  const materialsHref = courseNavSearch("materials");
  return [
    {
      key: "upload",
      label: "Add materials",
      done: total > 0,
      detail:
        total > 0
          ? `${total} file${total === 1 ? "" : "s"} added. Add lecture notes, slides or readings any time.`
          : "Upload lecture notes, slides or readings so the AI can answer from them.",
      href: materialsHref,
    },
    {
      key: "ready",
      label: "Materials ready",
      done: ready > 0 && processing === 0,
      detail:
        total === 0
          ? "Files are processed for the AI after you upload them."
          : `${ready} of ${total} ready for chat` +
            (processing > 0 ? `, ${processing} still processing` : "") +
            (failed > 0 ? `, ${failed} failed (open Materials to retry)` : "") +
            ".",
      href: materialsHref,
    },
    {
      key: "publish",
      label: "Publish course",
      done: isPublished,
      detail: isPublished
        ? "Students can see this course and chat about it."
        : canPublish
          ? "Students can't see the course yet. Publish it from the ⋯ menu at the top."
          : "Students can't see the course yet. Only an administrator can publish it.",
    },
  ];
}

/**
 * An instructor's course Overview (#2105): the setup step bar, the numbers
 * that matter, then what students see (description, topics, AI style) beside
 * the teaching team.
 */
export function CourseInstructorOverview({
  course,
  materials,
  topics,
  studentCount,
  canManageSettings,
  instructors,
  tas,
  canPublish,
  publishControl,
}: {
  course: CourseDetail;
  materials: { status: string }[];
  topics: string[];
  studentCount: number;
  canManageSettings: boolean;
  instructors: Instructor[];
  tas: CourseTA[];
  canPublish: boolean;
  publishControl?: ReactNode;
}) {
  const ready = materials.filter((m) => m.status === "READY").length;
  const styleTags = course.responseStyleTags ?? [];
  const hasAiStyle = courseHasAiConfig(styleTags, course.aiInstructions);
  const editLink = (label: string) =>
    canManageSettings ? (
      <Link
        to={courseNavSearch("settings")}
        className="text-xs font-medium text-primary-text hover:underline"
        aria-label={label}
      >
        Edit
      </Link>
    ) : undefined;

  return (
    <div style={courseThemeVars(resolvePaletteAccent(course.id))}>
      <CourseNextSteps
        steps={courseSetupSteps({ materials, isPublished: course.isPublished, canPublish })}
      />

      {/* Not "Course …": that would also match the shell's course menu landmark. */}
      <nav aria-label="Quick links" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <QuickLink
          icon={IconFiles}
          label="Materials"
          value={materials.length}
          hint={`${ready} ready for chat`}
          to={courseNavSearch("materials")}
        />
        <QuickLink
          icon={IconTags}
          label="Topics"
          value={topics.length}
          hint="What the course covers"
          to={courseNavSearch("topics")}
        />
        <QuickLink
          icon={IconUsers}
          label="Students"
          value={studentCount}
          hint="Enrolled and active"
          to={courseNavSearch("enrollments")}
        />
        {canManageSettings && (
          <QuickLink
            icon={IconSettings}
            label="Settings"
            hint="AI style and what students see"
            to={courseNavSearch("settings")}
          />
        )}
      </nav>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section title="About this course" action={editLink("Edit course description")}>
            <p className="text-sm leading-relaxed text-foreground">
              {course.description || (
                <span className="text-muted-foreground">No description yet.</span>
              )}
            </p>
          </Section>
          {(hasAiStyle || canManageSettings) && (
            <Section title="AI response style" action={editLink("Edit AI response style")}>
              {!hasAiStyle ? (
                <p className="text-sm text-muted-foreground">Not set yet.</p>
              ) : styleTags.length > 0 ? (
                <CourseResponseStyleSummary tagIds={styleTags} />
              ) : (
                <p className="text-sm text-foreground">Custom instructions are set.</p>
              )}
            </Section>
          )}
        </div>

        <aside className="flex flex-col gap-6">
          <Section title="Course details">
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-xs">
              {course.department && (
                <>
                  <dt className="text-muted-foreground">Department</dt>
                  <dd className="text-foreground">{course.department}</dd>
                </>
              )}
              <dt className="text-muted-foreground">Status</dt>
              <dd className="flex flex-wrap items-center gap-2">
                <StatusBadge
                  active={course.isPublished}
                  activeLabel="Published"
                  inactiveLabel="Unpublished"
                />
                {publishControl}
              </dd>
            </dl>
          </Section>
          <Section title="Teaching team">
            {instructors.length > 0 ? (
              <CourseInstructorsPanel instructors={instructors} />
            ) : (
              <p className="text-xs text-muted-foreground">No professor assigned</p>
            )}
            <div className="mt-2">
              <p className="mb-2 text-xs font-semibold text-foreground">Teaching assistants</p>
              {tas.length > 0 ? (
                <ul className="flex flex-col gap-1.5">
                  {tas.map((ta) => (
                    <li key={ta.id} className="flex items-center gap-1.5">
                      <Avatar name={ta.user.name} size={22} radius={5} />
                      <span className="text-xs text-foreground">{ta.user.name}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted-foreground">No TAs assigned</p>
              )}
            </div>
          </Section>
        </aside>
      </div>
    </div>
  );
}

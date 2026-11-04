import type { ReactNode } from "react";
import { Avatar } from "@eduai/ui";

import { CourseInstructorsPanel } from "~/components/courses/course-instructors-panel";
import { CourseNextSteps, type CourseNextStep } from "~/components/courses/course-next-steps";
import { CourseResponseStyleSummary } from "~/components/courses/course-response-style-settings";
import { courseNavSearch } from "~/lib/courses/course-nav-items";
import { courseHasAiConfig } from "~/lib/ai/response-style-tags";
import type { CourseDetail } from "~/hooks/api/use-course-detail";
import type { CourseTA } from "~/hooks/api/use-course-tas";

type Instructor = Parameters<typeof CourseInstructorsPanel>[0]["instructors"][number];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="border-b border-border pb-1.5 text-sm font-semibold text-foreground">
        {title}
      </h2>
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
  instructors,
  tas,
  canPublish,
}: {
  course: CourseDetail;
  materials: { status: string }[];
  topics: string[];
  studentCount: number;
  instructors: Instructor[];
  tas: CourseTA[];
  canPublish: boolean;
}) {
  const ready = materials.filter((m) => m.status === "READY").length;
  const hasAiStyle =
    (course.responseStyleTags ?? []).length > 0 &&
    courseHasAiConfig(course.responseStyleTags ?? [], course.aiInstructions);

  return (
    <>
      <CourseNextSteps
        steps={courseSetupSteps({ materials, isPublished: course.isPublished, canPublish })}
      />

      <dl className="mb-6 flex flex-wrap gap-x-10 gap-y-3">
        {[
          ["Students", studentCount],
          ["Materials", materials.length],
          ["Ready for chat", ready],
          ["Topics", topics.length],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="text-xl font-semibold text-foreground">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-6">
          <Section title="About this course">
            <p className="text-sm leading-relaxed text-foreground">
              {course.description || (
                <span className="text-muted-foreground">No description yet.</span>
              )}
            </p>
          </Section>
          <Section title="Topics">
            {topics.length > 0 ? (
              <ul className="flex flex-wrap gap-2">
                {topics.map((t) => (
                  <li
                    key={t}
                    className="rounded-full border border-border bg-muted/60 px-3 py-1 text-xs font-medium text-foreground"
                  >
                    {t}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No topics yet.</p>
            )}
          </Section>
          {hasAiStyle && (
            <Section title="AI response style">
              <CourseResponseStyleSummary tagIds={course.responseStyleTags ?? []} />
            </Section>
          )}
        </div>

        <aside>
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
    </>
  );
}

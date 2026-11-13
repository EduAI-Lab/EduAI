import { IconMessage, IconMessageChatbot } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Avatar, Button, courseThemeVars } from "@eduai/ui";
import {
  CourseInstructorsPanel,
  resolveDisplayInstructors,
} from "~/components/courses/course-instructors-panel";
import { courseHasAiConfig } from "~/lib/ai/response-style-tags";
import { CourseResponseStyleSummary } from "~/components/courses/course-response-style-settings";
import type { CourseDetail } from "~/hooks/api/use-course-detail";
import type { CourseTopic } from "~/hooks/api/use-course-topics";
import type { CourseTA } from "~/hooks/api/use-course-tas";
import { CourseCardCustomizePopover } from "~/components/courses/course-card-customize-popover";
import { BannerBadge, CourseHeader } from "~/components/courses/course-header";
import { StudentCourseMaterials } from "~/components/courses/student-course-materials";
import { useCourseCardPreferences } from "~/hooks/use-course-card-preferences";
import {
  getCourseDisplayName,
  resolveCourseAccentColor,
} from "~/lib/courses/course-card-preferences";

interface Props {
  course: CourseDetail;
  topics: CourseTopic[];
  tas?: CourseTA[];
  /** This course in AI Tutor, or null where AI Tutor isn't available to the viewer. */
  aiTutorUrl?: string | null;
}

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

function StudyCard({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: typeof IconMessage;
  title: string;
  description: string;
  action: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-[var(--course-border)] bg-card p-4 shadow-xs">
      <div className="flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-md bg-[var(--course-muted)] text-[var(--course-accent)]">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <p className="flex-1 text-sm text-muted-foreground">{description}</p>
      <div>{action}</div>
    </div>
  );
}

/**
 * A student's course home (#1962, Canvas-style since #2105): what the course is,
 * the two ways to study it (course chat, then AI Tutor), its topics, and who
 * teaches it. Files are listed only where the course shares them (#2002).
 */
export function CourseDetailStudentView({ course, topics, tas = [], aiTutorUrl }: Props) {
  // #1841: every instructor of record, falling back to the single legacy field.
  const displayInstructors = resolveDisplayInstructors(course);

  const { getCoursePreference, setCoursePreference } = useCourseCardPreferences();
  const cardPreference = getCoursePreference(course.id);
  const accentColor = resolveCourseAccentColor(course.id, cardPreference);
  const displayName = getCourseDisplayName(course.name, cardPreference);

  const hasAi =
    course.hasAiConfig ?? courseHasAiConfig(course.responseStyleTags ?? [], course.aiInstructions);

  return (
    <div className="flex flex-col gap-6" style={courseThemeVars(accentColor)}>
      <CourseHeader
        code={course.code}
        term={course.term}
        year={course.year}
        name={displayName}
        department={course.department}
        accentColor={accentColor}
        badges={<BannerBadge>Enrolled</BannerBadge>}
        topics={topics.map((t) => t.name)}
        menu={
          <CourseCardCustomizePopover
            courseName={course.name}
            courseCode={course.code}
            preference={cardPreference}
            onApply={(update) => setCoursePreference(course.id, update)}
          />
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <StudyCard
              icon={IconMessage}
              title="Course Chat"
              description="Ask questions and get answers based on what your instructor has shared."
              action={
                <Button asChild size="sm">
                  <Link to={`/chat?courseId=${encodeURIComponent(course.id)}`}>
                    Chat about this course
                  </Link>
                </Button>
              }
            />
            {aiTutorUrl && (
              <StudyCard
                icon={IconMessageChatbot}
                title="AI Tutor"
                description="Work through guided lessons and practice on this course's topics."
                action={
                  <Button asChild size="sm" variant="outline">
                    <a href={aiTutorUrl}>Open AI Tutor</a>
                  </Button>
                }
              />
            )}
          </div>

          <Section title="About this course">
            <p className="text-sm leading-relaxed text-foreground">
              {course.description || (
                <span className="text-muted-foreground">
                  Your instructor hasn't added a description yet.
                </span>
              )}
            </p>
          </Section>

          {course.studentFilesVisible && (
            <StudentCourseMaterials key={course.id} courseId={course.id} />
          )}
        </div>

        <aside className="flex flex-col gap-6">
          <Section title="Teaching team">
            {displayInstructors.length > 0 ? (
              <CourseInstructorsPanel instructors={displayInstructors} />
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

          {hasAi && (course.responseStyleTags ?? []).length > 0 && (
            <Section title="How the AI answers">
              <CourseResponseStyleSummary tagIds={course.responseStyleTags ?? []} />
            </Section>
          )}
        </aside>
      </div>
    </div>
  );
}

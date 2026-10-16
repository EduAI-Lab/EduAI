import { IconMessage } from "@tabler/icons-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  Card,
  CardContent,
  CourseHeroCard,
  DetailPageScaffold,
  StatusBadge,
  Avatar,
  courseThemeVars,
  Button,
} from "@eduai/ui";
import { termLabel } from "@eduai/ui";
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
import { ScrollReveal } from "~/components/motion/scroll-reveal";
import { useCourseCardPreferences } from "~/hooks/use-course-card-preferences";
import {
  getCourseDisplayName,
  resolveCourseAccentColor,
} from "~/lib/courses/course-card-preferences";

interface Props {
  course: CourseDetail;
  topics: CourseTopic[];
  tas?: CourseTA[];
}

/**
 * The page's one action sits on the hero in solid white so it reads apart from
 * the glass topic chips beside it. Every course accent is chosen to carry a
 * white label (`COURSE_COLOR_PRESETS`), so the accent reads as a label on white.
 */
const CHAT_ACTION_CLASS =
  "bg-white text-[var(--course-accent)] shadow-sm hover:bg-white/90 hover:text-[var(--course-accent)]";

function ThemedPanel({ children }: { children: ReactNode }) {
  return (
    <Card className="border-[var(--course-border)] bg-[var(--course-surface)] border-l-[3px] border-l-[var(--course-accent)] shadow-sm">
      {children}
    </Card>
  );
}

/**
 * A student's course page (#1962). Students never see the course's files —
 * course chat is their way into a course — so there is no Materials tab and no
 * material count, and the page's main action opens course chat on this course.
 */
export function CourseDetailStudentView({ course, topics, tas = [] }: Props) {
  // #1841: every instructor of record, falling back to the single legacy field.
  const displayInstructors = resolveDisplayInstructors(course);

  const { getCoursePreference, setCoursePreference } = useCourseCardPreferences();
  const cardPreference = getCoursePreference(course.id);
  const accentColor = resolveCourseAccentColor(course.id, cardPreference);
  const displayName = getCourseDisplayName(course.name, cardPreference);

  const hasAi =
    course.hasAiConfig ?? courseHasAiConfig(course.responseStyleTags ?? [], course.aiInstructions);

  // Top-right hero badges: enrollment + AI status
  const topRightBadges: string[] = ["Enrolled", ...(hasAi ? ["AI-enabled"] : [])];

  return (
    <DetailPageScaffold
      style={courseThemeVars(accentColor)}
      hero={
        <CourseHeroCard
          code={course.code}
          term={course.term}
          year={course.year}
          name={displayName}
          description={course.description}
          accentColor={accentColor}
          topRightBadges={topRightBadges}
          topics={topics.map((t) => t.name)}
          headerAction={
            <CourseCardCustomizePopover
              courseName={course.name}
              courseCode={course.code}
              preference={cardPreference}
              onApply={(update) => setCoursePreference(course.id, update)}
            />
          }
          topicsAction={
            <Button asChild size="sm" className={CHAT_ACTION_CLASS}>
              <Link to={`/chat?courseId=${encodeURIComponent(course.id)}`}>
                <IconMessage className="size-4" aria-hidden="true" />
                Chat about this course
              </Link>
            </Button>
          }
        />
      }
    >
      {/* B3: Enriched info card — always show; B1: no empty gaps */}
      <div className="grid gap-4 mb-4 grid-cols-1 sm:grid-cols-2">
        <ScrollReveal index={1}>
          <ThemedPanel>
            <CardContent className="pt-5 pb-5 flex flex-col gap-4">
              <p className="text-[13px] font-semibold text-foreground">Course information</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                    Code
                  </p>
                  <p className="text-sm text-foreground">{course.code}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                    Term
                  </p>
                  <p className="text-sm text-foreground">{termLabel(course.term, course.year)}</p>
                </div>
                {course.department && (
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                      Course Code
                    </p>
                    <p className="text-sm text-foreground">{course.department}</p>
                  </div>
                )}
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                    Status
                  </p>
                  <StatusBadge active={course.isActive} />
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                    AI assistance
                  </p>
                  {hasAi ? (
                    (course.responseStyleTags ?? []).length > 0 ? (
                      <CourseResponseStyleSummary tagIds={course.responseStyleTags ?? []} />
                    ) : (
                      <p className="text-sm text-foreground">Enabled</p>
                    )
                  ) : (
                    <p className="text-sm text-foreground">Not configured</p>
                  )}
                </div>
              </div>
            </CardContent>
          </ThemedPanel>
        </ScrollReveal>

        {/* Instructor + TAs — visible to students so they know their teaching team */}
        {displayInstructors.length > 0 ? (
          <ScrollReveal index={2}>
            <ThemedPanel>
              <CardContent className="pt-5 pb-5 flex flex-col gap-4">
                <CourseInstructorsPanel instructors={displayInstructors} />
                <div>
                  <p className="text-xs font-semibold tracking-wide text-foreground mb-2">
                    Teaching assistants
                  </p>
                  {tas.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {tas.map((ta) => (
                        <div key={ta.id} className="flex items-center gap-1.5">
                          <Avatar name={ta.user.name} size={22} radius={5} />
                          <span className="text-xs text-foreground">{ta.user.name}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-muted-foreground">No TAs assigned</span>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </ThemedPanel>
          </ScrollReveal>
        ) : (
          <ScrollReveal index={2}>
            <ThemedPanel>
              <CardContent className="pt-5 pb-5 flex flex-0 flex-col gap-2">
                <p className="text-sm font-semibold text-foreground">Instructor</p>
                <p className="text-xs text-muted-foreground">No professor assigned</p>
                <p className="text-xs font-semibold tracking-wide text-foreground mt-2 mb-1">
                  Teaching assistants
                </p>
                {tas.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {tas.map((ta) => (
                      <div key={ta.id} className="flex items-center gap-1.5">
                        <Avatar name={ta.user.name} size={22} radius={5} />
                        <span className="text-xs text-foreground">{ta.user.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">No TAs assigned</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </ThemedPanel>
          </ScrollReveal>
        )}
      </div>
    </DetailPageScaffold>
  );
}

import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { IconBooks, IconChevronRight } from '@tabler/icons-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  MeterBar,
} from '@eduai/ui';
import { ProgressBarFromData } from '../components/ProgressBar';
import type { Course, Progress } from '../lib/types';
import type { Route } from './+types/student';
import { AtRoleBanner } from '../components/rbac/AtRoleBanner';
import { useLocalUser } from '../hooks/useLocalUser';
import api from '~/lib/api';
import { requireClientUser } from '~/lib/client-auth';
import { useShellBreadcrumbs } from '~/components/layout/ShellBreadcrumbContext';
import { RoleDashboard } from '~/components/dashboard/RoleDashboard';
import { buildDashboardStats } from '~/lib/dashboard-stats';

export async function clientLoader(_: Route.ClientLoaderArgs) {
  await requireClientUser(['STUDENT', 'TA']);
  const courses = (await api.listCourses()) as Course[];
  return { courses };
}

/** Time-of-day greeting for the page heading — mirrors EduAI Core's dashboard
 *  hero (`apps/core/app/routes/dashboard.tsx`) so the two apps read as one
 *  product rather than two differently-voiced tools. */
function timeOfDayGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** First name only, same "Dr. First Last" edge case Core's greeting handles. */
function firstNameOf(name: string | undefined): string | null {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (parts.length === 0) return null;
  return parts.length === 3 && parts[0]!.endsWith('.') ? parts[1]! : parts[0]!;
}

/**
 * The most useful "pick this back up" candidate: the enrolled course with the
 * highest completion percentage that isn't finished yet. We only have
 * course-level progress from `api.listCourses()` — no last-viewed timestamp —
 * so this is a progress-based heuristic, not a recency one. Copy is worded
 * to match ("Continue learning" / "In progress", never "recently viewed").
 */
function findResumeCourse(courses: Course[]): Course | null {
  const inProgress = courses.filter((course) => {
    const progress = course.progress;
    return Boolean(progress) && progress!.completed > 0 && progress!.completed < progress!.total;
  });
  if (inProgress.length === 0) return null;
  return [...inProgress].sort(
    (a, b) => (b.progress?.percentage ?? 0) - (a.progress?.percentage ?? 0),
  )[0]!;
}

type ResumeCourseCardProps = {
  title: string;
  progress: Progress;
  onContinue: () => void;
};

/** Prominent "continue where you left off" callout — the single highlighted
 *  affordance on the page, so it reuses `StatCard`'s subtle primary-tinted
 *  gradient (the DS's own documented "this card matters most" signature)
 *  instead of a one-off accent treatment. */
function ResumeCourseCard({ title, progress, onContinue }: ResumeCourseCardProps) {
  return (
    <Card
      style={{
        background: 'linear-gradient(to bottom, oklch(from var(--primary) l c h / 0.05), var(--card))',
      }}
    >
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2">
          <Badge variant="secondary" size="sm">
            In progress
          </Badge>
          <h3 className="truncate text-lg font-semibold text-foreground">{title}</h3>
          <div className="max-w-xs">
            <MeterBar label="Your progress" value={progress.completed} total={progress.total} showCount />
          </div>
        </div>
        <Button type="button" variant="primary" className="shrink-0" onClick={onContinue}>
          Continue learning
        </Button>
      </CardContent>
    </Card>
  );
}

type StudentCourseCardProps = {
  course: Course;
  onOpen: () => void;
  tourId?: string;
  tourRoute?: string;
};

/** One tile in the course grid — the whole card is the click target (a real
 *  button role + keyboard handling, not just an `onClick` div) so mouse,
 *  keyboard, and screen-reader users all get the same affordance the old
 *  `<button>`-wrapped card gave them. */
function StudentCourseCard({ course, onOpen, tourId, tourRoute }: StudentCourseCardProps) {
  return (
    <Card
      hoverable
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen();
        }
      }}
      className="group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      data-tour={tourId}
      data-tour-route={tourRoute}
    >
      <CardHeader>
        <CardTitle className="line-clamp-2 transition-colors group-hover:text-primary">
          {course.title}
        </CardTitle>
        {course.description ? (
          <CardDescription className="line-clamp-2">{course.description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        {course.progress && course.progress.total > 0 ? (
          <ProgressBarFromData progress={course.progress} size="sm" showLabel />
        ) : (
          <p className="text-sm text-muted-foreground">Not started yet</p>
        )}
      </CardContent>
      <CardFooter>
        <span className="inline-flex items-center gap-1 text-sm font-medium text-primary-text">
          View course
          <IconChevronRight size={15} aria-hidden="true" />
        </span>
      </CardFooter>
    </Card>
  );
}

export default function StudentHome({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { user } = useLocalUser();
  const courseList = useMemo(() => loaderData.courses ?? [], [loaderData.courses]);
  // Always the student stat shape here: TA is allowed on this route to preview
  // the student experience, but courseList is the enrolled/progress list, not
  // taught courses, so it must not be scored with instructor-shell stats.
  const stats = useMemo(
    () => buildDashboardStats('STUDENT', { courses: courseList }),
    [courseList],
  );
  const resumeCourse = useMemo(() => findResumeCourse(courseList), [courseList]);

  useShellBreadcrumbs([{ label: 'Courses' }]);

  const firstName = firstNameOf(user?.name);
  const heading = firstName ? `${timeOfDayGreeting()}, ${firstName}.` : 'Courses';
  const dateStr = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const subheading = `${dateStr} · Continue where you left off or explore new learning materials.`;

  return (
    <RoleDashboard
      banner={user ? <AtRoleBanner role={user.role} variant="student" /> : null}
      heading={heading}
      subheading={subheading}
      headingTourId="student-dashboard-header"
      stats={stats}
    >
      {resumeCourse?.progress ? (
        <ResumeCourseCard
          title={resumeCourse.title}
          progress={resumeCourse.progress}
          onContinue={() => navigate(`/student/courses/${resumeCourse.id}`)}
        />
      ) : null}

      {courseList.length === 0 ? (
        <Card className="mx-auto max-w-lg">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
              <IconBooks size={22} aria-hidden="true" />
            </div>
            <div className="space-y-1.5">
              <h3 className="text-lg font-semibold text-foreground">No courses yet</h3>
              <p className="text-sm text-muted-foreground">
                You are not enrolled in any published courses yet. Enrollments sync automatically
                from Core when you sign in.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {courseList.map((course) => (
            <StudentCourseCard
              key={course.id}
              course={course}
              onOpen={() => navigate(`/student/courses/${course.id}`)}
              tourId={course.id === courseList[0]?.id ? 'student-course-card-first' : undefined}
              tourRoute={
                course.id === courseList[0]?.id ? `/student/courses/${course.id}` : undefined
              }
            />
          ))}
        </div>
      )}
    </RoleDashboard>
  );
}

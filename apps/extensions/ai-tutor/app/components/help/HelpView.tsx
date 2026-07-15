/**
 * In-app user guide for AI Tutor (issue #764 — Core/QM parity; both already
 * ship a HelpView at /help). Static, role-aware reference content: a
 * jump-link rail on the left, stacked topic cards on the right — same shape
 * as Core's `apps/core/app/components/help/help-view.tsx`, built on
 * `@eduai/ui`'s `Card` primitives instead of hand-rolled divs.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import {
  IconRobot,
  IconBooks,
  IconCommand,
  IconChalkboard,
  IconShieldLock,
  type Icon,
} from '@tabler/icons-react';
import { Badge, Card, CardContent, CardHeader, CardTitle, PageHeading } from '@eduai/ui';

import { getRoleViewLabel } from '~/lib/rbac';
import { routeForRole } from '~/lib/role-routing';
import type { Role } from '~/lib/types';

type HelpTopic = {
  id: string;
  title: string;
  icon: Icon;
  /** Roles allowed to see this topic; omit to show it to everyone. */
  roles?: Role[];
  points: ReactNode[];
};

/** Teaching-shell roles — instructors, TAs, unit admins, and admins (admin ⊇ instructor). */
const STAFF: Role[] = ['INSTRUCTOR', 'UNIT_ADMIN', 'TA', 'ADMIN'];
const ADMINS: Role[] = ['ADMIN'];

const LINK = 'text-primary-text hover:underline';
const KBD = 'rounded border bg-muted px-1.5 py-0.5 text-xs font-medium';

function buildTopics(role: Role | undefined): HelpTopic[] {
  const coursesHref = role ? routeForRole(role) : '/student';

  return [
    {
      id: 'chat-modes',
      title: 'Using the AI tutor',
      icon: IconRobot,
      points: [
        "Open any activity inside a lesson to start chatting with your AI study buddy — every conversation stays scoped to that activity.",
        <>
          Pick from up to three modes: <strong>Teach me</strong> explains the topic and answers
          questions, <strong>Guide me</strong> gives hints so you work toward the answer yourself,
          and a third mode your instructor can turn on (and rename) for activity-specific prompts.
        </>,
        <>
          The first time you open an activity, you&rsquo;ll choose a knowledge level (Beginner,
          Intermediate, or Advanced) and add your own API key for the model provider — a one-time
          setup you can revisit any time from &ldquo;Change&rdquo; next to your level.
        </>,
        'Every conversation is saved automatically. Reopen a past chat from the history panel above the message box.',
      ],
    },
    {
      id: 'navigation',
      title: 'Finding your way around',
      icon: IconBooks,
      points: [
        <>
          Content is organized <strong>courses → modules → lessons → activities</strong>. Open{' '}
          <Link to={coursesHref} className={LINK}>
            Courses
          </Link>{' '}
          from the sidebar to start browsing.
        </>,
        "The course name in the breadcrumb doubles as a switcher — click it to jump to a different course without losing your place.",
        'Breadcrumbs always show your trail (course, module, lesson) so you can jump back up a level in one click.',
      ],
    },
    {
      id: 'suite',
      title: 'Command palette & suite tools',
      icon: IconCommand,
      points: [
        <>
          Press <kbd className={KBD}>⌘K</kbd> (or <kbd className={KBD}>Ctrl K</kbd> on
          Windows/Linux) anywhere to open the command palette — jump to any page or course by
          typing, no menu-hunting required.
        </>,
        'The app-grid button in the sidebar switches you to another EduAI app you have access to, without logging in again.',
        'The sun/moon toggle in the header switches between light and dark themes.',
        '"Report a bug" in the header captures a screenshot and your console/network logs alongside a description, so issues are easy to triage.',
        'Look for the sparkle "Take Tour" button in the header while browsing your courses for a guided walkthrough — open it any time you want a refresher.',
      ],
    },
    {
      id: 'teaching',
      title: 'For instructors, TAs, and unit admins',
      icon: IconChalkboard,
      roles: STAFF,
      points: [
        <>
          Manage modules, lessons, and activities from your{' '}
          <Link to="/instructor" className={LINK}>
            Courses
          </Link>{' '}
          view.
        </>,
        "Per activity, toggle which chat modes students see — Teach me, Guide me, and a custom mode with your own prompt and tab title.",
        'TAs share the same teaching view, with a slightly narrower set of course tabs.',
      ],
    },
    {
      id: 'admin',
      title: 'For admins',
      icon: IconShieldLock,
      roles: ADMINS,
      points: [
        <>
          Triage submitted issues in{' '}
          <Link to="/admin" className={LINK}>
            Bug Reports
          </Link>
          .
        </>,
        <>
          Configure the AI Tutor loop policy and EduAI API integration in{' '}
          <Link to="/settings" className={LINK}>
            Settings
          </Link>
          .
        </>,
      ],
    },
  ];
}

export function HelpView({ role }: { role?: Role }) {
  const topics = buildTopics(role).filter((t) => !t.roles || (role && t.roles.includes(role)));

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeading
          heading="Help & guide"
          subheading="How to get around AI Tutor and make the most of it."
        />
        {role ? <Badge variant="outline">{getRoleViewLabel(role)}</Badge> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[220px_1fr] lg:items-start">
        {/* Jump-link rail */}
        <nav className="hidden lg:block lg:sticky lg:top-20" aria-label="Guide sections">
          <ul className="flex flex-col gap-1">
            {topics.map((t) => (
              <li key={t.id}>
                <a
                  href={`#${t.id}`}
                  className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <t.icon className="size-4 shrink-0" aria-hidden />
                  {t.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Topic cards */}
        <div className="flex flex-col gap-4">
          {topics.map((t) => (
            <Card key={t.id} id={t.id} className="scroll-mt-20">
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <t.icon className="size-5 text-primary-text" aria-hidden />
                  </div>
                  <CardTitle>{t.title}</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <ul className="flex flex-col gap-2.5">
                  {t.points.map((point, i) => (
                    <li key={i} className="flex gap-2.5 text-sm leading-relaxed text-foreground">
                      <span
                        className="mt-2 size-1.5 shrink-0 rounded-full bg-primary/60"
                        aria-hidden
                      />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}

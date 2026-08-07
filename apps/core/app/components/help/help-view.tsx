/**
 * In-app user guide (issue #764 — QuestionMaker ↔ Core parity; QM ships a HelpPage
 * at /help, Core had none). A static, role-aware written guide: a jump-link rail
 * on the left, stacked topic cards on the right. Admin-only topics are filtered
 * out for students/staff so the guide reads as complete for whoever opens it.
 */
import { Link } from "react-router";
import {
  IconRocket,
  IconBooks,
  IconRobot,
  IconFileText,
  IconShieldLock,
  IconCommand,
  type Icon,
} from "@tabler/icons-react";
import { PageHeading } from "@eduai/ui";

type HelpTopic = {
  id: string;
  title: string;
  icon: Icon;
  /** Roles allowed to see this topic; omit to show it to everyone. */
  roles?: string[];
  points: React.ReactNode[];
};

const STAFF = ["ADMIN", "UNIT_ADMIN", "INSTRUCTOR"];
const ADMINS = ["ADMIN", "UNIT_ADMIN"];

const TOPICS: HelpTopic[] = [
  {
    id: "getting-started",
    title: "Getting started",
    icon: IconRocket,
    points: [
      "Your dashboard is home base — it greets you, surfaces quick stats, and lists your courses and recent conversations.",
      "The left sidebar is your main navigation. Collapse it with the toggle in the header when you want more room.",
      "Switch between light and dark themes with the sun/moon button in the top-right of every page.",
      "Use the app-grid (waffle) button at the bottom of the sidebar to jump between EduAI apps you have access to.",
    ],
  },
  {
    id: "command-palette",
    title: "Command palette",
    icon: IconCommand,
    points: [
      <>
        Press <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-medium">⌘K</kbd>{" "}
        (or <kbd className="rounded border bg-muted px-1.5 py-0.5 text-xs font-medium">Ctrl K</kbd>{" "}
        on Windows/Linux) anywhere to open the command palette.
      </>,
      "Start typing to jump straight to any page you have access to — no clicking through menus.",
      "Type a course code or name to hop directly to that course.",
    ],
  },
  {
    id: "courses",
    title: "Courses",
    icon: IconBooks,
    points: [
      <>
        Open <Link to="/courses" className="text-primary-text hover:underline">Courses</Link> to
        browse everything you're enrolled in or teaching.
      </>,
      "Inside a course, use the tabs to move between overview, materials, topics, and people.",
      "The course name in the breadcrumb is a switcher — click it to jump to another course without leaving the page you're on.",
    ],
  },
  {
    id: "chat",
    title: "AI chatbot",
    icon: IconRobot,
    points: [
      <>
        Head to <Link to="/chat" className="text-primary-text hover:underline">Chatbot</Link> to ask
        questions grounded in your course materials.
      </>,
      "Course-scoped chats answer from that course's uploaded materials; general chats aren't tied to a course.",
      "Your conversations are saved — reopen any of them from the dashboard or the chat history.",
    ],
  },
  {
    id: "materials",
    title: "Course materials",
    icon: IconFileText,
    roles: STAFF,
    points: [
      "Upload materials on a course's Materials tab. Each file is processed so the chatbot can search and cite it.",
      "Watch the status chip: Processing means the file is still being prepared, Ready means it's live for chat, Failed means it needs a re-upload.",
      "Control per-material visibility and scheduled availability so students only see what you've released.",
    ],
  },
  {
    id: "administration",
    title: "Administration",
    icon: IconShieldLock,
    roles: ADMINS,
    points: [
      <>
        Manage platform accounts under{" "}
        <Link to="/admin/users" className="text-primary-text hover:underline">User Management</Link>{" "}
        and invite new people from Invitations.
      </>,
      "Configure AI providers and models in AI Management to control which models power chat and embeddings.",
      "Platform policies gate features across roles — review them before turning capabilities on or off.",
    ],
  },
];

export function HelpView({ role }: { role?: string }) {
  const topics = TOPICS.filter((t) => !t.roles || (role && t.roles.includes(role)));

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeading
          heading="Help & guide"
          subheading="How to get around EduAI and make the most of it."
        />
        <Link
          to="/dashboard?tour=1"
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          <IconRocket className="size-4" aria-hidden />
          Replay guided tour
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-[200px_1fr] lg:items-start">
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
            <section
              key={t.id}
              id={t.id}
              className="scroll-mt-20 rounded-[var(--radius-xl)] border border-border bg-card p-6 shadow-[var(--shadow-2xs)]"
            >
              <div className="mb-3 flex items-center gap-2.5">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                  <t.icon className="size-5 text-primary-text" aria-hidden />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{t.title}</h3>
              </div>
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
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

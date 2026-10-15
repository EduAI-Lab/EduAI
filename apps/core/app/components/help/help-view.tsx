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
  IconCpu,
  IconEye,
  IconMessages,
  IconProgressCheck,
  IconToggleRight,
  type Icon,
} from "@tabler/icons-react";
import { Button, PageHeading, useTour } from "@eduai/ui";

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
const PLATFORM_ADMINS = ["ADMIN"];

const TOPICS: HelpTopic[] = [
  {
    id: "getting-started",
    title: "Getting started",
    icon: IconRocket,
    points: [
      "Your dashboard is home base — it greets you, surfaces quick stats, and lists your courses and recent conversations.",
      "The left sidebar is your main navigation. Collapse it with the toggle in the header when you want more room.",
      "Switch between light and dark themes with the sun/moon button in the top-right of every page.",
      "Click the (?) button in the top-right corner of any page for help with that page, or to start the guided tour.",
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
        Open{" "}
        <Link to="/courses" className="text-primary-text hover:underline">
          Courses
        </Link>{" "}
        to browse everything you're enrolled in or teaching.
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
        Head to{" "}
        <Link to="/chat" className="text-primary-text hover:underline">
          Chatbot
        </Link>{" "}
        to ask questions grounded in your course materials.
      </>,
      "Course Chat conversations are tied to a selected course and use that course's uploaded materials.",
      "Your conversations are saved — reopen any of them from the dashboard or the chat history.",
    ],
  },
  {
    id: "chat-scope",
    title: "Course chat vs. general chat",
    icon: IconMessages,
    points: [
      "Course Chat is scoped to one course: it searches only that course's uploaded materials and cites them in its answers.",
      "Switching course in the composer starts a separate conversation, so answers never mix material from two courses.",
      "Students only get answers from materials their instructor has made visible to them.",
      "The admin chatbot and the instructors' course assistant are different tools: they help with operational tasks such as enrollments, users and topics, and do not read course materials.",
    ],
  },
  {
    id: "materials",
    title: "Course materials",
    icon: IconFileText,
    roles: STAFF,
    points: [
      "Upload materials on a course's Materials tab. Each file is processed so the chatbot can search and cite it.",
      "Control per-material visibility and scheduled availability so students only see what you've released.",
    ],
  },
  {
    id: "material-status",
    title: "Material status",
    icon: IconProgressCheck,
    roles: STAFF,
    points: [
      <>
        <strong>Processing</strong>: the file is being read and indexed. Large files can take a few
        minutes.
      </>,
      <>
        <strong>Embedded</strong>: the file is ready. The course chatbot can search it and cite it
        in answers.
      </>,
      <>
        <strong>Failed</strong>: the file couldn't be indexed. The row explains why: a duplicate of
        a file already in the course, a file that couldn't be read, or an indexing error. Retry when
        the row offers it, otherwise upload a fixed copy.
      </>,
    ],
  },
  {
    id: "publishing",
    title: "Publishing and visibility",
    icon: IconEye,
    roles: STAFF,
    points: [
      "A new course starts as a draft. Only course staff and administrators can open a draft, and self-enrollment links won't let students join it.",
      "Publish the course from its Overview tab when it's ready. Unpublishing removes student access again without deleting anything.",
      "Inside a published course, each material can be hidden from students or scheduled to appear on a date. Hidden and not-yet-available materials are also left out of students' chat answers.",
      "Instructors and TAs always see every material, whatever its visibility.",
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
        <Link to="/admin/users" className="text-primary-text hover:underline">
          User Management
        </Link>{" "}
        and invite new people from Invitations.
      </>,
      "Configure AI providers and models in AI Management to control which models power chat and embeddings.",
      "Platform policies gate features across roles — review them before turning capabilities on or off.",
    ],
  },
  {
    id: "ai-models",
    title: "AI providers and models",
    icon: IconCpu,
    roles: PLATFORM_ADMINS,
    points: [
      "A provider is a service EduAI connects to for AI, such as a cloud API or a campus-hosted server. It holds the endpoint and API key.",
      "A model belongs to one provider. Chat models appear in the chat model picker; embedding models turn course materials into searchable text.",
      "Only active models on an active provider are offered. Turning a provider off hides all of its models at once.",
      "Campus-hosted providers can sync their model list automatically instead of adding models one by one.",
      "Auto routing and Assist use the models you assign to them on the Models tab.",
    ],
  },
  {
    id: "platform-policies",
    title: "Platform policies",
    icon: IconToggleRight,
    roles: PLATFORM_ADMINS,
    points: [
      "Policies are switches on the admin Settings page that decide what each role (instructors, students, TAs, unit admins) may do.",
      "A switch applies to every course on the platform and takes effect as soon as you flip it. There is no save step.",
      "Controls that a policy turns off stay visible but disabled, with a tooltip explaining why, so people know the feature exists.",
      "Check who relies on a capability before turning it off.",
    ],
  },
];

/** Topics a TA can use: they manage materials in their courses (AUTH-08) but aren't platform staff. */
const TA_TOPICS = new Set(["materials", "material-status"]);
/** A platform STUDENT with an INSTRUCTOR enrollment gets the staff course view, so its topics too. */
const COURSE_INSTRUCTOR_TOPICS = new Set([...TA_TOPICS, "publishing"]);

export function HelpView({
  role,
  isTA = false,
  isCourseInstructor = false,
}: {
  role?: string;
  isTA?: boolean;
  isCourseInstructor?: boolean;
}) {
  const { startTour } = useTour();
  // TAs are platform STUDENTs (Enrollment.role carries TA), so their topics
  // come from TA_TOPICS rather than session.user.role.
  const topics = TOPICS.filter((t) => {
    if (!t.roles) return true;
    if (role && t.roles.includes(role)) return true;
    if (isCourseInstructor && COURSE_INSTRUCTOR_TOPICS.has(t.id)) return true;
    return isTA && TA_TOPICS.has(t.id);
  });

  return (
    <div className="flex flex-col gap-6 px-4 lg:px-6 pt-6 pb-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeading
          heading="Help & guide"
          subheading="How to get around EduAI and make the most of it."
        />
        <Button type="button" variant="outline" size="sm" onClick={() => startTour("dashboard")}>
          <IconRocket className="size-4" aria-hidden />
          Replay guided tour
        </Button>
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

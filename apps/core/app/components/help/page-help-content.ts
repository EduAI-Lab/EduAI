/**
 * Core's page-level help copy for the header (?) button (#1754). One entry per
 * in-app screen; `helpHref` deep-links into the matching `/help` section (see
 * `help-view.tsx` topic ids). Kept as plain data so the wording can be edited
 * without touching the shell, and so tests can assert every route resolves.
 */
import { resolvePageHelp, type PageHelpContent, type PageHelpRoute } from "@eduai/ui";

const STAFF_ROLES = new Set(["ADMIN", "UNIT_ADMIN", "INSTRUCTOR"]);

const FALLBACK: PageHelpContent = {
  title: "Getting around EduAI",
  summary:
    "Use the sidebar to move between pages, and the search button (⌘K / Ctrl K) to jump anywhere.",
  tips: [
    "Your dashboard is home base — it lists your courses and recent conversations.",
    "The full help guide walks through every part of EduAI.",
  ],
  helpHref: "/help#getting-started",
};

function chatHelp(isStaff: boolean): PageHelpContent {
  return {
    title: "Course chat",
    summary:
      "Ask questions and get answers grounded in a course's uploaded materials, with citations back to the source.",
    tips: [
      "Pick a course first — the chatbot only searches that course's materials.",
      "Your conversations are saved. Reopen one from the history list or your dashboard.",
      // #1962: students cannot open a course's files, so only staff can check one.
      isStaff
        ? "If an answer looks off, open the cited source to check the original material."
        : "If an answer looks off, ask a follow-up or check it with your instructor.",
    ],
    helpHref: "/help#chat",
  };
}

function routes(isStaff: boolean): PageHelpRoute[] {
  return [
    {
      match: "/dashboard",
      content: {
        title: "Dashboard",
        summary: "Your home base: key stats, your courses and your recent conversations.",
        tips: [
          "Click a course card to open it, or a conversation to pick up where you left off.",
          "Take the tour below for a 30-second walkthrough of the essentials.",
        ],
        helpHref: "/help#getting-started",
      },
    },
    {
      match: "/courses",
      content: {
        title: "Courses",
        summary: isStaff
          ? "Every course you teach or manage. Open one to manage its materials, topics and people."
          : "Every course you're enrolled in. Open one to see who teaches it and start a course chat.",
        tips: [
          "Search or filter the list to find a course quickly.",
          "Inside a course, the course name in the breadcrumb switches between courses.",
        ],
        helpHref: "/help#courses",
      },
    },
    {
      match: /^\/courses\/[^/]+$/,
      content: isStaff
        ? {
            title: "Course workspace",
            summary:
              "Manage one course: its materials, topics, enrollments and settings, each on its own tab.",
            tips: [
              "Materials: upload files so the chatbot can answer from them. Embedded means a file is live for chat; Failed means it needs another try.",
              "Topics: group materials into the concepts your course covers.",
              "Enrollments: add students one at a time, by CSV, or with a self-enrollment link.",
            ],
            helpHref: "/help#materials",
          }
        : {
            title: "Your course",
            // #1962: course chat is a student's way into a course; there are no files to browse.
            // Help keys off the platform role, so a TA (a STUDENT user) reads this on
            // the courses they assist too, where the page has no chat button and the
            // banner also lists suggested topics. Every line has to hold for both.
            summary:
              "See what this course covers and who teaches it, then ask about it in course chat.",
            tips: [
              "Ask about this course in course chat. If you're a student here, Chat about this course on the banner opens it with the course already selected.",
              "The topics on the banner are the concepts this course covers.",
            ],
            helpHref: "/help#courses",
          },
    },
    { match: /^\/chat(\/|$)/, content: chatHelp(isStaff) },
    { match: "/instructor/chat", content: chatHelp(isStaff) },
    {
      match: /^\/units\/[^/]+\/chats$/,
      content: {
        title: "Unit chats",
        summary: "Conversations across every course in this unit, for unit-level oversight.",
        tips: ["Open a conversation to read it in full."],
        helpHref: "/help#chat",
      },
    },
    {
      match: "/settings",
      content: {
        title: "Account settings",
        summary: "Your profile, appearance and accessibility preferences.",
        tips: [
          "Theme and accessibility choices carry across every EduAI app.",
          "You can also switch light and dark mode from the header on any page.",
        ],
        helpHref: "/help#getting-started",
      },
    },
    {
      match: "/status",
      content: {
        title: "AI service status",
        summary:
          "Whether the cloud and UBC-hosted AI services are online, and their recent history.",
        tips: ["The status chips in the header show the same information on every page."],
        helpHref: "/help#getting-started",
      },
    },
    {
      match: "/help",
      content: {
        title: "Help & guide",
        summary: "The full written guide to EduAI. Use the section list to jump to a topic.",
        tips: ["The (?) button on every page shows help for just that page."],
        helpHref: "/help#getting-started",
      },
    },
    {
      match: "/admin/users",
      content: {
        title: "User management",
        summary: "Every account on the platform: roles, status and access.",
        tips: ["Invite new people from the Invitations page rather than creating accounts here."],
        helpHref: "/help#administration",
      },
    },
    {
      match: /^\/(admin|unit-admin)\/invitations$/,
      content: {
        title: "Invitations",
        summary: "Invite people to EduAI with the right role, and track invitations you've sent.",
        tips: ["Pending invitations expire. Resend one if the person never accepted it."],
        helpHref: "/help#administration",
      },
    },
    {
      match: "/admin/ai-models",
      content: {
        title: "AI models",
        summary: "The AI providers and models that power chat and embeddings.",
        tips: ["Add a provider first, then choose which of its models power chat and embeddings."],
        helpHref: "/help#administration",
      },
    },
    {
      match: "/admin/settings",
      content: {
        title: "Platform settings",
        summary: "Policies that turn features on or off for each role. Changes take effect live.",
        tips: ["Review who a policy affects before switching it — it applies platform-wide."],
        helpHref: "/help#administration",
      },
    },
    {
      match: "/admin/chat",
      content: {
        title: "Admin chatbot",
        summary: "A general-purpose assistant for administrators, not tied to any one course.",
        helpHref: "/help#administration",
      },
    },
    {
      match: "/admin/bug-reports",
      content: {
        title: "Bug reports",
        summary: "Reports submitted from every EduAI app, in one place.",
        tips: ["Open a report to see its screenshot, console logs and page details."],
        helpHref: "/help#administration",
      },
    },
    {
      match: "/admin/logs",
      content: {
        title: "Audit logs",
        summary: "A record of important actions across the platform.",
        tips: ["Use the filters to narrow the list by category or date range."],
        helpHref: "/help#administration",
      },
    },
    {
      match: "/admin/cron-jobs",
      content: {
        title: "Scheduled jobs",
        summary: "Background jobs EduAI runs on a schedule, and when they last ran.",
        helpHref: "/help#administration",
      },
    },
    {
      match: "/admin/api-access",
      content: {
        title: "API access",
        summary:
          "Give someone who isn't an admin time-limited use of an API key for the campus models, see their use today, or revoke it.",
        helpHref: "/help#administration",
      },
    },
  ];
}

/** Page help for `pathname`, worded for the viewer's platform role. */
export function getCorePageHelp(pathname: string, role?: string | null): PageHelpContent {
  return resolvePageHelp(pathname, routes(STAFF_ROLES.has(role ?? "")), FALLBACK);
}

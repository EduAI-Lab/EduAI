/**
 * AI Tutor's page-level help copy for the header (?) button (#1754). One entry
 * per screen; `helpHref` deep-links into the matching `/help` section (topic
 * ids in `components/help/HelpView.tsx`).
 */
import { resolvePageHelp, type PageHelpContent, type PageHelpRoute } from "@eduai/ui";
import type { Role } from "~/lib/types";

const FALLBACK: PageHelpContent = {
  title: "Getting around AI Tutor",
  summary:
    "Courses are organized into modules, lessons and activities. Use the sidebar or ⌘K / Ctrl K to get anywhere.",
  tips: ["Breadcrumbs at the top show where you are and take you back up a level."],
  helpHref: "/help#navigation",
};

const ROUTES: PageHelpRoute[] = [
  {
    match: "/student",
    content: {
      title: "Your courses",
      summary: "Every course you're enrolled in, with your progress through each.",
      tips: [
        "Open a course card to see its modules.",
        "Take the tour below to walk through opening your first lesson.",
      ],
      helpHref: "/help#navigation",
    },
  },
  {
    match: /^\/student\/courses\/[^/]+$/,
    content: {
      title: "Course modules",
      summary: "This course is split into modules. Each module holds a set of lessons.",
      tips: ["Open a module to see its lessons and pick up where you left off."],
      helpHref: "/help#navigation",
    },
  },
  {
    match: /^\/student\/module\/[^/]+$/,
    content: {
      title: "Module lessons",
      summary: "The lessons in this module. Each lesson contains activities to work through.",
      tips: ["Open a lesson to start its activities."],
      helpHref: "/help#navigation",
    },
  },
  {
    match: /^\/student\/lesson\/[^/]+$/,
    content: {
      title: "Lesson",
      summary:
        "Work through each activity, then chat with the AI tutor if you get stuck. Every chat stays scoped to its activity.",
      tips: [
        "Teach me explains the topic; Guide me gives hints so you reach the answer yourself.",
        "Your knowledge level shapes how the tutor explains things. Change it any time.",
        "Conversations save automatically — reopen one from the history above the message box.",
      ],
      helpHref: "/help#chat-modes",
    },
  },
  {
    match: "/instructor",
    content: {
      title: "Teaching courses",
      summary: "The courses you teach or manage in AI Tutor. Open one to build its content.",
      tips: ["Content is organized as modules, then lessons, then activities."],
      helpHref: "/help#teaching",
    },
  },
  {
    match: /^\/instructor\/courses\/[^/]+$/,
    content: {
      title: "Course content",
      summary: "Build this course's modules and manage who can see it.",
      tips: [
        "Draft content stays hidden from students until it's published.",
        "Open a module to add and order its lessons.",
      ],
      helpHref: "/help#teaching",
    },
  },
  {
    match: /^\/instructor\/module\/[^/]+$/,
    content: {
      title: "Module",
      summary: "The lessons in this module. Add, reorder and publish them here.",
      tips: ["Open a lesson to add the activities students work through."],
      helpHref: "/help#teaching",
    },
  },
  {
    match: /^\/instructor\/lesson\/[^/]+$/,
    content: {
      title: "Lesson activities",
      summary: "The activities in this lesson, and how the AI tutor behaves on each one.",
      tips: [
        "Per activity, choose which chat modes students see — Teach me, Guide me, or a custom mode with your own prompt.",
      ],
      helpHref: "/help#teaching",
    },
  },
  {
    match: "/admin",
    content: {
      title: "Admin console",
      summary: "Triage bug reports, configure AI tutoring and review AI oversight.",
      tips: ["Each area has its own tab at the top of the page."],
      helpHref: "/help#admin",
    },
  },
  {
    match: "/settings",
    content: {
      title: "Settings",
      summary: "Your appearance and accessibility preferences for AI Tutor.",
      tips: ["You can also switch light and dark mode from the header on any page."],
      helpHref: "/help#suite",
    },
  },
  {
    match: "/help",
    content: {
      title: "Help",
      summary: "The full written guide to AI Tutor. Jump to a topic from the section list.",
      tips: ["The (?) button on every page shows help for just that page."],
      helpHref: "/help#navigation",
    },
  },
];

function dashboardHelp(role: Role | undefined): PageHelpContent {
  const learner = role === "STUDENT" || role === "TA";
  return {
    title: "Dashboard",
    summary: learner
      ? "Your home base: your courses, your progress and where to pick up next."
      : "Your home base: your courses, key stats and anything that needs your attention.",
    tips: ["Open a course from the list, or use the quick actions to jump straight in."],
    helpHref: "/help#navigation",
  };
}

/** Page help for `pathname`, worded for the viewer's effective role. */
export function getAiTutorPageHelp(pathname: string, role?: Role): PageHelpContent {
  if (pathname === "/dashboard") return dashboardHelp(role);
  return resolvePageHelp(pathname, ROUTES, FALLBACK);
}

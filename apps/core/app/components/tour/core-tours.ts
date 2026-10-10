/**
 * Core's guided tours (#764, moved onto the shared `@eduai/ui` engine in
 * #1754). Steps whose target isn't on the page (e.g. the analytics panel a
 * student doesn't have) are skipped, so one list works for every role and
 * viewport.
 */
import type { TourDefinition } from "@eduai/ui";

export const CORE_TOURS = {
  dashboard: {
    id: "dashboard",
    // Bump the version suffix to re-show the tour after a meaningful shell change.
    storageKey: "eduai:tour:dashboard:v1",
    steps: [
      {
        id: "welcome",
        route: "/dashboard",
        title: "Welcome to EduAI",
        body: "A quick 30-second tour of the essentials. You can skip anytime and replay it later from the (?) button.",
      },
      {
        id: "dashboard",
        route: "/dashboard",
        target: "dashboard-hero",
        title: "Your dashboard",
        body: "Home base — a greeting, your key stats, your courses, and recent conversations, all in one place.",
      },
      {
        id: "analytics",
        route: "/dashboard",
        target: "dashboard-analytics",
        placement: "top",
        title: "Activity at a glance",
        body: "These charts summarise material status and AI activity so you can see how things are tracking.",
      },
      {
        id: "ai-status",
        route: "/dashboard",
        target: "ai-status",
        title: "Know when AI is live",
        body: "These indicators show whether the cloud and UBC-hosted AI services are online right now.",
      },
      {
        id: "theme",
        route: "/dashboard",
        target: "theme-toggle",
        title: "Light or dark",
        body: "Switch themes here whenever you like — your choice is remembered.",
      },
      {
        id: "page-help",
        route: "/dashboard",
        target: "page-help",
        title: "Help on every page",
        body: "Stuck? The (?) button explains whatever page you're on, links to the full guide, and can replay this tour.",
      },
      {
        id: "command-palette",
        route: "/dashboard",
        title: "Jump anywhere with ⌘K",
        body: "Press ⌘K (Ctrl K on Windows/Linux) to open the command palette and jump to any page or course.",
      },
    ],
  },
} satisfies Record<string, TourDefinition>;

export type CoreTourId = keyof typeof CORE_TOURS;

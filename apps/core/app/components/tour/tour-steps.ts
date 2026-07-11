/**
 * Dashboard tour steps (issue #764). Anchored steps whose target isn't on the
 * page are auto-skipped by ProductTour, so this single list works for every role
 * and viewport — no per-role branching needed.
 */
import type { TourStep } from "./product-tour";

/** Bump the version suffix to re-show the tour after a meaningful shell change. */
export const DASHBOARD_TOUR_STORAGE_KEY = "eduai:tour:dashboard:v1";

export const DASHBOARD_TOUR_STEPS: TourStep[] = [
  {
    title: "Welcome to EduAI",
    body: "A quick 30-second tour of the essentials. You can skip anytime and replay it later from Help.",
  },
  {
    target: '[data-tour="dashboard-hero"]',
    title: "Your dashboard",
    body: "Home base — a greeting, your key stats, your courses, and recent conversations, all in one place.",
  },
  {
    target: '[data-tour="dashboard-analytics"]',
    title: "Activity at a glance",
    body: "These charts summarise material status and AI activity so you can see how things are tracking.",
  },
  {
    target: '[data-tour="ai-status"]',
    title: "Know when AI is live",
    body: "These indicators show whether the cloud and UBC-hosted AI services are online right now.",
  },
  {
    target: '[data-tour="theme-toggle"]',
    title: "Light or dark",
    body: "Switch themes here whenever you like — your choice is remembered.",
  },
  {
    title: "Jump anywhere with ⌘K",
    body: "Press ⌘K (Ctrl K on Windows/Linux) to open the command palette and jump to any page or course. Need more? Open Help & guide from the sidebar.",
  },
];

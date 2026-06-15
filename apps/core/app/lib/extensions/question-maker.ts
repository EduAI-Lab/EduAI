import type { DashboardAction } from "~/components/dashboard/dashboard-view";

const DEFAULT_QUESTION_MAKER_URL = "http://localhost:5173";

export function getQuestionMakerUrl(): string {
  return import.meta.env.VITE_QUESTION_MAKER_URL?.trim() || DEFAULT_QUESTION_MAKER_URL;
}

export function getQuestionMakerDashboardAction(): DashboardAction {
  return {
    title: "Question Maker",
    description: "Build question banks, assessments, and exam variants.",
    href: getQuestionMakerUrl(),
    external: true,
  };
}

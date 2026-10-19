import { ONBOARDING_PAGES } from "./generated/pages";

export type OnboardingPlatform = "core" | "ai-tutor" | "question-maker";
export type OnboardingPageId = keyof typeof ONBOARDING_PAGES;

const STAFF = new Set(["INSTRUCTOR", "ADMIN", "UNIT_ADMIN"]);
const SUPPORTED = new Set([...STAFF, "STUDENT", "TA"]);
// Pages a task opens directly; every other task starts from the course list.
const DIRECT_PAGES = new Set(["help", "settings", "chat", "library"]);

function hasAccess(platform: OnboardingPlatform, role?: string | null) {
  return !!role && SUPPORTED.has(role) && (platform !== "question-maker" || STAFF.has(role));
}

export function resolveOnboardingPage(
  platform: OnboardingPlatform,
  pathname: string,
  role?: string | null,
): OnboardingPageId | null {
  if (!hasAccess(platform, role)) return null;
  if (platform === "core") {
    if (pathname === "/courses") return "core.courses";
    if (/^\/courses\/(?!new$|join$|self-enroll$)[^/]+$/.test(pathname)) return "core.course";
    if (/^\/chat(?:\/[^/]+)?$/.test(pathname)) return "core.chat";
    if (pathname === "/settings") return "core.settings";
    if (pathname === "/help") return "core.help";
  }
  if (platform === "ai-tutor") {
    if (pathname === "/help") return "ai-tutor.help";
    const prefix = role === "STUDENT" ? "student" : "instructor";
    // TAs may use both their teaching workspace and learner routes.
    const prefixes = role === "TA" ? ["student", "instructor"] : [prefix];
    for (const part of prefixes) {
      if (pathname === `/${part}`) return "ai-tutor.courses";
      if (new RegExp(`^/${part}/courses/[^/]+$`).test(pathname)) return "ai-tutor.course";
      if (new RegExp(`^/${part}/module/[^/]+$`).test(pathname)) return "ai-tutor.module";
      if (new RegExp(`^/${part}/lesson/[^/]+$`).test(pathname)) return "ai-tutor.lesson";
    }
  }
  if (platform === "question-maker") {
    if (pathname === "/courses") return "question-maker.courses";
    if (/^\/courses\/\d+$/.test(pathname)) return "question-maker.course";
    if (/^\/courses\/\d+\/questions\/(new|\d+\/edit)$/.test(pathname))
      return "question-maker.question";
    if (/^\/courses\/\d+\/assessments\/\d+$/.test(pathname)) return "question-maker.assessment";
    if (pathname === "/library") return "question-maker.library";
  }
  return null;
}

export function onboardingTasks(platform: OnboardingPlatform, role?: string | null) {
  if (!hasAccess(platform, role)) return [];
  const courses =
    platform === "ai-tutor" ? (role === "STUDENT" ? "/student" : "/instructor") : "/courses";
  return (Object.keys(ONBOARDING_PAGES) as OnboardingPageId[])
    .filter((id) => id.startsWith(`${platform}.`))
    .map((id) => {
      const page = ONBOARDING_PAGES[id];
      const name = id.split(".")[1];
      const href = DIRECT_PAGES.has(name) ? `/${name}` : courses;
      // TAs get staff copy: their tasks open the teaching workspace.
      return { id, label: role === "STUDENT" ? page.task : page.staffTask, href };
    });
}

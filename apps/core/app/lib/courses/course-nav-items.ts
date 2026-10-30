/**
 * The course menu (the vertical column beside the global rail, and its section
 * of the mobile drawer). It replaced the horizontal tab bar, so it owns the
 * same visibility rules the tab triggers had: the manager-view gates for staff
 * access, a fixed three-section menu for TAs (§6: no Enrollments), and nothing
 * for students, whose course page is a single view.
 *
 * Kept pure so the shell's menu and the views' active-section lookup can never
 * disagree about which sections exist.
 */
import type { CourseNavConfig } from "@eduai/ui";

import { DEFAULT_POLICY_DISABLED_MESSAGE } from "~/components/policy/policy-gate";
import type { CourseAccess } from "~/lib/rbac";
import type { PolicyKey } from "~/lib/policy-flags";
import { resolveManagerViewClientGates } from "~/lib/courses/manager-view-client-gates";

export type CourseNavKey =
  | "overview"
  | "materials"
  | "topics"
  | "enrollments"
  | "staff"
  | "settings"
  | "chat-history";

export type CourseNavItem = {
  key: CourseNavKey;
  label: string;
  /**
   * §807: a qualifying role keeps the entry visible but greyed when the policy
   * is off; non-qualifying roles don't get the entry at all.
   */
  disabled?: boolean;
};

/** The search param that selects a course section; absent means Overview. */
export const COURSE_TAB_PARAM = "tab";

export function getCourseNavItems(
  access: CourseAccess,
  isEnabled: (key: PolicyKey) => boolean,
): CourseNavItem[] {
  if (access === "ta") {
    return [
      { key: "overview", label: "Overview" },
      { key: "materials", label: "Materials" },
      { key: "topics", label: "Topics" },
    ];
  }
  if (access !== "admin" && access !== "unit" && access !== "instructor") return [];

  const { showStaffTab, canManageStaff, canManageRagSettings, showChatTab, canViewChats } =
    resolveManagerViewClientGates(access, isEnabled);
  const items: CourseNavItem[] = [
    { key: "overview", label: "Overview" },
    { key: "materials", label: "Materials" },
    { key: "topics", label: "Topics" },
    { key: "enrollments", label: "Enrollments" },
  ];
  if (showStaffTab) items.push({ key: "staff", label: "TAs", disabled: !canManageStaff });
  if (canManageRagSettings) items.push({ key: "settings", label: "Settings" });
  if (showChatTab) {
    items.push({ key: "chat-history", label: "Chat history", disabled: !canViewChats });
  }
  return items;
}

/**
 * The section a `?tab=` value selects. Anything that isn't an enabled entry of
 * this menu — a typo, a stale link, a section the policy just switched off —
 * lands on Overview rather than an empty page.
 */
export function resolveCourseNavKey(
  param: string | null | undefined,
  items: CourseNavItem[],
): CourseNavKey {
  const match = items.find((item) => item.key === param && !item.disabled);
  return match?.key ?? "overview";
}

/** The `search` string a menu link points at; Overview is the bare course URL. */
export function courseNavSearch(key: CourseNavKey): string {
  return key === "overview" ? "" : `?${COURSE_TAB_PARAM}=${key}`;
}

/** The shared shell's course menu for one course page (links are `?tab=` on the course URL). */
export function buildCourseNavConfig({
  courseId,
  code,
  term,
  items,
  activeKey,
}: {
  courseId: string;
  code: string;
  term: string;
  items: CourseNavItem[];
  activeKey: CourseNavKey;
}): CourseNavConfig {
  const href = `/courses/${courseId}`;
  return {
    href,
    code,
    term,
    activeKey,
    items: items.map((item) => ({
      key: item.key,
      label: item.label,
      href: `${href}${courseNavSearch(item.key)}`,
      disabled: item.disabled,
      disabledReason: item.disabled ? DEFAULT_POLICY_DISABLED_MESSAGE : undefined,
    })),
  };
}

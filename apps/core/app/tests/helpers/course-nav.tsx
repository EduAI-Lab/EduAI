/**
 * The course detail views no longer carry their own tab bar: the shell's
 * course menu picks a section by `?tab=` and the view shows the matching
 * panel. Tests that render a view on its own put this menu beside it (inside
 * the same router) so they can still switch sections the way a user does.
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { Link, useSearchParams } from "react-router";

import { CourseNavMenu, NavLinkProvider } from "@eduai/ui";
import { usePolicyGate } from "~/components/policy/policy-gate";
import {
  COURSE_TAB_PARAM,
  buildCourseNavConfig,
  getCourseNavItems,
  resolveCourseNavKey,
} from "~/lib/courses/course-nav-items";
import type { CourseAccess } from "~/lib/rbac";

/** Initial router entry for a view rendered with `TestCourseNav`. */
export const TEST_COURSE_PATH = "/courses/c1";

export function TestCourseNav({ access }: { access: CourseAccess }) {
  const { isEnabled } = usePolicyGate();
  const [searchParams] = useSearchParams();
  const items = getCourseNavItems(access, isEnabled);
  return (
    <NavLinkProvider LinkComponent={Link}>
      <CourseNavMenu
        config={buildCourseNavConfig({
          courseId: "c1",
          code: "TEST 100",
          term: "",
          items,
          activeKey: resolveCourseNavKey(searchParams.get(COURSE_TAB_PARAM), items),
        })}
      />
    </NavLinkProvider>
  );
}

function courseMenu() {
  return within(screen.getByRole("navigation", { name: "Course" }));
}

/** A course menu entry (enabled ones are links; disabled ones are aria-disabled `role="link"`). */
export function getCourseNavEntry(name: RegExp | string) {
  return courseMenu().getByRole("link", { name });
}

export function queryCourseNavEntry(name: RegExp | string) {
  const nav = screen.queryByRole("navigation", { name: "Course" });
  return nav ? within(nav).queryByRole("link", { name }) : null;
}

/** Switch the rendered view to a course section, as the course menu does. */
export function openCourseSection(name: RegExp | string) {
  fireEvent.click(getCourseNavEntry(name));
}

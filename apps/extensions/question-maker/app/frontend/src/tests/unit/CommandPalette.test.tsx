/**
 * Unit tests for the QM `CommandPalette` adapter (#1546): builds the "Go to" /
 * course-scoped / "Switch course" / app-switcher groups handed to the shared
 * `@eduai/ui` palette. The shared palette itself is mocked so this exercises
 * only QM's own group-building logic.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import type { CommandPaletteGroup, CommandPaletteItem, CommandPaletteProps } from "@eduai/ui";

type TestUser = { id: string; role: string };
type DisplayCourse = { id: number; code: string | null; name: string };
type SwitchAppOptions = { role?: string | null; currentAppId: string };
type CapturedGroup = CommandPaletteGroup & { __opts?: SwitchAppOptions };

const navigate = vi.fn();
let pathnameValue = "/dashboard";
let displayCoursesValue: DisplayCourse[] = [];
let userValue: TestUser | null = { id: "1", role: "instructor" };
let capturedGroups: CapturedGroup[] = [];
let canManageCanvasValue = true;

function group(heading: string): CapturedGroup {
  const found = capturedGroups.find((candidate) => candidate.heading === heading);
  if (!found) throw new Error(`Missing command group: ${heading}`);
  return found;
}

function item(commandGroup: CapturedGroup, label: string): CommandPaletteItem {
  const found = commandGroup.items.find((candidate) => candidate.label === label);
  if (!found) throw new Error(`Missing command item: ${label}`);
  return found;
}

vi.mock("react-router", () => ({
  useNavigate: () => navigate,
  useLocation: () => ({ pathname: pathnameValue }),
}));

vi.mock("@eduai/ui", () => ({
  CommandPalette: (props: CommandPaletteProps) => {
    capturedGroups = props.groups;
    return <div data-testid="shared-palette" data-open-event={props.openEventName} />;
  },
  buildAppSwitcherGroup: (opts: SwitchAppOptions) => ({
    heading: "Switch app",
    items: [],
    __opts: opts,
  }),
}));

vi.mock("@/hooks/useDisplayCourses", () => ({
  useDisplayCourses: () => ({ displayCourses: displayCoursesValue }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: userValue }),
}));

vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissions: () => ({ canManageCanvas: canManageCanvasValue }),
}));

vi.mock("@/lib/apps", () => ({
  CURRENT_APP_ID: "question-maker",
  getLauncherApps: () => [{ id: "core" }],
}));

vi.mock("@/lib/rbac/nav", () => ({
  getNavForUser: (user: TestUser | null) =>
    user ? [{ key: "dashboard", title: "Dashboard", href: "/dashboard" }] : [],
  getNavSecondaryForUser: (user: TestUser | null) =>
    user ? [{ key: "help", title: "Help", href: "/help" }] : [],
}));

import { CommandPalette } from "@/components/command/CommandPalette";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  pathnameValue = "/dashboard";
  displayCoursesValue = [];
  userValue = { id: "1", role: "instructor" };
  capturedGroups = [];
  canManageCanvasValue = true;
});

describe("CommandPalette", () => {
  it("opens on the qm:open-command event", () => {
    const { getByTestId } = render(<CommandPalette />);
    expect(getByTestId("shared-palette").dataset.openEvent).toBe("qm:open-command");
  });

  it('includes nav items plus a Settings entry in "Go to"', () => {
    render(<CommandPalette />);
    const labels = group("Go to").items.map((command) => command.label);
    expect(labels).toEqual(["Dashboard", "Help", "Settings"]);
  });

  it('navigates when a "Go to" item is selected', () => {
    render(<CommandPalette />);
    item(group("Go to"), "Settings").onSelect();
    expect(navigate).toHaveBeenCalledWith("/settings");
  });

  it('shows "This course" heading with no items when not on a course route', () => {
    pathnameValue = "/dashboard";
    render(<CommandPalette />);
    const courseGroup = group("This course");
    expect(courseGroup.items).toEqual([]);
  });

  it("shows the course-scoped actions and the course code as heading on a course route", () => {
    pathnameValue = "/courses/7";
    displayCoursesValue = [{ id: 7, code: "CPSC 101", name: "Intro to CS" }];
    render(<CommandPalette />);
    const courseGroup = group("CPSC 101");
    expect(courseGroup.items.map((command) => command.label)).toContain("New question");

    item(courseGroup, "New question").onSelect();
    expect(navigate).toHaveBeenCalledWith("/courses/7/questions/new");
  });

  it("hides course actions when the course is not in displayCourses", () => {
    pathnameValue = "/courses/99";
    displayCoursesValue = [];
    render(<CommandPalette />);
    const courseGroup = group("This course");
    expect(courseGroup.items).toEqual([]);
  });

  it('lists up to 8 courses under "Switch course" and navigates on select', () => {
    displayCoursesValue = Array.from({ length: 10 }, (_, i) => ({
      id: i,
      code: `C${i}`,
      name: `Course ${i}`,
    }));
    render(<CommandPalette />);
    const switchGroup = group("Switch course");
    expect(switchGroup.items).toHaveLength(8);

    switchGroup.items[0].onSelect();
    expect(navigate).toHaveBeenCalledWith("/courses/0");
  });

  it("includes the app-switcher group built from getLauncherApps", () => {
    render(<CommandPalette />);
    expect(capturedGroups.some((g) => g.heading === "Switch app")).toBe(true);
  });

  it('produces empty "Go to" items when there is no user', () => {
    userValue = null;
    render(<CommandPalette />);
    expect(group("Go to").items.map((command) => command.label)).toEqual(["Settings"]);
  });
});

describe("CommandPalette additional course-scoped actions", () => {
  it("navigates for each course-scoped tab action", () => {
    pathnameValue = "/courses/7";
    displayCoursesValue = [{ id: 7, code: "CPSC 101", name: "Intro to CS" }];
    render(<CommandPalette />);
    const courseGroup = group("CPSC 101");

    const cases: Array<[string, string]> = [
      ["Questions", "/courses/7?tab=questions"],
      ["Assessments", "/courses/7?tab=assessments"],
      ["Topics", "/courses/7?tab=topics"],
      ["Canvas", "/courses/7?tab=canvas"],
      ["Overview", "/courses/7?tab=overview"],
    ];
    for (const [label, href] of cases) {
      item(courseGroup, label).onSelect();
      expect(navigate).toHaveBeenCalledWith(href);
    }
  });

  it("hides Canvas when the user cannot manage the course integration", () => {
    pathnameValue = "/courses/7";
    displayCoursesValue = [{ id: 7, code: "CPSC 101", name: "Intro to CS" }];
    canManageCanvasValue = false;

    render(<CommandPalette />);

    const courseGroup = group("CPSC 101");
    expect(courseGroup.items.map((command) => command.label)).not.toContain("Canvas");
  });

  it("omits the sublabel when a switch-course entry has no code", () => {
    displayCoursesValue = [{ id: 1, code: null, name: "No Code Course" }];
    render(<CommandPalette />);
    const switchGroup = group("Switch course");
    expect(switchGroup.items[0].sublabel).toBeUndefined();
    expect(switchGroup.items[0].label).toBe("No Code Course");
  });

  it("passes role through to buildAppSwitcherGroup", () => {
    userValue = { id: "1", role: "ADMIN" };
    render(<CommandPalette />);
    const appGroup = group("Switch app");
    expect(appGroup.__opts?.role).toBe("ADMIN");
    expect(appGroup.__opts?.currentAppId).toBe("question-maker");
  });
});

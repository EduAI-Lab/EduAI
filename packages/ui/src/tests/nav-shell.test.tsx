import * as React from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  IconBooks,
  IconDashboard,
  IconHelp,
  IconHistory,
  IconShieldLock,
} from "@tabler/icons-react";

import { NavShell } from "../nav-shell";
import type { CourseNavConfig, NavShellModel } from "../nav-shell";
import type { LauncherApp } from "../app-launcher";
import { ThemeProvider } from "../theme-provider";

/** A matchMedia whose `min-width` queries answer against a settable viewport width. */
let viewportWidth = 1280;
const mediaListeners = new Set<() => void>();
const originalMatchMedia = window.matchMedia;

function setViewportWidth(width: number) {
  viewportWidth = width;
  act(() => {
    for (const listener of mediaListeners) listener();
  });
}

beforeEach(() => {
  viewportWidth = 1280;
  mediaListeners.clear();
  window.matchMedia = ((query: string) => {
    const minWidth = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
    return {
      get matches() {
        return viewportWidth >= minWidth;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    };
  }) as unknown as typeof window.matchMedia;
});

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  window.localStorage.clear();
});

const APPS: LauncherApp[] = [
  {
    id: "core",
    name: "EduAI Core",
    shortName: "Core",
    url: "https://core.test/",
    description: "Course hub",
  },
  { id: "test", name: "Test App", url: "https://test.test/", description: "The app under test" },
];

function makeModel(overrides: Partial<NavShellModel> = {}): NavShellModel {
  return {
    pathname: "/dashboard",
    user: { name: "Ada Lovelace", email: "ada@eduai.test", role: "INSTRUCTOR" },
    entries: [
      {
        kind: "link",
        link: { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: IconDashboard },
      },
      { kind: "tray", tray: "courses", label: "Courses", icon: IconBooks },
      { kind: "tray", tray: "admin", label: "Administration", icon: IconShieldLock },
      { kind: "tray", tray: "help", label: "Help", icon: IconHelp },
    ],
    accountLinks: [
      { key: "settings", label: "Settings", href: "/settings" },
      { key: "back", label: "Back to EduAI", href: "https://core.test/dashboard", external: true },
    ],
    adminLinks: [{ key: "bugs", label: "Bug reports", href: "/admin/bug-reports" }],
    helpLinks: [{ key: "help", label: "Help & guide", href: "/help" }],
    coursesHref: "/courses",
    loadCourses: () =>
      Promise.resolve([
        { id: "7", href: "/courses/7", code: "BIOL 116", name: "Intro Biology", subtitle: "W1" },
      ]),
    launcherApps: APPS,
    currentAppId: "test",
    onLogout: vi.fn(),
    ...overrides,
  };
}

const COURSE_NAV: CourseNavConfig = {
  href: "/courses/7",
  code: "BIOL 116",
  term: "2026-27W1",
  items: [
    { key: "overview", label: "Overview", href: "/courses/7?tab=overview" },
    { key: "banks", label: "Banks", href: "/courses/7?tab=banks", tourId: "banks-tab" },
  ],
  activeKey: "banks",
};

/**
 * Stops happy-dom navigating on a link click. Registered on `document`, so it
 * runs after React has handled the click (Radix skips its close for an
 * already-prevented click).
 */
function stopNavigation(event: Event) {
  event.preventDefault();
}

/** A stand-in router link: records the `to` it was given so tests can see it was used. */
function TestLink({ to, ...props }: { to: string } & React.ComponentPropsWithoutRef<"a">) {
  return <a data-router-link={to} {...props} />;
}

function renderShell(
  props: Partial<React.ComponentProps<typeof NavShell>> = {},
  model: NavShellModel = makeModel(),
) {
  return render(
    <ThemeProvider>
      <NavShell
        model={model}
        LinkComponent={TestLink}
        locationKey="k1"
        title="Dashboard"
        {...props}
      >
        <p>Page body</p>
      </NavShell>
    </ThemeProvider>,
  );
}

describe("NavShell — rail", () => {
  it("routes in-app links through the app's link component and marks the current page", () => {
    renderShell();
    const rail = screen.getByRole("navigation", { name: "Global" });
    const dashboard = within(rail).getByRole("link", { name: "Dashboard" });
    expect(dashboard).toHaveAttribute("data-router-link", "/dashboard");
    expect(dashboard).toHaveAttribute("aria-current", "page");
  });

  it("opens the Switch app tray from the current app's tile at the top of the rail", async () => {
    renderShell();
    const rail = screen.getByRole("navigation", { name: "Global" });
    const trigger = within(rail).getByRole("button", { name: "Switch app, current app: Test App" });
    expect(trigger).toHaveTextContent("Test App");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(trigger);
    const tray = await screen.findByRole("dialog", { name: "Switch app" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const current = within(tray).getByText("Test App").closest("[aria-current]");
    expect(current).toHaveAttribute("aria-current", "page");
    expect(current).toHaveTextContent("Current");
    expect(within(tray).queryByRole("link", { name: /Test App/ })).not.toBeInTheDocument();
    const core = within(tray).getByRole("link", { name: /EduAI Core/ });
    expect(core).toHaveAttribute("href", "https://core.test/");
    expect(core).toHaveTextContent("Course hub");

    fireEvent.keyDown(tray, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Switch app" })).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });

  it("closes the Switch app tray when another app is chosen", async () => {
    renderShell();
    const rail = screen.getByRole("navigation", { name: "Global" });
    fireEvent.click(within(rail).getByRole("button", { name: /Switch app/ }));
    const tray = await screen.findByRole("dialog", { name: "Switch app" });
    const core = within(tray).getByRole("link", { name: /EduAI Core/ });
    document.addEventListener("click", stopNavigation);
    try {
      fireEvent.click(core);
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: "Switch app" })).not.toBeInTheDocument(),
      );
    } finally {
      document.removeEventListener("click", stopNavigation);
    }
  });

  it("uses the app's short name on the tile", () => {
    renderShell({}, makeModel({ currentAppId: "core" }));
    const rail = screen.getByRole("navigation", { name: "Global" });
    expect(
      within(rail).getByRole("button", { name: "Switch app, current app: EduAI Core" }),
    ).toHaveTextContent(/^Core$/);
  });

  it("lists account links in the Account tray, with external ones as plain anchors", async () => {
    const onLogout = vi.fn();
    renderShell({}, makeModel({ onLogout }));
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    const tray = await screen.findByRole("dialog", { name: "Account" });

    expect(within(tray).getByRole("link", { name: "Settings" })).toHaveAttribute(
      "data-router-link",
      "/settings",
    );
    const back = within(tray).getByRole("link", { name: "Back to EduAI" });
    expect(back).toHaveAttribute("href", "https://core.test/dashboard");
    expect(back).not.toHaveAttribute("data-router-link");

    // The app switcher has its own tray now.
    expect(within(tray).queryByText("Switch app")).not.toBeInTheDocument();
    expect(within(tray).queryByRole("link", { name: /EduAI Core/ })).not.toBeInTheDocument();

    fireEvent.click(within(tray).getByRole("button", { name: "Log out" }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it("loads the Courses tray on first open", async () => {
    const loadCourses = vi.fn(() =>
      Promise.resolve([{ id: "7", href: "/courses/7", code: "BIOL 116", name: "Intro Biology" }]),
    );
    renderShell({}, makeModel({ loadCourses }));
    expect(loadCourses).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Courses" }));
    const tray = await screen.findByRole("dialog", { name: "Courses" });
    expect(await within(tray).findByRole("link", { name: /BIOL 116/ })).toHaveAttribute(
      "data-router-link",
      "/courses/7",
    );
    expect(loadCourses).toHaveBeenCalledOnce();
  });

  it("closes the Help tray before opening the bug report", async () => {
    const onReportBug = vi.fn();
    renderShell({}, makeModel({ onReportBug }));
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const tray = await screen.findByRole("dialog", { name: "Help" });

    fireEvent.click(within(tray).getByRole("button", { name: "Report a bug" }));

    expect(onReportBug).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Help" })).not.toBeInTheDocument(),
    );
  });

  it("leaves Report a bug out when the app takes no bug reports", async () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const tray = await screen.findByRole("dialog", { name: "Help" });
    expect(within(tray).queryByRole("button", { name: "Report a bug" })).not.toBeInTheDocument();
  });

  it("closes an open tray when the location changes", async () => {
    const { rerender } = renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Administration" }));
    await screen.findByRole("dialog", { name: "Administration" });

    rerender(
      <ThemeProvider>
        <NavShell model={makeModel()} LinkComponent={TestLink} locationKey="k2" title="Dashboard">
          <p>Page body</p>
        </NavShell>
      </ThemeProvider>,
    );

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("NavShell — course pages", () => {
  it("draws the course menu, its tour anchor, and the course breadcrumb", () => {
    renderShell({ courseNav: COURSE_NAV });
    const menu = screen.getByRole("navigation", { name: "Course" });
    const banks = within(menu).getByRole("link", { name: "Banks" });
    expect(banks).toHaveAttribute("aria-current", "page");
    expect(banks).toHaveAttribute("data-tour", "banks-tab");

    const crumbs = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "BIOL 116 · 2026-27W1" })).toHaveAttribute(
      "data-router-link",
      "/courses/7",
    );
    expect(within(crumbs).getByText("Banks")).toHaveAttribute("aria-current", "page");
  });

  it("links the section crumb and ends with the sub-page when one is set", () => {
    renderShell({ courseNav: { ...COURSE_NAV, subPage: "Question bank" } });
    const crumbs = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Banks" })).toHaveAttribute(
      "data-router-link",
      "/courses/7?tab=banks",
    );
    expect(within(crumbs).getByText("Question bank")).toHaveAttribute("aria-current", "page");
  });

  it("toggles the course menu from the hamburger", () => {
    renderShell({ courseNav: COURSE_NAV });
    const toggle = screen.getByRole("button", { name: "Hide course menu" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Show course menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("NavShell — mobile", () => {
  it("opens a modal drawer holding the account actions, nav, and course menu", async () => {
    renderShell({ courseNav: COURSE_NAV });
    setViewportWidth(375);

    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });

    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(within(drawer).getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: "Back to EduAI" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Administration" })).toBeInTheDocument();
    const courseMenu = within(drawer).getByRole("region", { name: "Course menu" });
    expect(within(courseMenu).getByRole("link", { name: "Banks" })).toBeInTheDocument();
    // Switching apps lives in the header, not the drawer's action row.
    expect(within(drawer).queryByRole("button", { name: /Switch app/ })).not.toBeInTheDocument();
  });

  it("opens the app list as a bottom sheet from the header's current app", async () => {
    renderShell();
    setViewportWidth(375);

    const rail = screen.getByRole("navigation", { name: "Global" });
    const trigger = screen
      .getAllByRole("button", { name: "Switch app, current app: Test App" })
      .find((button) => !rail.contains(button));
    expect(trigger).toBeDefined();
    expect(trigger).toHaveTextContent("Test App");

    fireEvent.click(trigger!);
    const sheet = await screen.findByRole("dialog", { name: "Switch app" });
    expect(within(sheet).getByRole("link", { name: /EduAI Core/ })).toHaveAttribute(
      "href",
      "https://core.test/",
    );
    expect(within(sheet).getByText("Current")).toBeInTheDocument();
  });
});

describe("NavShell — app-supplied trays and link actions", () => {
  /** A model whose rail carries an app-supplied "History" tray. */
  function modelWithPanel(overrides: Partial<NavShellModel> = {}) {
    return makeModel({
      entries: [
        {
          kind: "panel",
          key: "history",
          label: "History",
          icon: IconHistory,
          render: (close) => (
            <button type="button" onClick={close}>
              Pick
            </button>
          ),
        },
        { kind: "tray", tray: "help", label: "Help", icon: IconHelp },
      ],
      ...overrides,
    });
  }

  it("opens an app-supplied panel tray and lets its content close it", async () => {
    renderShell({}, modelWithPanel());
    const rail = screen.getByRole("navigation", { name: "Global" });
    const trigger = within(rail).getByRole("button", { name: "History" });
    fireEvent.click(trigger);
    const tray = await screen.findByRole("dialog", { name: "History" });
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(tray).getByRole("button", { name: "Pick" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "History" })).toBeNull());
  });

  it("returns focus to a panel trigger on Escape in icon-only mode", async () => {
    renderShell({}, modelWithPanel());
    fireEvent.click(screen.getByRole("button", { name: "Collapse navigation" }));
    const rail = screen.getByRole("navigation", { name: "Global" });
    const trigger = within(rail).getByRole("button", { name: "History" });
    fireEvent.focus(trigger);
    expect(await screen.findByRole("tooltip")).toHaveTextContent("History");
    fireEvent.click(trigger);
    const tray = await screen.findByRole("dialog", { name: "History" });
    fireEvent.keyDown(tray, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "History" })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("shows a panel entry as a drawer section on mobile", async () => {
    renderShell({}, modelWithPanel());
    setViewportWidth(375);
    fireEvent.click(screen.getByRole("button", { name: "Open navigation menu" }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    fireEvent.click(within(drawer).getByRole("button", { name: "History" }));
    fireEvent.click(await within(drawer).findByRole("button", { name: "Pick" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Navigation" })).toBeNull());
  });

  it("calls a link's onClick", () => {
    const onClick = vi.fn();
    renderShell(
      {},
      makeModel({
        entries: [
          { kind: "link", link: { key: "new", label: "New chat", href: "/chat", onClick } },
        ],
      }),
    );
    const rail = screen.getByRole("navigation", { name: "Global" });
    fireEvent.click(within(rail).getByRole("link", { name: "New chat" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("omits All courses without coursesHref", async () => {
    renderShell(
      {},
      makeModel({ coursesHref: undefined, courses: { status: "ready", courses: [] } }),
    );
    const rail = screen.getByRole("navigation", { name: "Global" });
    fireEvent.click(within(rail).getByRole("button", { name: "Courses" }));
    const tray = await screen.findByRole("dialog", { name: "Courses" });
    expect(within(tray).queryByText("All courses")).toBeNull();
  });
});

describe("NavShell — pages that draw their own heading", () => {
  it("keeps the header's title out of the heading outline with breadcrumbs", () => {
    renderShell({
      title: "Settings",
      breadcrumbs: <span>Settings crumb</span>,
      headingInPage: true,
    });
    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
  });

  it("keeps the header's title out of the heading outline on a course page", () => {
    renderShell({ title: "BIOL 116", courseNav: COURSE_NAV, headingInPage: true });
    expect(screen.queryByRole("heading", { name: "BIOL 116" })).toBeNull();
  });

  it("still shows a plain title as text, not a heading", () => {
    renderShell({ title: "Settings", headingInPage: true });
    expect(screen.getAllByText("Settings").length).toBeGreaterThan(0);
    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
  });

  it("makes the header's title the page heading by default", () => {
    renderShell({ title: "Settings", breadcrumbs: <span>Settings crumb</span> });
    expect(screen.getByRole("heading", { level: 1, name: "Settings" })).toBeInTheDocument();
  });
});

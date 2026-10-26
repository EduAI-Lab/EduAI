import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";

import {
  COURSE_MENU_OPEN_KEY,
  RAIL_COLLAPSED_KEY,
  ThemeProvider,
  type CourseNavConfig,
} from "@eduai/ui";
import { CoreAppShell } from "~/components/layout/core-app-shell";
import { PolicyProvider } from "~/components/policy/policy-gate";
import { buildCourseNavConfig } from "~/lib/courses/course-nav-items";
import type { User } from "~/lib/auth/types";

// The header's live widgets and global overlays are covered by their own
// suites; stubbing them keeps this one about the shell's layout and nav.
vi.mock("~/components/ai/ai-service-indicators", () => ({ AIServiceIndicators: () => null }));
vi.mock("~/components/help/core-page-help", () => ({ CorePageHelp: () => null }));
vi.mock("~/components/assistant/help-assistant", () => ({
  AssistantHeaderButton: () => null,
  HelpAssistant: () => null,
}));
vi.mock("~/components/command/command-palette", () => ({
  CORE_COMMAND_EVENT: "eduai:open-command",
  CommandPalette: () => null,
}));
vi.mock("~/components/shared/bug-report-submit-dialog", () => ({
  BugReportSubmitDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Report a bug" /> : null,
}));

/** A matchMedia whose `min-width` queries answer against a settable viewport width. */
let viewportWidth = 1280;
const mediaListeners = new Set<() => void>();
function setViewportWidth(width: number) {
  viewportWidth = width;
  act(() => {
    for (const listener of mediaListeners) listener();
  });
}

beforeEach(() => {
  viewportWidth = 1280;
  mediaListeners.clear();
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => {
      const minWidth = Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
      return {
        get matches() {
          return viewportWidth >= minWidth;
        },
        media: query,
        addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
        removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      };
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ data: [] }) }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

const USER = {
  id: "user-1",
  name: "Test User",
  email: "test@eduai.test",
  role: "ADMIN",
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
} as User;

const STAFF_COURSE_NAV: CourseNavConfig = buildCourseNavConfig({
  courseId: "c1",
  code: "BIOL 116",
  term: "2026-27W1",
  items: [
    { key: "overview", label: "Overview" },
    { key: "materials", label: "Materials" },
    { key: "topics", label: "Topics" },
    { key: "staff", label: "TAs", disabled: true },
  ],
  activeKey: "materials",
});

function renderShell({
  courseNav,
  path = "/courses/c1?tab=materials",
}: { courseNav?: CourseNavConfig; path?: string } = {}) {
  const router = createMemoryRouter(
    [
      {
        path: "*",
        element: (
          <ThemeProvider>
            <PolicyProvider policies={{}}>
              <CoreAppShell user={USER} title="Intro Biology" courseNav={courseNav}>
                <p>Page content</p>
              </CoreAppShell>
            </PolicyProvider>
          </ThemeProvider>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe("CoreAppShell — course pages (desktop)", () => {
  it("renders the course menu with the active section marked and disabled sections inert", () => {
    renderShell({ courseNav: STAFF_COURSE_NAV });
    const menu = screen.getByRole("navigation", { name: "Course" });

    expect(within(menu).getByText("2026-27W1")).toBeInTheDocument();
    expect(within(menu).getByRole("link", { name: "Materials" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(menu).getByRole("link", { name: "Topics" })).toHaveAttribute(
      "href",
      "/courses/c1?tab=topics",
    );
    expect(within(menu).getByRole("link", { name: "Overview" })).toHaveAttribute(
      "href",
      "/courses/c1",
    );
    const disabled = within(menu).getByRole("link", { name: "TAs" });
    expect(disabled).toHaveAttribute("aria-disabled", "true");
    expect(disabled).not.toHaveAttribute("href");
  });

  it("shows the CODE · term › Section breadcrumb, with the course part linking to Overview", () => {
    renderShell({ courseNav: STAFF_COURSE_NAV });
    const crumbs = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "BIOL 116 · 2026-27W1" })).toHaveAttribute(
      "href",
      "/courses/c1",
    );
    expect(within(crumbs).getByText("Materials")).toHaveAttribute("aria-current", "page");
  });

  it("hides and shows the course menu from the hamburger and remembers the choice", () => {
    renderShell({ courseNav: STAFF_COURSE_NAV });
    const hamburger = screen.getByRole("button", { name: "Hide course menu" });
    expect(hamburger).toHaveAttribute("aria-expanded", "true");
    expect(hamburger).toHaveAttribute("aria-controls", "course-menu");

    fireEvent.click(hamburger);

    expect(hamburger).toHaveAttribute("aria-expanded", "false");
    expect(hamburger).toHaveAccessibleName("Show course menu");
    expect(document.getElementById("course-menu")).toHaveAttribute("inert");
    expect(window.localStorage.getItem(COURSE_MENU_OPEN_KEY)).toBe("false");
  });

  it("restores a saved hidden course menu and a saved collapsed rail", async () => {
    window.localStorage.setItem(COURSE_MENU_OPEN_KEY, "false");
    window.localStorage.setItem(RAIL_COLLAPSED_KEY, "true");
    renderShell({ courseNav: STAFF_COURSE_NAV });
    expect(await screen.findByRole("button", { name: "Show course menu" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.getByRole("navigation", { name: "Global" })).toHaveAttribute(
      "data-collapsed",
      "true",
    );
  });

  it("draws no course menu or hamburger when the course has no sections (students)", () => {
    renderShell({ courseNav: { ...STAFF_COURSE_NAV, items: [], activeKey: "overview" } });
    expect(screen.queryByRole("navigation", { name: "Course" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /course menu/ })).not.toBeInTheDocument();
    const crumbs = screen.getByRole("navigation", { name: "breadcrumb" });
    expect(within(crumbs).getByText("BIOL 116 · 2026-27W1")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("has no course menu or hamburger off course pages", () => {
    renderShell({ path: "/dashboard" });
    expect(screen.queryByRole("navigation", { name: "Course" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /course menu/ })).not.toBeInTheDocument();
  });

  it("opens the bug report from the Help tray", async () => {
    renderShell({ path: "/dashboard" });
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    const tray = await screen.findByRole("dialog", { name: "Help" });
    fireEvent.click(within(tray).getByRole("button", { name: "Report a bug" }));
    expect(await screen.findByRole("dialog", { name: "Report a bug" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Help" })).not.toBeInTheDocument();
  });

  it("closes an open tray on navigation", async () => {
    const router = renderShell({ path: "/dashboard" });
    fireEvent.click(screen.getByRole("button", { name: "Help" }));
    await screen.findByRole("dialog", { name: "Help" });
    await act(() => router.navigate("/help"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("CoreAppShell — tablet", () => {
  it("opens the course menu as an overlay drawer from the hamburger", async () => {
    renderShell({ courseNav: STAFF_COURSE_NAV });
    setViewportWidth(900);

    const hamburger = screen.getByRole("button", { name: "Show course menu" });
    expect(hamburger).toHaveAttribute("aria-controls", "course-menu-drawer");
    fireEvent.click(hamburger);

    const drawer = await screen.findByRole("dialog", { name: "Course menu" });
    expect(within(drawer).getByRole("link", { name: "Materials" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(hamburger).toHaveAttribute("aria-expanded", "true");
  });

  it("renders tray triggers with tooltips-only labels (icon-only rail)", () => {
    renderShell({ path: "/dashboard" });
    setViewportWidth(900);
    // The label is still the accessible name; only its visibility changes (CSS).
    expect(screen.getByRole("button", { name: "Courses" })).toBeInTheDocument();
  });
});

describe("CoreAppShell — mobile drawer", () => {
  async function openDrawer() {
    const hamburger = screen.getByRole("button", { name: "Open navigation menu" });
    fireEvent.click(hamburger);
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    return { hamburger, drawer };
  }

  it("is a modal dialog with the account block and its actions", async () => {
    renderShell({ courseNav: STAFF_COURSE_NAV });
    setViewportWidth(375);
    const { drawer } = await openDrawer();

    expect(drawer).toHaveAttribute("aria-modal", "true");
    expect(within(drawer).getByText("Test User")).toBeInTheDocument();
    expect(within(drawer).getByText("test@eduai.test")).toBeInTheDocument();
    expect(within(drawer).getByText("Admin")).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: /mode$/ })).toBeInTheDocument();
    expect(within(drawer).getByRole("link", { name: "Settings" })).toBeInTheDocument();
    expect(within(drawer).getByRole("button", { name: "Log out" })).toBeInTheDocument();
  });

  it("expands Administration and Help inline as accordions", async () => {
    renderShell({ path: "/dashboard" });
    setViewportWidth(375);
    const { drawer } = await openDrawer();

    const admin = within(drawer).getByRole("button", { name: "Administration" });
    expect(admin).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(admin);
    expect(admin).toHaveAttribute("aria-expanded", "true");
    expect(within(drawer).getByRole("link", { name: "User Management" })).toHaveAttribute(
      "href",
      "/admin/users",
    );

    fireEvent.click(within(drawer).getByRole("button", { name: "Help" }));
    expect(within(drawer).getByRole("link", { name: "Help & guide" })).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole("button", { name: "Report a bug" }));
    expect(await screen.findByRole("dialog", { name: "Report a bug" })).toBeInTheDocument();
  });

  it("includes the course code, term, and menu on course pages", async () => {
    renderShell({ courseNav: STAFF_COURSE_NAV });
    setViewportWidth(375);
    const { drawer } = await openDrawer();

    const course = within(drawer).getByRole("region", { name: "Course menu" });
    expect(within(course).getByText("BIOL 116")).toBeInTheDocument();
    expect(within(course).getByText("2026-27W1")).toBeInTheDocument();
    expect(within(course).getByRole("link", { name: "Materials" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("closes on Escape and returns focus to the hamburger", async () => {
    renderShell({ path: "/dashboard" });
    setViewportWidth(375);
    const { hamburger, drawer } = await openDrawer();

    fireEvent.keyDown(drawer, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(hamburger);
  });

  it("closes on a left swipe", async () => {
    renderShell({ path: "/dashboard" });
    setViewportWidth(375);
    const { drawer } = await openDrawer();

    fireEvent.pointerDown(drawer, { pointerType: "touch", clientX: 250, clientY: 300 });
    fireEvent.pointerUp(drawer, { pointerType: "touch", clientX: 120, clientY: 310 });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("ignores a short or mostly vertical swipe", async () => {
    renderShell({ path: "/dashboard" });
    setViewportWidth(375);
    const { drawer } = await openDrawer();

    fireEvent.pointerDown(drawer, { pointerType: "touch", clientX: 250, clientY: 100 });
    fireEvent.pointerUp(drawer, { pointerType: "touch", clientX: 170, clientY: 400 });

    expect(screen.getByRole("dialog", { name: "Navigation" })).toBeInTheDocument();
  });

  it("closes when the viewport grows past the mobile breakpoint", async () => {
    renderShell({ path: "/dashboard" });
    setViewportWidth(375);
    await openDrawer();

    setViewportWidth(1280);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { resolveCoreHeaderTitle, CoreHeaderActions } from "~/components/layout/core-app-shell";
import { ThemeProvider } from "@eduai/ui";

/**
 * Core's header pieces: the route → title fallback map `CoreAppShell`
 * resolves for every page (ported verbatim from the old SiteHeader so no
 * route's heading changed), and the fixed header action bundle
 * (`CoreHeaderActions`) every Core page renders. The shell's own layout —
 * rail, course menu, mobile drawer — is covered in `CoreAppShell.test.tsx`.
 */
describe("resolveCoreHeaderTitle", () => {
  it("falls back to EduAI for an unmapped route with no explicit title", () => {
    expect(resolveCoreHeaderTitle("/team")).toBe("EduAI");
  });

  it("uses an explicit title override regardless of route", () => {
    expect(resolveCoreHeaderTitle("/", "Courses")).toBe("Courses");
  });

  it("prefers an explicit title over the route-derived fallback", () => {
    expect(resolveCoreHeaderTitle("/dashboard", "Custom")).toBe("Custom");
  });

  it("derives the title from the route when no title is passed", () => {
    expect(resolveCoreHeaderTitle("/dashboard")).toBe("Dashboard");
  });

  it('derives "Course Chat" from the /chat route when no title prop is passed', () => {
    expect(resolveCoreHeaderTitle("/chat")).toBe("Course Chat");
  });

  it("falls back to Settings for the bare /settings route (no breadcrumbs, no explicit title)", () => {
    // #764 regression guard: settings.tsx renders `<CoreAppShell user={user}>`
    // with neither `title` nor `breadcrumbs` — the visible heading depends
    // entirely on this fallback resolving, unlike routes that pass breadcrumbs
    // (where an unresolved title would only affect the sr-only heading).
    expect(resolveCoreHeaderTitle("/settings")).toBe("Settings");
  });

  it("falls back to Course Detail for any /courses/:id route", () => {
    expect(resolveCoreHeaderTitle("/courses/abc123")).toBe("Course Detail");
  });
});

describe("CoreHeaderActions", () => {
  it("renders the common action bundle: search and theme toggle, without the bug report (now in the Help tray)", () => {
    render(
      <ThemeProvider>
        <CoreHeaderActions />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: "Open command palette" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Switch to (dark|light) mode/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Report a bug" })).not.toBeInTheDocument();
  });

  it("carries the dashboard tour's theme-toggle anchor", () => {
    const { container } = render(
      <ThemeProvider>
        <CoreHeaderActions />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-tour="theme-toggle"]')).toBeInTheDocument();
  });

  it("carries the dashboard tour's AI-status anchor", () => {
    const { container } = render(
      <ThemeProvider>
        <CoreHeaderActions />
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-tour="ai-status"]')).toBeInTheDocument();
  });

  it("pins the page help slot after the common bundle, in the top-right corner (#1754)", () => {
    render(
      <ThemeProvider>
        <CoreHeaderActions help={<button type="button">Help slot</button>} />
      </ThemeProvider>,
    );
    const buttons = screen.getAllByRole("button");
    expect(buttons[buttons.length - 1]).toHaveTextContent("Help slot");
  });

  it("renders route-specific extraActions before the common bundle (e.g. chat's history toggle)", () => {
    render(
      <ThemeProvider>
        <CoreHeaderActions extraActions={<button type="button">Test Action</button>} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: "Test Action" })).toBeInTheDocument();
  });
});

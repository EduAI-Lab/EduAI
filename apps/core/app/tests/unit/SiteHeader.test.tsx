import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import { resolveCoreHeaderTitle, CoreHeaderActions } from "~/components/layout/core-app-shell";
import { ThemeProvider } from "@eduai/ui";

/**
 * Core's bespoke `~/components/site-header` was retired in favor of composing
 * the shared `@eduai/ui` `AppShell`/`SiteHeader` (issue #764 core-shell
 * parity). The GENERIC header rendering behavior this file used to cover
 * (title-as-h1, sr-only h1 alongside breadcrumbs, actions slot, breadcrumbs
 * slot) now lives in and is tested by the shared package itself
 * (`packages/ui/src/tests/site-header.test.tsx` and `app-shell.test.tsx`).
 *
 * What's left to cover HERE is Core-specific: the route → title fallback map
 * `CoreAppShell` resolves before handing a title to the shared shell (ported
 * verbatim from the old SiteHeader so no route's heading changed), and the
 * fixed header action bundle (`CoreHeaderActions`) every Core page renders.
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
  it("renders the common action bundle: search, theme toggle, bug report", () => {
    render(
      <ThemeProvider>
        <CoreHeaderActions />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: "Open command palette" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /switch to (dark|light) mode/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Report a bug" })).toBeInTheDocument();
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

  it("renders route-specific extraActions before the common bundle (e.g. chat's history toggle)", () => {
    render(
      <ThemeProvider>
        <CoreHeaderActions extraActions={<button type="button">Test Action</button>} />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: "Test Action" })).toBeInTheDocument();
  });
});

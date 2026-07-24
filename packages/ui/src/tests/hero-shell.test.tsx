import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HeroShell, HERO_GLASS_STYLE } from "../hero-shell";
import { DEFAULT_COURSE_PALETTE } from "../course-theme";

const ACCENT = DEFAULT_COURSE_PALETTE[0];

describe("HeroShell", () => {
  it("renders children inside the shell", () => {
    render(
      <HeroShell accentColor={ACCENT}>
        <span data-testid="content">Hello</span>
      </HeroShell>,
    );
    expect(screen.getByTestId("content")).toBeInTheDocument();
  });

  it("applies the accent-styled container classes", () => {
    const { container } = render(
      <HeroShell accentColor={ACCENT}>
        <span>content</span>
      </HeroShell>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("rounded-[var(--radius-xl)]");
    expect(root.className).toContain("text-white");
    expect(root.className).toContain("shadow-[0_8px_28px_var(--course-glow)]");
  });

  it("appends a custom className after the shell's own classes", () => {
    const { container } = render(
      <HeroShell accentColor={ACCENT} className="mt-4">
        <span>content</span>
      </HeroShell>,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.className).toContain("mt-4");
    expect(root.className).toContain("rounded-[var(--radius-xl)]");
  });

  it("applies course theme + hero background style variables inline", () => {
    const { container } = render(
      <HeroShell accentColor={ACCENT}>
        <span>content</span>
      </HeroShell>,
    );
    const root = container.firstElementChild as HTMLElement;
    // courseThemeVars sets custom properties inline (happy-dom's CSSOM can't
    // parse the color-mix()-based gradient from courseHeroBackgroundStyle, so
    // that half isn't independently observable here).
    const style = root.getAttribute("style") ?? "";
    expect(style).toContain("--course-accent");
    expect(root.style.getPropertyValue("--course-accent")).toBe(ACCENT);
  });

  it("exports HERO_GLASS_STYLE as a translucent-white glass style", () => {
    expect(HERO_GLASS_STYLE).toMatchObject({
      background: "rgba(255,255,255,0.16)",
      border: "1px solid rgba(255,255,255,0.28)",
    });
  });

  it("HERO_GLASS_STYLE can be applied to content laid over the shell", () => {
    render(
      <HeroShell accentColor={ACCENT}>
        <span data-testid="badge" style={HERO_GLASS_STYLE}>
          Badge
        </span>
      </HeroShell>,
    );
    const badge = screen.getByTestId("badge");
    expect(badge.style.background).toBe("rgba(255, 255, 255, 0.16)");
  });
});

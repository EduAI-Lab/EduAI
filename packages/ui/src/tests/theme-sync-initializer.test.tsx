import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const initThemeSync = vi.fn();
const closeThemeSync = vi.fn();
const broadcastThemeChange = vi.fn();

vi.mock("../lib/theme-sync", () => ({
  initThemeSync: (...args: unknown[]) => initThemeSync(...args),
  closeThemeSync: (...args: unknown[]) => closeThemeSync(...args),
  broadcastThemeChange: (...args: unknown[]) => broadcastThemeChange(...args),
}));

import { ThemeProvider, useTheme } from "../theme-provider";
import { ThemeSyncInitializer } from "../theme-sync-initializer";

function ThemeSwitcher() {
  const { setTheme } = useTheme();
  return (
    <button type="button" onClick={() => setTheme("dark")}>
      go dark
    </button>
  );
}

describe("ThemeSyncInitializer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // next-themes seeds its initial state from localStorage (key "theme"),
    // which happy-dom persists across tests in this file. Without clearing
    // it, a "dark" set by an earlier test leaks in as the next test's
    // starting theme, and clicking "go dark" again becomes a same-value
    // no-op that React bails out of (no re-render, no effect re-run).
    localStorage.clear();
  });

  it("initializes theme sync exactly once on mount", () => {
    render(
      <ThemeProvider>
        <ThemeSyncInitializer />
      </ThemeProvider>,
    );

    expect(initThemeSync).toHaveBeenCalledTimes(1);
    expect(initThemeSync).toHaveBeenCalledWith(expect.any(Function));
  });

  it("does not re-run init when the theme changes", () => {
    render(
      <ThemeProvider>
        <ThemeSyncInitializer />
        <ThemeSwitcher />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "go dark" }));

    // The mount-once effect (empty deps) must not re-fire on theme change —
    // this is the guard against the documented dark/light infinite-loop bug.
    expect(initThemeSync).toHaveBeenCalledTimes(1);
  });

  it("broadcasts the new theme when it changes", () => {
    render(
      <ThemeProvider>
        <ThemeSyncInitializer />
        <ThemeSwitcher />
      </ThemeProvider>,
    );
    // Clear any mount-time broadcast of the initial resolved theme so this
    // assertion is only about the change triggered by the click below.
    broadcastThemeChange.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "go dark" }));

    expect(broadcastThemeChange).toHaveBeenCalledWith("dark");
  });

  it("closes theme sync on unmount", () => {
    const { unmount } = render(
      <ThemeProvider>
        <ThemeSyncInitializer />
      </ThemeProvider>,
    );

    unmount();

    expect(closeThemeSync).toHaveBeenCalledTimes(1);
  });
});

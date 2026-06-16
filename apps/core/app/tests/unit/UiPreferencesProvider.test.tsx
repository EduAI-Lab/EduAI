import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  UiPreferencesProvider,
  useUiPreferences,
} from "~/components/assistive/ui-preferences-provider";

function Consumer() {
  const { motionReduced, density, theme, setMotionReduced, setDensity, setTheme } =
    useUiPreferences();
  return (
    <div>
      <span data-testid="motion">{motionReduced ? "on" : "off"}</span>
      <span data-testid="density">{density}</span>
      <span data-testid="theme">{theme}</span>
      <button type="button" onClick={() => setMotionReduced(true)}>
        motion-on
      </button>
      <button type="button" onClick={() => setDensity("compact")}>
        density-compact
      </button>
      <button type="button" onClick={() => setTheme("dark")}>
        theme-dark
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
  );
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.removeAttribute("data-reduce-motion");
  document.documentElement.removeAttribute("data-density");
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("light", "dark");
  document.documentElement.removeAttribute("data-reduce-motion");
  document.documentElement.removeAttribute("data-density");
});

describe("UiPreferencesProvider", () => {
  it("does not set non-default html hooks when defaults are used", () => {
    render(
      <UiPreferencesProvider
        initialMotionReduced={false}
        initialDensity="comfortable"
        initialTheme="system"
      >
        <Consumer />
      </UiPreferencesProvider>,
    );

    expect(document.documentElement.hasAttribute("data-reduce-motion")).toBe(false);
    expect(document.documentElement.hasAttribute("data-density")).toBe(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("sets html hooks for non-default motion, density, and theme", () => {
    render(
      <UiPreferencesProvider
        initialMotionReduced={true}
        initialDensity="compact"
        initialTheme="dark"
      >
        <Consumer />
      </UiPreferencesProvider>,
    );

    expect(document.documentElement.getAttribute("data-reduce-motion")).toBe("true");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("persists motion, density, and theme via PATCH /api/preferences", () => {
    render(
      <UiPreferencesProvider
        initialMotionReduced={false}
        initialDensity="comfortable"
        initialTheme="system"
      >
        <Consumer />
      </UiPreferencesProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "motion-on" }));
    fireEvent.click(screen.getByRole("button", { name: "density-compact" }));
    fireEvent.click(screen.getByRole("button", { name: "theme-dark" }));

    expect(fetch).toHaveBeenCalledWith(
      "/api/preferences",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ motionReduced: true }),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/preferences",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ density: "compact" }),
      }),
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/preferences",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ theme: "dark" }),
      }),
    );
  });

  it("useUiPreferences throws outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(
      "useUiPreferences must be used within a UiPreferencesProvider",
    );
    spy.mockRestore();
  });
});

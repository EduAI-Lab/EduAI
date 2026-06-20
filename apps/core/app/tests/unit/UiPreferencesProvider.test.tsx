import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  UiPreferencesProvider,
  useUiPreferences,
} from "~/components/assistive/ui-preferences-provider";

function Consumer() {
  const { motionReduced, density, setMotionReduced, setDensity } =
    useUiPreferences();
  return (
    <div>
      <span data-testid="motion">{motionReduced ? "on" : "off"}</span>
      <span data-testid="density">{density}</span>
      <button type="button" onClick={() => setMotionReduced(true)}>
        motion-on
      </button>
      <button type="button" onClick={() => setDensity("compact")}>
        density-compact
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
      >
        <Consumer />
      </UiPreferencesProvider>,
    );

    expect(document.documentElement.hasAttribute("data-reduce-motion")).toBe(false);
    expect(document.documentElement.hasAttribute("data-density")).toBe(false);
  });

  it("sets html hooks for non-default motion and density", () => {
    render(
      <UiPreferencesProvider
        initialMotionReduced={true}
        initialDensity="compact"
      >
        <Consumer />
      </UiPreferencesProvider>,
    );

    expect(document.documentElement.getAttribute("data-reduce-motion")).toBe("true");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
  });

  it("persists motion and density via PATCH /api/preferences", () => {
    render(
      <UiPreferencesProvider
        initialMotionReduced={false}
        initialDensity="comfortable"
      >
        <Consumer />
      </UiPreferencesProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "motion-on" }));
    fireEvent.click(screen.getByRole("button", { name: "density-compact" }));

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
  });

  it("useUiPreferences throws outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(
      "useUiPreferences must be used within a UiPreferencesProvider",
    );
    spy.mockRestore();
  });
});

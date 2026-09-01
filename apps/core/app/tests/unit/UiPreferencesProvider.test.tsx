import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  UiPreferencesProvider,
  useMotionReducedPreference,
  useUiPreferences,
} from "~/components/assistive/ui-preferences-provider";

/** Stubs `matchMedia` so the OS-level reduced-motion query answers `matches`. */
function stubSystemReducedMotion(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

function MotionProbe() {
  return <span data-testid="effective-motion">{useMotionReducedPreference() ? "on" : "off"}</span>;
}

function Consumer() {
  const { motionReduced, density, setMotionReduced, setDensity } = useUiPreferences();
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
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
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
      <UiPreferencesProvider initialMotionReduced={false} initialDensity="comfortable">
        <Consumer />
      </UiPreferencesProvider>,
    );

    expect(document.documentElement.hasAttribute("data-reduce-motion")).toBe(false);
    expect(document.documentElement.hasAttribute("data-density")).toBe(false);
  });

  it("sets html hooks for non-default motion and density", () => {
    render(
      <UiPreferencesProvider initialMotionReduced={true} initialDensity="compact">
        <Consumer />
      </UiPreferencesProvider>,
    );

    expect(document.documentElement.getAttribute("data-reduce-motion")).toBe("true");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
  });

  it("persists motion and density via PATCH /api/preferences", () => {
    render(
      <UiPreferencesProvider initialMotionReduced={false} initialDensity="comfortable">
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

/**
 * The account preference alone is not enough. Public pages are read by
 * signed-out visitors whose stored preference is the `false` default, so a
 * visitor who asked their OS for reduced motion has to be honoured through the
 * same hook every animated component already reads (WCAG 2.2.2).
 */
describe("useMotionReducedPreference", () => {
  it("reports reduced motion when the OS asks for it, whatever the account says", () => {
    stubSystemReducedMotion(true);

    render(
      <UiPreferencesProvider initialMotionReduced={false} initialDensity="comfortable">
        <MotionProbe />
      </UiPreferencesProvider>,
    );

    expect(screen.getByTestId("effective-motion")).toHaveTextContent("on");
  });

  it("reports reduced motion from the account preference when the OS does not ask", () => {
    stubSystemReducedMotion(false);

    render(
      <UiPreferencesProvider initialMotionReduced={true} initialDensity="comfortable">
        <MotionProbe />
      </UiPreferencesProvider>,
    );

    expect(screen.getByTestId("effective-motion")).toHaveTextContent("on");
  });

  it("reports full motion when neither signal asks to stop", () => {
    stubSystemReducedMotion(false);

    render(
      <UiPreferencesProvider initialMotionReduced={false} initialDensity="comfortable">
        <MotionProbe />
      </UiPreferencesProvider>,
    );

    expect(screen.getByTestId("effective-motion")).toHaveTextContent("off");
  });

  it("still reads the OS signal with no provider mounted", () => {
    stubSystemReducedMotion(true);

    render(<MotionProbe />);

    expect(screen.getByTestId("effective-motion")).toHaveTextContent("on");
  });
});

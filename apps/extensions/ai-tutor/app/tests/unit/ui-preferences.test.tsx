import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UiPreferencesProvider, useUiPreferences } from "~/components/settings/ui-preferences";

function reset() {
  document.documentElement.removeAttribute("data-density");
  document.documentElement.removeAttribute("data-reduce-motion");
  window.localStorage.clear();
}

beforeEach(reset);
afterEach(reset);

function Harness() {
  const { density, motionReduced, setDensity, setMotionReduced } = useUiPreferences();
  return (
    <div>
      <span data-testid="density">{density}</span>
      <span data-testid="motion">{String(motionReduced)}</span>
      <button onClick={() => setDensity("compact")}>compact</button>
      <button onClick={() => setDensity("comfortable")}>comfortable</button>
      <button onClick={() => setMotionReduced(true)}>reduce</button>
      <button onClick={() => setMotionReduced(false)}>allow</button>
    </div>
  );
}

const renderHarness = () =>
  render(
    <UiPreferencesProvider>
      <Harness />
    </UiPreferencesProvider>,
  );

const click = (name: string) => act(() => screen.getByRole("button", { name }).click());

/**
 * Density and reduce-motion were held only as `data-*` attributes on
 * `documentElement` and read back from there, so both were lost on reload while
 * theme and assistive mode survived. This provider is the fix, mirroring
 * `assistive-mode.tsx` (localStorage, not Core's `/api/preferences` — AI Tutor
 * is a client-only SPA with no preferences endpoint).
 */
describe("UiPreferencesProvider", () => {
  it("leaves both attributes absent at their default values", () => {
    renderHarness();

    expect(screen.getByTestId("density")).toHaveTextContent("comfortable");
    expect(screen.getByTestId("motion")).toHaveTextContent("false");
    // Absent, never ="false" — no selector may match the baseline state.
    expect(document.documentElement.hasAttribute("data-density")).toBe(false);
    expect(document.documentElement.hasAttribute("data-reduce-motion")).toBe(false);
  });

  it("sets the html hooks when the preferences are turned on", () => {
    renderHarness();

    click("compact");
    click("reduce");

    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    expect(document.documentElement.getAttribute("data-reduce-motion")).toBe("true");
  });

  it("removes the hooks again when they are turned back off", () => {
    renderHarness();
    click("compact");
    click("reduce");

    click("comfortable");
    click("allow");

    expect(document.documentElement.hasAttribute("data-density")).toBe(false);
    expect(document.documentElement.hasAttribute("data-reduce-motion")).toBe(false);
  });

  it("restores both preferences on a fresh mount — they survive a reload", () => {
    const first = renderHarness();
    click("compact");
    click("reduce");
    first.unmount();

    // A remount with the same localStorage is what a reload looks like here.
    renderHarness();

    expect(screen.getByTestId("density")).toHaveTextContent("compact");
    expect(screen.getByTestId("motion")).toHaveTextContent("true");
    expect(document.documentElement.getAttribute("data-density")).toBe("compact");
    expect(document.documentElement.getAttribute("data-reduce-motion")).toBe("true");
  });

  it("survives a localStorage that throws", () => {
    const getItem = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("denied");
    };

    expect(() => renderHarness()).not.toThrow();
    expect(screen.getByTestId("density")).toHaveTextContent("comfortable");

    window.localStorage.getItem = getItem;
  });
});

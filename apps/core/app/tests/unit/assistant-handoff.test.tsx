/**
 * #1824: the help page's "Ask a question" hand-off is hidden exactly when the
 * bubble is hidden — both go through `isAssistantVisible`, so this pins the
 * shared predicate and then checks the two surfaces agree for every gate state.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const rootData = vi.hoisted(() => ({
  current: { assistant: { mounted: true, docs: true } },
}));
vi.mock("react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router")>()),
  useRouteLoaderData: () => rootData.current,
}));
vi.mock("@eduai/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@eduai/ui")>()),
  useTour: () => ({ startTour: vi.fn() }),
}));

import { isAssistantVisible } from "~/lib/assistant/assistant-visibility";
import { HelpView } from "~/components/help/help-view";
import { HelpAssistant, useAssistantVisibility } from "~/components/assistant/help-assistant";
import { requestAssistantOpen } from "~/components/assistant/assistant-events";
import { resetAssistantStoreForTests } from "~/components/assistant/assistant-store";

afterEach(() => {
  cleanup();
  resetAssistantStoreForTests();
});

describe("isAssistantVisible — the shared predicate", () => {
  it.each([
    [{ mounted: false, docs: false }, null, false],
    [{ mounted: true, docs: true }, null, true],
    [{ mounted: true, docs: false }, null, false],
    [{ mounted: true, docs: false }, { materialScope: false }, false],
    [{ mounted: true, docs: false }, { materialScope: true }, true],
    [{ mounted: false, docs: true }, { materialScope: true }, false],
  ])("gate %j with published %j → %s", (gate, published, expected) => {
    expect(isAssistantVisible(gate, published)).toBe(expected);
  });
});

/** The help route's own wiring, reproduced: the hand-off follows the bubble's predicate. */
function HelpPageUnderTest() {
  const { visible } = useAssistantVisibility();
  return (
    <>
      <HelpView
        role="STUDENT"
        onAskAssistant={visible ? () => requestAssistantOpen() : undefined}
      />
      <HelpAssistant user={{ id: "u1", role: "STUDENT" }} />
    </>
  );
}

describe("help page hand-off", () => {
  it.each([
    { mounted: true, docs: true },
    { mounted: true, docs: false },
    { mounted: false, docs: false },
  ])("is shown exactly when the bubble is, for gate %j", (gate) => {
    rootData.current = { assistant: gate };
    render(
      <MemoryRouter initialEntries={["/help"]}>
        <HelpPageUnderTest />
      </MemoryRouter>,
    );
    const handOff = screen.queryByRole("button", { name: "Ask Penny a question" });
    const bubble = screen.queryByRole("button", { name: "Ask Penny, the help assistant" });
    expect(Boolean(handOff)).toBe(Boolean(bubble));
    expect(Boolean(handOff)).toBe(isAssistantVisible(gate, null));
  });

  it("opens the assistant with its question box focused", async () => {
    rootData.current = { assistant: { mounted: true, docs: true } };
    render(
      <MemoryRouter initialEntries={["/help"]}>
        <HelpPageUnderTest />
      </MemoryRouter>,
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Ask Penny a question" }));
    });
    const input = await screen.findByRole("textbox", { name: /Ask Penny a question/ });
    expect(document.activeElement).toBe(input);
  });
});

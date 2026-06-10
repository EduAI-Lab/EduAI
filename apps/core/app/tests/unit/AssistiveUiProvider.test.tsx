import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import {
  AssistiveUiProvider,
  useAssistiveUi,
} from "~/components/assistive/assistive-ui-provider";

function Consumer() {
  const { assistive, setAssistive } = useAssistiveUi();
  return (
    <button onClick={() => setAssistive(!assistive)}>{assistive ? "on" : "off"}</button>
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response("{}", { status: 200 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("data-assistive");
});

describe("AssistiveUiProvider", () => {
  it("does not set data-assistive when OFF (baseline is untouched)", () => {
    render(
      <AssistiveUiProvider initialAssistive={false}>
        <Consumer />
      </AssistiveUiProvider>,
    );
    expect(document.documentElement.hasAttribute("data-assistive")).toBe(false);
    expect(screen.getByRole("button")).toHaveTextContent("off");
  });

  it("sets data-assistive on <html> when ON", () => {
    render(
      <AssistiveUiProvider initialAssistive={true}>
        <Consumer />
      </AssistiveUiProvider>,
    );
    expect(document.documentElement.getAttribute("data-assistive")).toBe("true");
  });

  it("toggling ON adds the attribute and persists via /api/preferences", () => {
    render(
      <AssistiveUiProvider initialAssistive={false}>
        <Consumer />
      </AssistiveUiProvider>,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(document.documentElement.getAttribute("data-assistive")).toBe("true");
    expect(fetch).toHaveBeenCalledWith(
      "/api/preferences",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ assistDefault: true }),
      }),
    );
  });

  it("toggling OFF removes the attribute entirely (not set to 'false')", () => {
    render(
      <AssistiveUiProvider initialAssistive={true}>
        <Consumer />
      </AssistiveUiProvider>,
    );

    fireEvent.click(screen.getByRole("button"));

    expect(document.documentElement.hasAttribute("data-assistive")).toBe(false);
    expect(fetch).toHaveBeenCalledWith(
      "/api/preferences",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ assistDefault: false }),
      }),
    );
  });

  it("useAssistiveUi throws outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Consumer />)).toThrow(
      "useAssistiveUi must be used within an AssistiveUiProvider",
    );
    spy.mockRestore();
  });
});

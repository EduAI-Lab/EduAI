import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CommandSearchButton } from "../command-palette";

describe("CommandSearchButton", () => {
  it("calls onOpen when provided", () => {
    const onOpen = vi.fn();
    render(<CommandSearchButton onOpen={onOpen} />);
    fireEvent.click(screen.getByLabelText("Open command palette"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("dispatches the given window event when onOpen is absent", () => {
    const handler = vi.fn();
    window.addEventListener("test:open-command", handler);
    render(<CommandSearchButton eventName="test:open-command" />);
    fireEvent.click(screen.getByLabelText("Open command palette"));
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener("test:open-command", handler);
  });

  it("renders the label", () => {
    render(<CommandSearchButton label="Find" onOpen={() => {}} />);
    expect(screen.getByText("Find")).toBeInTheDocument();
  });
});

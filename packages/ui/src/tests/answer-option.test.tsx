import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AnswerOption } from "../answer-option";

describe("AnswerOption", () => {
  it("renders letter and text", () => {
    render(<AnswerOption letter="A">Amygdala</AnswerOption>);
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("Amygdala")).toBeInTheDocument();
  });

  it("renders as a static div when non-interactive", () => {
    render(<AnswerOption letter="A">Amygdala</AnswerOption>);
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("renders an interactive radio and fires onSelect", () => {
    const onSelect = vi.fn();
    render(
      <AnswerOption letter="B" state="selected" onSelect={onSelect}>
        Hippocampus
      </AnswerOption>,
    );
    const radio = screen.getByRole("radio");
    expect(radio).toHaveAttribute("aria-checked", "true");
    fireEvent.click(radio);
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("shows the correct-answer icon for the correct state", () => {
    const { container } = render(
      <AnswerOption letter="A" state="correct">
        Right
      </AnswerOption>,
    );
    // IconCircleCheckFilled renders an svg
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("does not fire onSelect when disabled", () => {
    const onSelect = vi.fn();
    render(
      <AnswerOption letter="C" disabled onSelect={onSelect}>
        Locked
      </AnswerOption>,
    );
    fireEvent.click(screen.getByRole("radio"));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

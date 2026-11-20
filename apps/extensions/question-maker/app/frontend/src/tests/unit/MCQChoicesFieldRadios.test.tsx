/**
 * `MCQChoicesField` radios layout (composer wizard): each row is a radio + letter + text +
 * remove; the correct row is labelled "Correct"; "+ Add choice" and "Allow more than one
 * correct answer" sit below the list and the old click-a-letter hint is gone.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MCQChoicesField } from "@/components/questions/MCQChoicesField";

afterEach(() => cleanup());

const choices = [
  { letter: "A", text: "One" },
  { letter: "B", text: "Two" },
  { letter: "C", text: "Three" },
];

describe("MCQChoicesField radios layout", () => {
  it("marks the correct answer with a radio and labels that row", () => {
    const onAnswerChange = vi.fn();
    render(
      <MCQChoicesField
        layout="radios"
        choices={choices}
        answer="B"
        onChoicesChange={vi.fn()}
        onAnswerChange={onAnswerChange}
        onSelectAllThatApplyChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("radio", { name: "Mark option B correct" })).toBeChecked();
    expect(screen.getAllByText("Correct")).toHaveLength(1);
    expect(screen.queryByText(/Click a letter/)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Mark option C correct" }));
    expect(onAnswerChange).toHaveBeenCalledWith("C");
    expect(screen.getByRole("button", { name: "+ Add choice" })).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Allow more than one correct answer" }),
    ).not.toBeChecked();
  });

  it("uses checkboxes when more than one correct answer is allowed", () => {
    const onCorrectAnswersChange = vi.fn();
    render(
      <MCQChoicesField
        layout="radios"
        choices={choices}
        answer="A"
        selectAllThatApply
        correctAnswers={["A"]}
        onChoicesChange={vi.fn()}
        onAnswerChange={vi.fn()}
        onSelectAllThatApplyChange={vi.fn()}
        onCorrectAnswersChange={onCorrectAnswersChange}
      />,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: "Mark option C correct" }));
    expect(onCorrectAnswersChange).toHaveBeenCalledWith(["A", "C"]);
  });

  it("removes a choice and re-letters the rest", () => {
    const onChoicesChange = vi.fn();
    render(
      <MCQChoicesField
        layout="radios"
        choices={choices}
        answer=""
        onChoicesChange={onChoicesChange}
        onAnswerChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove option A" }));
    expect(onChoicesChange).toHaveBeenCalledWith([
      { letter: "A", text: "Two" },
      { letter: "B", text: "Three" },
    ]);
  });
});

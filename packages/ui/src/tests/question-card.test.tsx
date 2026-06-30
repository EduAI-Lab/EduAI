import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QuestionCard } from "../question-card";

const choices = [
  { letter: "A", text: "Amygdala" },
  { letter: "B", text: "Hippocampus", correct: true },
  { letter: "C", text: "Hypothalamus" },
  { letter: "D", text: "Thalamus" },
];

describe("QuestionCard", () => {
  it("renders type, difficulty, status, label and question", () => {
    render(
      <QuestionCard
        type="Multiple Choice"
        difficulty="Medium"
        difficultyLevel="medium"
        ai
        label="Variant #2 of Question #5"
        status={{ label: "Reviewed" }}
        question="Which structure forms new episodic memories?"
        choices={choices}
        topics={["Neuroscience", "Memory"]}
        updatedLabel="Updated 2 days ago"
      />,
    );
    expect(screen.getByText("Multiple Choice")).toBeInTheDocument();
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("Reviewed")).toBeInTheDocument();
    expect(screen.getByText("Variant #2 of Question #5")).toBeInTheDocument();
    expect(screen.getByText("Which structure forms new episodic memories?")).toBeInTheDocument();
  });

  it("renders all choices and their letters", () => {
    render(<QuestionCard type="Multiple Choice" question="Q" choices={choices} />);
    expect(screen.getByText("Hippocampus")).toBeInTheDocument();
    expect(screen.getByText("Thalamus")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  it("renders topics and timestamp in the footer", () => {
    render(
      <QuestionCard
        type="Multiple Choice"
        question="Q"
        topics={["Neuroscience", "Memory"]}
        updatedLabel="Updated 2 days ago"
      />,
    );
    expect(screen.getByText("Neuroscience")).toBeInTheDocument();
    expect(screen.getByText("Updated 2 days ago")).toBeInTheDocument();
  });

  it("renders an answer block for non-MCQ questions", () => {
    render(<QuestionCard type="Short Answer" question="Q" answer="Sample answer text" />);
    expect(screen.getByText("Sample answer text")).toBeInTheDocument();
  });

  it("fires onHistory when the history button is clicked", () => {
    const onHistory = vi.fn();
    render(<QuestionCard type="Multiple Choice" question="Q" onHistory={onHistory} />);
    screen.getByRole("button", { name: "View history" }).click();
    expect(onHistory).toHaveBeenCalledOnce();
  });

  it("omits the AI chip when ai is false", () => {
    render(<QuestionCard type="Multiple Choice" question="Q" />);
    expect(screen.queryByText("AI")).not.toBeInTheDocument();
  });
});

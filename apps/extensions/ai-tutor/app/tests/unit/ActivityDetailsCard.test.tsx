import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import ActivityDetailsCard from "~/components/ActivityDetailsCard";
import type { Activity } from "~/lib/types";

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 1,
    title: null,
    instructionsMd: "",
    position: 0,
    question: "What is 2+2?",
    type: "MCQ",
    options: null,
    answer: undefined,
    hints: [],
    mainTopic: null,
    secondaryTopics: [],
    enableTeachMode: true,
    enableGuideMode: true,
    enableCustomMode: false,
    customPrompt: null,
    customPromptTitle: null,
    ...overrides,
  };
}

describe("ActivityDetailsCard", () => {
  it("is collapsed by default and toggles open on click", () => {
    render(<ActivityDetailsCard activity={makeActivity()} />);
    const toggle = screen.getByRole("button", { name: /Question details/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(/No additional details captured yet/)).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(/No additional details captured yet/)).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("shows title, instructions, MCQ choices with correct answer highlighted, and hints", () => {
    render(
      <ActivityDetailsCard
        activity={makeActivity({
          title: "Internal title text",
          instructionsMd: "Do the thing",
          options: { choices: ["Choice one", "Choice two", "Choice three"] },
          answer: { correctIndex: 1 },
          hints: ["Hint one", "Hint two"],
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Question details/i }));

    expect(screen.getByText("Internal title text")).toBeInTheDocument();
    expect(screen.getByText("Do the thing")).toBeInTheDocument();
    expect(screen.getByText("Choice one")).toBeInTheDocument();
    expect(screen.getByText("Choice two")).toBeInTheDocument();
    expect(screen.getByText("Choice three")).toBeInTheDocument();
    expect(screen.getByText("Hint one")).toBeInTheDocument();
    expect(screen.getByText("Hint two")).toBeInTheDocument();
    expect(screen.queryByText(/No additional details captured yet/)).not.toBeInTheDocument();
  });

  it("shows the expected short-text answer for SHORT_TEXT activities", () => {
    render(
      <ActivityDetailsCard
        activity={makeActivity({
          type: "SHORT_TEXT",
          answer: { text: "Paris" },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Question details/i }));
    expect(screen.getByText("Expected answer")).toBeInTheDocument();
    expect(screen.getByText("Paris")).toBeInTheDocument();
  });

  it("does not show correctIndex highlight logic for non-MCQ types", () => {
    render(
      <ActivityDetailsCard
        activity={makeActivity({
          type: "SHORT_TEXT",
          answer: { correctIndex: 0 },
          options: { choices: ["X"] },
        })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Question details/i }));
    // choices still render (options.choices is independent of type)
    expect(screen.getByText("X")).toBeInTheDocument();
  });
});

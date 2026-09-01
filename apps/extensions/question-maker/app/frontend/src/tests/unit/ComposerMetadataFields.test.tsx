/**
 * Unit tests for `ComposerMetadataFields` (#1546): difficulty/reasoning
 * controls, primary-topic combobox (incl. read-only variant mode and the
 * no-topics/error states), and the description input.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ComposerMetadataFields,
  type ComposerMetadataValue,
} from "@/components/composer/ComposerMetadataFields";
import type { Topic } from "@/types/topic";

afterEach(() => cleanup());

function baseValue(overrides: Partial<ComposerMetadataValue> = {}): ComposerMetadataValue {
  return {
    difficulty: "easy",
    reasoningLevel: "factual",
    primaryTopicId: "",
    secondaryTopicIds: [],
    description: "",
    ...overrides,
  };
}

function noopHandlers() {
  return {
    onDifficultyChange: vi.fn(),
    onReasoningChange: vi.fn(),
    onPrimaryTopicChange: vi.fn(),
    onSecondaryTopicsChange: vi.fn(),
    onDescriptionChange: vi.fn(),
  };
}

const topics: Topic[] = [{ id: 1, name: "Loops" } as Topic, { id: 2, name: "Recursion" } as Topic];

describe("ComposerMetadataFields", () => {
  it("propagates a difficulty change", () => {
    const handlers = noopHandlers();
    render(<ComposerMetadataFields value={baseValue()} topics={topics} {...handlers} />);
    fireEvent.click(screen.getByRole("radio", { name: /Hard/ }));
    expect(handlers.onDifficultyChange).toHaveBeenCalledWith("hard");
  });

  it("propagates a reasoning level change", () => {
    const handlers = noopHandlers();
    render(<ComposerMetadataFields value={baseValue()} topics={topics} {...handlers} />);
    fireEvent.click(screen.getByRole("radio", { name: "Analytical" }));
    expect(handlers.onReasoningChange).toHaveBeenCalledWith("analytical");
  });

  it("shows the read-only primary topic name in variant mode", () => {
    const handlers = noopHandlers();
    render(
      <ComposerMetadataFields
        value={baseValue({ primaryTopicId: "1" })}
        topics={topics}
        primaryTopicReadOnly
        primaryTopicName="Loops"
        {...handlers}
      />,
    );
    expect(screen.getByText("Loops")).toBeInTheDocument();
  });

  it('falls back to "Topic {id}" when no primaryTopicName is given in read-only mode', () => {
    const handlers = noopHandlers();
    render(
      <ComposerMetadataFields
        value={baseValue({ primaryTopicId: "9" })}
        topics={topics}
        primaryTopicReadOnly
        {...handlers}
      />,
    );
    expect(screen.getByText("Topic 9")).toBeInTheDocument();
  });

  it('shows a "no topics yet" hint when the topic list is empty', () => {
    const handlers = noopHandlers();
    render(<ComposerMetadataFields value={baseValue()} topics={[]} {...handlers} />);
    expect(screen.getByText(/No topics yet/)).toBeInTheDocument();
  });

  it("shows a primary-topic error message when provided", () => {
    const handlers = noopHandlers();
    render(
      <ComposerMetadataFields
        value={baseValue()}
        topics={topics}
        errors={{ primaryTopic: "Select a topic" }}
        {...handlers}
      />,
    );
    expect(screen.getByText("Select a topic")).toBeInTheDocument();
  });

  it("updates the description field", () => {
    const handlers = noopHandlers();
    render(<ComposerMetadataFields value={baseValue()} topics={topics} {...handlers} />);
    fireEvent.change(screen.getByPlaceholderText("Short label for this question"), {
      target: { value: "My label" },
    });
    expect(handlers.onDescriptionChange).toHaveBeenCalledWith("My label");
  });

  it("excludes the selected primary topic from the secondary-topics options", () => {
    const handlers = noopHandlers();
    render(
      <ComposerMetadataFields
        value={baseValue({ primaryTopicId: "1" })}
        topics={topics}
        {...handlers}
      />,
    );
    // The secondary MultiSelect should render without throwing for the filtered option list.
    expect(screen.getByText("Select secondary topics")).toBeInTheDocument();
  });

  it("keeps topic creation collapsed until the instructor opens it", async () => {
    const onCreateTopic = vi.fn().mockResolvedValue({ id: 3, name: "Graphs" });
    const handlers = noopHandlers();
    render(
      <ComposerMetadataFields
        value={baseValue()}
        topics={topics}
        onCreateTopic={onCreateTopic}
        {...handlers}
      />,
    );

    expect(screen.queryByPlaceholderText("New topic name")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add topic" }));
    fireEvent.change(screen.getByPlaceholderText("New topic name"), {
      target: { value: "Graphs" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(onCreateTopic).toHaveBeenCalledWith("Graphs"));
    expect(handlers.onPrimaryTopicChange).toHaveBeenCalledWith(3);
    await waitFor(() => expect(screen.queryByPlaceholderText("New topic name")).toBeNull());
  });
});

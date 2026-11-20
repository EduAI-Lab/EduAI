/**
 * Unit tests for the composer wizard's building blocks: stepper, start-method cards,
 * Details step, footer save options, AI panel and generated-draft list. Rendered with the
 * real design system; the composer page's own flow is covered in QuestionComposerPage.test.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router";

import { WizardStepper } from "@/components/composer/wizard/WizardStepper";
import { WizardMethodStep } from "@/components/composer/wizard/WizardMethodStep";
import { WizardDetailsStep } from "@/components/composer/wizard/WizardDetailsStep";
import { WizardFooter } from "@/components/composer/wizard/WizardFooter";
import { WizardAIPanel, appendToPrompt } from "@/components/composer/wizard/WizardAIPanel";
import { WizardDraftList } from "@/components/composer/wizard/WizardDraftList";

afterEach(() => cleanup());

const renderInRouter = (ui: ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("WizardStepper", () => {
  const labels: [string, string, string] = ["How to start", "Details", "Write question"];

  it("lets only completed steps be clicked", () => {
    const onSelect = vi.fn();
    render(<WizardStepper labels={labels} current={2} onSelect={onSelect} />);
    const step = (name: string) => screen.getByRole("button", { name: new RegExp(name) });
    expect(step("Details")).toHaveAttribute("aria-current", "step");
    expect(step("Details")).toBeDisabled();
    expect(step("Write question")).toBeDisabled();
    fireEvent.click(step("How to start"));
    expect(onSelect).toHaveBeenCalledWith(1);
  });
});

describe("WizardMethodStep", () => {
  it("offers write-it-myself and AI cards for a new question", () => {
    const onChange = vi.fn();
    render(<WizardMethodStep mode="question" value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: /Generate with AI/ }));
    expect(onChange).toHaveBeenCalledWith("ai");
    expect(screen.getByRole("radio", { name: /Write it myself/ })).toBeInTheDocument();
  });

  it("offers start-from-a-copy for a variant", () => {
    render(<WizardMethodStep mode="variant" value="manual" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /Start from a copy/ })).toBeChecked();
  });

  it("shows the AI status note inside the AI card only", () => {
    render(
      <WizardMethodStep
        mode="question"
        value={null}
        onChange={vi.fn()}
        aiStatusNote="UBC model offline"
      />,
    );
    expect(
      screen.getByRole("radio", { name: /Generate with AI/ }).closest("label"),
    ).toHaveTextContent("UBC model offline");
    expect(
      screen.getByRole("radio", { name: /Write it myself/ }).closest("label"),
    ).not.toHaveTextContent("UBC model offline");
  });
});

const detailsValue = {
  questionType: "MCQ" as const,
  primaryTopicId: "t1",
  secondaryTopicIds: [],
  description: "",
  difficulty: "easy" as const,
  reasoningLevel: "factual" as const,
};

describe("WizardDetailsStep", () => {
  it("lists difficulty and thinking-skill options with hints and reports changes", () => {
    const onChange = vi.fn();
    renderInRouter(
      <WizardDetailsStep
        mode="question"
        value={detailsValue}
        onChange={onChange}
        topics={[{ id: "t1", name: "Topic 1" } as never]}
      />,
    );
    const thinking = screen.getByRole("radiogroup", { name: /Thinking skill/ });
    expect(within(thinking).getByRole("radio", { name: /Recall/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(thinking).toHaveTextContent("Use the idea in a new situation or code");
    fireEvent.click(within(thinking).getByRole("radio", { name: /Apply/ }));
    expect(onChange).toHaveBeenCalledWith({ reasoningLevel: "application" });

    const difficulty = screen.getByRole("radiogroup", { name: /Difficulty/ });
    fireEvent.click(within(difficulty).getByRole("radio", { name: /Hard/ }));
    expect(onChange).toHaveBeenCalledWith({ difficulty: "hard" });
  });

  it("keeps secondary topics and the label in a closed More options disclosure", () => {
    renderInRouter(
      <WizardDetailsStep mode="question" value={detailsValue} onChange={vi.fn()} topics={[]} />,
    );
    const details = screen.getByText("More options").closest("details")!;
    expect(details).not.toHaveAttribute("open");
    expect(
      within(details).getByPlaceholderText("Leave blank to use the question's first line"),
    ).toBeInTheDocument();
  });

  it("shows format and topic read-only and marks the original values in variant mode", () => {
    renderInRouter(
      <WizardDetailsStep
        mode="variant"
        value={detailsValue}
        onChange={vi.fn()}
        topics={[]}
        original={{ topicName: "Topic 1", difficulty: "easy", reasoningLevel: "factual" }}
      />,
    );
    expect(screen.getByText("(same as the original)")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /Short answer/ })).toBeNull();
    expect(screen.getByText("Topic 1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add topic" })).toBeNull();
    const difficulty = screen.getByRole("radiogroup", { name: /Difficulty/ });
    expect(within(difficulty).getByRole("radio", { name: /Easy/ })).toHaveTextContent("(original)");
  });
});

describe("WizardFooter", () => {
  const baseProps = {
    onBack: vi.fn(),
    onCancel: vi.fn(),
    onPrimary: vi.fn(),
  };

  it("hides Back on step 1 and shows Continue without save options", () => {
    renderInRouter(<WizardFooter {...baseProps} showBack={false} primaryLabel="Continue" />);
    expect(screen.queryByRole("button", { name: "Back" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Draft" })).toBeNull();
  });

  it("enables sharing only when Reviewed is selected", () => {
    const onReviewedChange = vi.fn();
    const { rerender } = renderInRouter(
      <WizardFooter
        {...baseProps}
        showBack
        primaryLabel="Save question"
        saveOptions={{
          reviewed: false,
          share: false,
          canReview: true,
          onReviewedChange,
          onShareChange: vi.fn(),
        }}
      />,
    );
    expect(screen.getByRole("checkbox", { name: "Share with other EduAI tools" })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: "Reviewed" }));
    expect(onReviewedChange).toHaveBeenCalledWith(true);

    rerender(
      <MemoryRouter>
        <WizardFooter
          {...baseProps}
          showBack
          primaryLabel="Save question"
          saveOptions={{
            reviewed: true,
            share: false,
            canReview: true,
            onReviewedChange,
            onShareChange: vi.fn(),
          }}
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("checkbox", { name: "Share with other EduAI tools" })).toBeEnabled();
  });
});

describe("WizardAIPanel", () => {
  const panelProps = {
    prompt: "",
    onPromptChange: vi.fn(),
    questionCount: 1,
    onQuestionCountChange: vi.fn(),
    model: "gpt",
    onModelChange: vi.fn(),
    availableModels: [],
    status: "ok" as const,
    onRefreshStatus: vi.fn(),
    courseWarningMessage: null,
    providerApiKey: "",
    onProviderApiKeyChange: vi.fn(),
    onSaveProviderApiKey: vi.fn(),
    apiKeySaveState: "idle" as const,
    onGenerate: vi.fn(),
    isGenerating: false,
    hasGenerated: false,
  };

  it("appends quick-add text to the prompt on its own line", () => {
    expect(appendToPrompt("", "Make it harder.")).toBe("Make it harder.");
    expect(appendToPrompt("Loops  ", "Use a real-world example.")).toBe(
      "Loops\nUse a real-world example.",
    );
  });

  it("labels the prompt per mode and offers the matching quick-adds", () => {
    const onPromptChange = vi.fn();
    renderInRouter(
      <WizardAIPanel
        {...panelProps}
        mode="variant"
        prompt="Base"
        onPromptChange={onPromptChange}
      />,
    );
    expect(screen.getByLabelText("How should the variant differ?")).toBeInTheDocument();
    expect(screen.queryByText("How many")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "+ Harder" }));
    expect(onPromptChange).toHaveBeenCalledWith("Base\nMake it harder.");
  });

  it("steps the question count between 1 and 5 and switches Generate to Regenerate", () => {
    const onQuestionCountChange = vi.fn();
    const { rerender } = renderInRouter(
      <WizardAIPanel
        {...panelProps}
        mode="question"
        prompt="Loops"
        questionCount={5}
        onQuestionCountChange={onQuestionCountChange}
      />,
    );
    expect(screen.getByLabelText("What should the questions cover?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More questions" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Fewer questions" }));
    expect(onQuestionCountChange).toHaveBeenCalledWith(4);
    expect(screen.getByRole("button", { name: "Generate" })).toBeEnabled();

    rerender(
      <MemoryRouter>
        <WizardAIPanel {...panelProps} mode="question" prompt="Loops" hasGenerated />
      </MemoryRouter>,
    );
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeInTheDocument();
  });
});

describe("WizardDraftList", () => {
  const draft = {
    questionType: "MCQ" as const,
    questionText: "Pick one",
    choices: [
      { letter: "A", text: "Right" },
      { letter: "B", text: "Wrong" },
    ],
    answer: "A",
    selectAllThatApply: false,
    correctAnswers: [],
    keep: true,
  };

  it("highlights the correct choice and wires keep, edit and regenerate", () => {
    const onKeepChange = vi.fn();
    const onEdit = vi.fn();
    const onRegenerate = vi.fn();
    render(
      <WizardDraftList
        drafts={[draft, { ...draft, questionType: "SA", answer: "Because", keep: false }]}
        onKeepChange={onKeepChange}
        onEdit={onEdit}
        onRegenerate={onRegenerate}
      />,
    );
    const list = screen.getByRole("list", { name: "Generated drafts" });
    const [first, second] = Array.from(list.children) as HTMLElement[];
    expect(within(first).getByText("Right").closest("li")).toHaveTextContent("Correct");
    expect(within(first).getByText("Wrong").closest("li")).not.toHaveTextContent("Correct");
    expect(second).toHaveTextContent("Because");

    fireEvent.click(screen.getByRole("checkbox", { name: "Keep draft 1" }));
    expect(onKeepChange).toHaveBeenCalledWith(0, false);
    expect(screen.getByRole("checkbox", { name: "Keep draft 2" })).not.toBeChecked();
    fireEvent.click(within(second).getByRole("button", { name: /Edit/ }));
    expect(onEdit).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByRole("button", { name: "Regenerate draft 1" }));
    expect(onRegenerate).toHaveBeenCalledWith(0);
  });
});

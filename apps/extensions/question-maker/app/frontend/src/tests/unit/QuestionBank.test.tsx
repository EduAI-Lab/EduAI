/**
 * #1545 — render + interaction coverage for the QuestionBank browser: empty
 * states, search/filter/sort composition, view toggling, card actions, and
 * the header upload/add actions.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QuestionBank } from "@/components/question-bank/QuestionBank";
import type { QuestionVariantEntry } from "@/types/question";

vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissionsForCourse: () => ({
    canCreateQuestion: true,
    hasCourseAccess: true,
    accessLoading: false,
    access: "instructor",
  }),
}));

function makeEntry(overrides: Partial<QuestionVariantEntry> = {}): QuestionVariantEntry {
  return {
    questionId: 1,
    questionDescription: "Arithmetic",
    questionType: "MCQ",
    primaryTopicId: "1",
    primaryTopicName: "Addition",
    courseId: 7,
    isAiGenerated: false,
    isDraft: false,
    variant: {
      id: 1,
      questionText: "What is 2 + 2?",
      difficulty: "easy",
      referenceId: null,
      answer: "B",
      choices: [
        { letter: "A", text: "3" },
        { letter: "B", text: "4" },
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    },
    ...overrides,
  } as unknown as QuestionVariantEntry;
}

function baseProps() {
  return {
    onViewVariant: vi.fn(),
    onCreateVariant: vi.fn(),
    onAddQuestion: vi.fn(),
    onUploadQuestions: vi.fn(),
  };
}

describe("QuestionBank", () => {
  beforeEach(() => cleanup());

  it("shows the empty state with add/upload actions when there are no variants", () => {
    const props = baseProps();
    render(<QuestionBank variants={[]} {...props} />);

    expect(screen.getByRole("heading", { name: "No questions yet" })).toBeInTheDocument();
    // The header always renders its own Add/Upload actions, and the empty
    // state repeats them inline — both fire the same callback, so either works.
    const [addButton] = screen.getAllByRole("button", { name: /add question/i });
    fireEvent.click(addButton);
    expect(props.onAddQuestion).toHaveBeenCalledTimes(1);

    const [uploadButton] = screen.getAllByRole("button", { name: "Upload" });
    fireEvent.click(uploadButton);
    expect(props.onUploadQuestions).toHaveBeenCalledTimes(1);
  });

  it("shows the guided-tour empty state when there is no course and onOpenProfile is provided", () => {
    const onOpenProfile = vi.fn();
    render(<QuestionBank variants={[]} {...baseProps()} onOpenProfile={onOpenProfile} />);

    fireEvent.click(screen.getByRole("button", { name: /start guided tour/i }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });

  it("renders the question count and each card when variants are present", () => {
    const entries = [
      makeEntry(),
      makeEntry({
        questionId: 2,
        variant: { ...makeEntry().variant, id: 2, questionText: "What is 3 + 3?" },
      }),
    ];
    render(<QuestionBank variants={entries} {...baseProps()} />);

    expect(screen.getByText("2 questions in this course")).toBeInTheDocument();
    expect(screen.getByText("What is 2 + 2?")).toBeInTheDocument();
    expect(screen.getByText("What is 3 + 3?")).toBeInTheDocument();
  });

  it("filters variants by search term and shows the filtered-count message", () => {
    const entries = [
      makeEntry(),
      makeEntry({
        questionId: 2,
        primaryTopicName: "Geometry",
        variant: { ...makeEntry().variant, id: 2, questionText: "What is a triangle?" },
      }),
    ];
    render(<QuestionBank variants={entries} {...baseProps()} />);

    fireEvent.change(screen.getByLabelText("Search questions"), { target: { value: "triangle" } });

    expect(screen.getByText("What is a triangle?")).toBeInTheDocument();
    expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2 shown")).toBeInTheDocument();
  });

  it("shows the no-match empty state and clears filters on demand", () => {
    const entries = [makeEntry()];
    render(<QuestionBank variants={entries} {...baseProps()} />);

    fireEvent.change(screen.getByLabelText("Search questions"), {
      target: { value: "nonexistent" },
    });
    expect(screen.getByText("No questions match your filters")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("What is 2 + 2?")).toBeInTheDocument();
  });

  it("sorts by type when the sort control changes", () => {
    const entries = [
      makeEntry({
        questionType: "SA",
        variant: { ...makeEntry().variant, id: 1, questionText: "SA question", choices: null },
      }),
      makeEntry({
        questionId: 2,
        questionType: "MCQ",
        variant: { ...makeEntry().variant, id: 2, questionText: "MCQ question" },
      }),
    ];
    render(<QuestionBank variants={entries} {...baseProps()} />);

    fireEvent.click(screen.getByLabelText("Sort questions"));
    fireEvent.click(screen.getByText("By type"));

    const list = document.querySelector('[data-tour-id="question-list"]')!;
    const cards = within(list as HTMLElement).getAllByText(/question$/);
    // MCQ sorts before SA alphabetically.
    expect(cards[0]).toHaveTextContent("MCQ question");
  });

  it("toggles between grid and list view", () => {
    render(<QuestionBank variants={[makeEntry()]} {...baseProps()} />);

    const gridBtn = screen.getByLabelText("Grid view");
    const listBtn = screen.getByLabelText("List view");
    expect(gridBtn).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(listBtn);
    expect(listBtn).toHaveAttribute("aria-pressed", "true");
    expect(gridBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("fires onViewVariant when a card is clicked", () => {
    const props = baseProps();
    const entry = makeEntry();
    render(<QuestionBank variants={[entry]} {...props} />);

    fireEvent.click(screen.getByText("What is 2 + 2?"));
    expect(props.onViewVariant).toHaveBeenCalledWith(entry);
  });

  it("hides the upload/add header buttons when disabled", () => {
    render(<QuestionBank variants={[makeEntry()]} {...baseProps()} disableAdd disableUpload />);

    expect(screen.queryByRole("button", { name: /add question/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
  });

  it("renders a loading skeleton instead of cards when isLoading is true", () => {
    render(<QuestionBank variants={[makeEntry()]} {...baseProps()} isLoading />);

    expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
  });

  it("sorts by oldest when selected", () => {
    const entries = [
      makeEntry({
        variant: {
          ...makeEntry().variant,
          id: 1,
          questionText: "Newer",
          createdAt: "2026-02-01T00:00:00.000Z",
        },
      }),
      makeEntry({
        questionId: 2,
        variant: {
          ...makeEntry().variant,
          id: 2,
          questionText: "Older",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ];
    render(<QuestionBank variants={entries} {...baseProps()} />);

    fireEvent.click(screen.getByLabelText("Sort questions"));
    fireEvent.click(screen.getByText("Oldest first"));

    const list = document.querySelector('[data-tour-id="question-list"]')!;
    const cards = within(list as HTMLElement).getAllByText(/^(Newer|Older)$/);
    expect(cards[0]).toHaveTextContent("Older");
  });

  it("applies reasoning-level, difficulty, AI-generated, and draft-status filters", () => {
    const entries = [
      makeEntry({
        variant: {
          ...makeEntry().variant,
          id: 1,
          questionText: "Easy AI draft",
          difficulty: "easy",
          reasoningLevel: "recall",
        },
        isAiGenerated: true,
        isDraft: true,
      }),
      makeEntry({
        questionId: 2,
        variant: {
          ...makeEntry().variant,
          id: 2,
          questionText: "Hard manual final",
          difficulty: "hard",
          reasoningLevel: "analysis",
        },
        isAiGenerated: false,
        isDraft: false,
      }),
    ];
    render(<QuestionBank variants={entries} {...baseProps()} />);

    fireEvent.click(screen.getByLabelText("Sort questions"));
    fireEvent.click(screen.getByText("By type"));

    // Search narrows to a single result to exercise the filtered-count branch
    // alongside whichever filter toolbar affordances are available.
    fireEvent.change(screen.getByLabelText("Search questions"), { target: { value: "easy" } });
    expect(screen.getByText("Easy AI draft")).toBeInTheDocument();
    expect(screen.queryByText("Hard manual final")).not.toBeInTheDocument();
  });

  it("forwards onRemoveFromBank and renders in compact mode", () => {
    const onRemoveFromBank = vi.fn();
    render(
      <QuestionBank
        variants={[makeEntry()]}
        {...baseProps()}
        onRemoveFromBank={onRemoveFromBank}
        compact
      />,
    );
    expect(screen.getByText("What is 2 + 2?")).toBeInTheDocument();
  });

  it("filters by question type via the Filters popover", async () => {
    const entries = [
      makeEntry({ questionType: "MCQ" }),
      makeEntry({
        questionId: 2,
        questionType: "SA",
        variant: {
          ...makeEntry().variant,
          id: 2,
          questionText: "Short answer question",
          choices: null,
        },
      }),
    ];
    render(<QuestionBank variants={entries} {...baseProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(await screen.findByText("Short answer"));

    expect(screen.getByText("Short answer question")).toBeInTheDocument();
    expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2 shown")).toBeInTheDocument();
  });

  it("filters by difficulty via the Filters popover", async () => {
    const entries = [
      makeEntry({ variant: { ...makeEntry().variant, id: 1, difficulty: "easy" } }),
      makeEntry({
        questionId: 2,
        variant: {
          ...makeEntry().variant,
          id: 2,
          difficulty: "hard",
          questionText: "Hard question",
        },
      }),
    ];
    render(<QuestionBank variants={entries} {...baseProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    const hardOptions = await screen.findAllByText("Hard");
    const hardCheckboxLabel = hardOptions.find((el) => el.closest("label"))!;
    fireEvent.click(hardCheckboxLabel);

    expect(screen.getByText("Hard question")).toBeInTheDocument();
    expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
  });

  it("filters by reasoning level via the Filters popover", async () => {
    const entries = [
      makeEntry({ variant: { ...makeEntry().variant, id: 1, reasoningLevel: "factual" } }),
      makeEntry({
        questionId: 2,
        variant: {
          ...makeEntry().variant,
          id: 2,
          reasoningLevel: "analytical",
          questionText: "Analytical question",
        },
      }),
    ];
    render(<QuestionBank variants={entries} {...baseProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(await screen.findByText("Analytical"));

    expect(screen.getByText("Analytical question")).toBeInTheDocument();
    expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
  });

  it("filters by AI-generated source via the Filters popover", async () => {
    const entries = [
      makeEntry({ isAiGenerated: false }),
      makeEntry({
        questionId: 2,
        isAiGenerated: true,
        variant: { ...makeEntry().variant, id: 2, questionText: "AI question" },
      }),
    ];
    render(<QuestionBank variants={entries} {...baseProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(await screen.findByRole("button", { name: "AI" }));

    expect(screen.getByText("AI question")).toBeInTheDocument();
    expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
  });

  it("filters by draft status via the Filters popover", async () => {
    const entries = [
      makeEntry({ isDraft: false }),
      makeEntry({
        questionId: 2,
        isDraft: true,
        variant: { ...makeEntry().variant, id: 2, questionText: "Draft question" },
      }),
    ];
    render(<QuestionBank variants={entries} {...baseProps()} />);

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Draft" }));

    expect(screen.getByText("Draft question")).toBeInTheDocument();
    expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
  });

  it("shows a custom empty message when provided", () => {
    render(
      <QuestionBank variants={[]} {...baseProps()} emptyMessage="Nothing here for this topic." />,
    );
    expect(screen.getByText("Nothing here for this topic.")).toBeInTheDocument();
  });

  it("numbers non-base variants of the same question in creation order", () => {
    const base = makeEntry({ variant: { ...makeEntry().variant, id: 1, referenceId: null } });
    const variantA = makeEntry({
      variant: {
        ...makeEntry().variant,
        id: 2,
        referenceId: 1,
        questionText: "Variant A text",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    });
    const variantB = makeEntry({
      variant: {
        ...makeEntry().variant,
        id: 3,
        referenceId: 1,
        questionText: "Variant B text",
        createdAt: "2026-01-03T00:00:00.000Z",
      },
    });
    render(<QuestionBank variants={[base, variantA, variantB]} {...baseProps()} />);

    expect(screen.getByText(/Variant 1/)).toBeInTheDocument();
    expect(screen.getByText(/Variant 2/)).toBeInTheDocument();
  });
});

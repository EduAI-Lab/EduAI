/**
 * #1545 / #1762 — render + interaction coverage for the controlled QuestionBank
 * browser: empty states, server-total counts, variant-level narrowing inside the
 * server page, view toggling, card actions, and header upload/add actions.
 * Filtering/sorting/paging themselves are server-side (see the page tests).
 */
import { useState, type ComponentProps } from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { QuestionBank } from "@/components/question-bank/QuestionBank";
import {
  EMPTY_QUESTION_FILTERS,
  type QuestionFilters,
  type QuestionSort,
} from "@/components/question-bank/QuestionFilterToolbar";
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

type HarnessProps = Partial<ComponentProps<typeof QuestionBank>> & {
  variants: QuestionVariantEntry[];
  initialFilters?: QuestionFilters;
};

/** Holds the lifted state the way the pages do, reporting changes to optional spies. */
function Harness({ initialFilters, ...props }: HarnessProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filters, setFilters] = useState<QuestionFilters>(initialFilters ?? EMPTY_QUESTION_FILTERS);
  const [sortBy, setSortBy] = useState<QuestionSort>("newest");
  return (
    <QuestionBank
      onViewVariant={vi.fn()}
      onCreateVariant={vi.fn()}
      onAddQuestion={vi.fn()}
      onUploadQuestions={vi.fn()}
      total={props.variants.length}
      {...props}
      searchTerm={searchTerm}
      onSearchChange={(value) => {
        setSearchTerm(value);
        props.onSearchChange?.(value);
      }}
      filters={filters}
      onFiltersChange={(next) => {
        setFilters(next);
        props.onFiltersChange?.(next);
      }}
      sortBy={sortBy}
      onSortChange={(next) => {
        setSortBy(next);
        props.onSortChange?.(next);
      }}
    />
  );
}

describe("QuestionBank", () => {
  beforeEach(() => cleanup());

  it("shows the empty state with add/upload actions when there are no variants", () => {
    const onAddQuestion = vi.fn();
    const onUploadQuestions = vi.fn();
    render(
      <Harness variants={[]} onAddQuestion={onAddQuestion} onUploadQuestions={onUploadQuestions} />,
    );

    expect(screen.getByRole("heading", { name: "No questions yet" })).toBeInTheDocument();
    const [addButton] = screen.getAllByRole("button", { name: /add question/i });
    fireEvent.click(addButton);
    expect(onAddQuestion).toHaveBeenCalledTimes(1);

    const [uploadButton] = screen.getAllByRole("button", { name: "Upload" });
    fireEvent.click(uploadButton);
    expect(onUploadQuestions).toHaveBeenCalledTimes(1);
  });

  it("shows the guided-tour empty state when there is no course and onOpenProfile is provided", () => {
    const onOpenProfile = vi.fn();
    render(<Harness variants={[]} onOpenProfile={onOpenProfile} />);

    fireEvent.click(screen.getByRole("button", { name: /start guided tour/i }));
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
  });

  it("shows the server total and every card on the page", () => {
    const entries = [
      makeEntry(),
      makeEntry({
        questionId: 2,
        variant: { ...makeEntry().variant, id: 2, questionText: "What is 3 + 3?" },
      }),
    ];
    render(<Harness variants={entries} total={12} />);

    expect(screen.getByText("12 questions in this course")).toBeInTheDocument();
    expect(screen.getByText("What is 2 + 2?")).toBeInTheDocument();
    expect(screen.getByText("What is 3 + 3?")).toBeInTheDocument();
  });

  it("reports search changes and narrows the page's variants while the server catches up", () => {
    const onSearchChange = vi.fn();
    const entries = [
      makeEntry({ questionDescription: "Geometry" }),
      makeEntry({
        questionId: 2,
        questionDescription: "Shapes",
        variant: { ...makeEntry().variant, id: 2, questionText: "What is a triangle?" },
      }),
    ];
    render(<Harness variants={entries} total={2} onSearchChange={onSearchChange} />);

    fireEvent.change(screen.getByLabelText("Search questions"), { target: { value: "triangle" } });

    expect(onSearchChange).toHaveBeenCalledWith("triangle");
    expect(screen.getByText("What is a triangle?")).toBeInTheDocument();
    expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
    expect(screen.getByText("2 matching")).toBeInTheDocument();
  });

  it("shows the no-match empty state and clears search and filters on demand", () => {
    render(<Harness variants={[makeEntry()]} />);

    fireEvent.change(screen.getByLabelText("Search questions"), {
      target: { value: "nonexistent" },
    });
    expect(screen.getByText("No questions match your filters")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByText("What is 2 + 2?")).toBeInTheDocument();
  });

  it("keeps the toolbar when active filters leave the page empty", () => {
    render(
      <Harness
        variants={[]}
        total={0}
        initialFilters={{ ...EMPTY_QUESTION_FILTERS, difficulties: ["hard"] }}
      />,
    );

    expect(screen.getByLabelText("Search questions")).toBeInTheDocument();
    expect(screen.getByText("No questions match your filters")).toBeInTheDocument();
  });

  it("reports sort changes without reordering the server page", () => {
    const onSortChange = vi.fn();
    const entries = [
      makeEntry({ variant: { ...makeEntry().variant, id: 1, questionText: "First" } }),
      makeEntry({
        questionId: 2,
        variant: { ...makeEntry().variant, id: 2, questionText: "Second" },
      }),
    ];
    render(<Harness variants={entries} onSortChange={onSortChange} />);

    fireEvent.click(screen.getByLabelText("Sort questions"));
    fireEvent.click(screen.getByText("Oldest first"));

    expect(onSortChange).toHaveBeenCalledWith("oldest");
    const list = document.querySelector('[data-tour-id="question-list"]') as HTMLElement;
    const cards = within(list).getAllByText(/^(First|Second)$/);
    expect(cards[0]).toHaveTextContent("First");
  });

  it("leaves question-type filtering to the server", async () => {
    const onFiltersChange = vi.fn();
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
    render(<Harness variants={entries} onFiltersChange={onFiltersChange} />);

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(await screen.findByText("Short answer"));

    expect(onFiltersChange).toHaveBeenCalledWith({
      ...EMPTY_QUESTION_FILTERS,
      questionTypes: ["SA"],
    });
    expect(screen.getByText("Short answer question")).toBeInTheDocument();
    expect(screen.getByText("What is 2 + 2?")).toBeInTheDocument();
  });

  it("hides variants that fail the difficulty filter", async () => {
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
    render(<Harness variants={entries} />);

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    const hardOptions = await screen.findAllByText("Hard");
    fireEvent.click(hardOptions.find((el) => el.closest("label"))!);

    expect(screen.getByText("Hard question")).toBeInTheDocument();
    expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
  });

  it("hides variants that fail the reasoning-level filter", async () => {
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
    render(<Harness variants={entries} />);

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(await screen.findByText("Analytical"));

    expect(screen.getByText("Analytical question")).toBeInTheDocument();
    expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
  });

  it("hides variants that fail the AI-generated filter", async () => {
    const entries = [
      makeEntry({ isAiGenerated: false }),
      makeEntry({
        questionId: 2,
        isAiGenerated: true,
        variant: { ...makeEntry().variant, id: 2, questionText: "AI question" },
      }),
    ];
    render(<Harness variants={entries} />);

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(await screen.findByRole("button", { name: "AI" }));

    expect(screen.getByText("AI question")).toBeInTheDocument();
    expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
  });

  it("hides variants that fail the draft-status filter", async () => {
    const entries = [
      makeEntry({ isDraft: false }),
      makeEntry({
        questionId: 2,
        isDraft: true,
        variant: { ...makeEntry().variant, id: 2, questionText: "Draft question" },
      }),
    ];
    render(<Harness variants={entries} />);

    fireEvent.click(screen.getByRole("button", { name: /filters/i }));
    fireEvent.click(await screen.findByRole("button", { name: "Draft" }));

    expect(screen.getByText("Draft question")).toBeInTheDocument();
    expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
  });

  it("passes bank options through to the toolbar", () => {
    render(
      <Harness variants={[makeEntry()]} bankOptions={[{ value: "b1", label: "Course bank" }]} />,
    );
    expect(screen.getByLabelText("Filter by bank")).toBeInTheDocument();
  });

  it("toggles between grid and list view", () => {
    render(<Harness variants={[makeEntry()]} />);

    const gridBtn = screen.getByLabelText("Grid view");
    const listBtn = screen.getByLabelText("List view");
    expect(gridBtn).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(listBtn);
    expect(listBtn).toHaveAttribute("aria-pressed", "true");
    expect(gridBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("fires onViewVariant when a card is clicked", () => {
    const onViewVariant = vi.fn();
    const entry = makeEntry();
    render(<Harness variants={[entry]} onViewVariant={onViewVariant} />);

    fireEvent.click(screen.getByText("What is 2 + 2?"));
    expect(onViewVariant).toHaveBeenCalledWith(entry);
  });

  it("hides the upload/add header buttons when disabled", () => {
    render(<Harness variants={[makeEntry()]} disableAdd disableUpload />);

    expect(screen.queryByRole("button", { name: /add question/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload" })).not.toBeInTheDocument();
  });

  it("renders a loading skeleton instead of cards when isLoading is true", () => {
    render(<Harness variants={[makeEntry()]} isLoading />);
    expect(screen.queryByText("What is 2 + 2?")).not.toBeInTheDocument();
  });

  it("forwards onRemoveFromBank and renders in compact mode", () => {
    render(<Harness variants={[makeEntry()]} onRemoveFromBank={vi.fn()} compact />);
    expect(screen.getByText("What is 2 + 2?")).toBeInTheDocument();
  });

  it("shows a custom empty message when provided", () => {
    render(<Harness variants={[]} emptyMessage="Nothing here for this topic." />);
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
    render(<Harness variants={[base, variantA, variantB]} />);

    expect(screen.getByText(/Variant 1/)).toBeInTheDocument();
    expect(screen.getByText(/Variant 2/)).toBeInTheDocument();
  });
});

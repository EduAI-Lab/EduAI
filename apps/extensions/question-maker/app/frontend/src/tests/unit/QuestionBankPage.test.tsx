/**
 * Unit tests for QuestionBankPage (#1544): loading/error/empty states, filter
 * summary line, row rendering, and clear-filters behavior. `useAllQuestions`
 * and `useDisplayCourses` are mocked; the shared list/preview components
 * render for real.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const { useAllQuestionsMock, useDisplayCoursesMock, listBanksMock } = vi.hoisted(() => ({
  useAllQuestionsMock: vi.fn(),
  useDisplayCoursesMock: vi.fn(),
  listBanksMock: vi.fn(),
}));

vi.mock("@/hooks/useAllQuestions", () => ({
  useAllQuestions: (...a: any[]) => useAllQuestionsMock(...a),
}));
vi.mock("@/hooks/useDisplayCourses", () => ({ useDisplayCourses: () => useDisplayCoursesMock() }));
vi.mock("@/services/questionBankService", () => ({
  questionBankService: { listBanks: (...a: any[]) => listBanksMock(...a) },
}));

import QuestionBankPage from "@/pages/QuestionBankPage";

afterEach(cleanup);

function setup(
  overrides: Partial<{
    questions: any[];
    total: number;
    isLoading: boolean;
    error: string | null;
  }> = {},
) {
  useAllQuestionsMock.mockReturnValue({
    questions: overrides.questions ?? [],
    total: overrides.total ?? 0,
    isLoading: overrides.isLoading ?? false,
    error: overrides.error ?? null,
  });
  useDisplayCoursesMock.mockReturnValue({
    displayCourses: [{ id: 1, code: "COSC101", name: "Intro" }],
  });
  listBanksMock.mockResolvedValue([
    { id: "b1", courseId: 1, name: "Course bank", isDefault: true },
    { id: "b2", courseId: 1, name: "Midterm", isDefault: false },
  ]);
}

describe("QuestionBankPage", () => {
  it("shows a loading skeleton while questions load", () => {
    setup({ isLoading: true });
    render(
      <MemoryRouter>
        <QuestionBankPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Question Library")).toBeInTheDocument();
  });

  it("shows an error empty state on failure", () => {
    setup({ error: "Network error" });
    render(
      <MemoryRouter>
        <QuestionBankPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Couldn't load questions")).toBeInTheDocument();
    expect(screen.getByText("Network error")).toBeInTheDocument();
  });

  it("shows the empty-library state when there are no questions and no filters", () => {
    setup({ questions: [], total: 0 });
    render(
      <MemoryRouter>
        <QuestionBankPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Your library is empty")).toBeInTheDocument();
  });

  it("renders question rows and the summary line when questions exist", () => {
    setup({
      questions: [
        {
          id: 1,
          type: "MCQ",
          courseId: 1,
          description: "What is 2+2?",
          course: { code: "COSC101" },
          variants: [
            {
              questionText: "What is 2+2?",
              difficulty: "easy",
              isAiGenerated: true,
              isDraft: false,
            },
          ],
        },
      ],
      total: 1,
    });
    render(
      <MemoryRouter>
        <QuestionBankPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
    expect(screen.getByText(/1 matching question/)).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
  });

  it("opens the preview sheet when a row is clicked", () => {
    setup({
      questions: [
        {
          id: 2,
          type: "SA",
          courseId: 1,
          description: "Explain gravity",
          course: { code: "COSC101" },
          variants: [],
        },
      ],
      total: 1,
    });
    render(
      <MemoryRouter>
        <QuestionBankPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Explain gravity"));
    // Preview sheet renders (dialog role) once opened.
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it("clears filters via the clear-filters button in the no-match state", () => {
    setup({ questions: [], total: 0 });
    render(
      <MemoryRouter>
        <QuestionBankPage />
      </MemoryRouter>,
    );
    const searchInput = screen.getByPlaceholderText(/search/i);
    fireEvent.change(searchInput, { target: { value: "xyz" } });
    expect(screen.getByText("No questions match your filters")).toBeInTheDocument();
    fireEvent.click(screen.getAllByText("Clear filters")[0]);
    expect((searchInput as HTMLInputElement).value).toBe("");
  });

  const lastHookArgs = () => useAllQuestionsMock.mock.calls.at(-1)?.[0];

  function renderLibrary() {
    render(
      <MemoryRouter>
        <QuestionBankPage />
      </MemoryRouter>,
    );
  }

  it("disables the bank filter until a course is picked", () => {
    setup();
    renderLibrary();

    expect(screen.getByLabelText("Filter by bank")).toBeDisabled();
    expect(screen.getByText("Pick a course to filter by bank")).toBeInTheDocument();
    expect(listBanksMock).not.toHaveBeenCalled();
  });

  it("loads the picked course's banks and filters the library by bank", async () => {
    setup();
    renderLibrary();

    fireEvent.click(screen.getByLabelText("Filter by course"));
    fireEvent.click(screen.getByText("COSC101"));
    await waitFor(() => expect(listBanksMock).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.getByLabelText("Filter by bank")).toBeEnabled());

    fireEvent.click(screen.getByLabelText("Filter by bank"));
    fireEvent.click(screen.getByText("Midterm"));

    await waitFor(() =>
      expect(lastHookArgs()).toMatchObject({
        courseId: 1,
        filters: expect.objectContaining({ questionBankId: "b2" }),
      }),
    );
  });

  it("clears the bank when the course changes", async () => {
    setup();
    renderLibrary();

    fireEvent.click(screen.getByLabelText("Filter by course"));
    fireEvent.click(screen.getByText("COSC101"));
    await waitFor(() => expect(screen.getByLabelText("Filter by bank")).toBeEnabled());
    fireEvent.click(screen.getByLabelText("Filter by bank"));
    fireEvent.click(screen.getByText("Midterm"));
    await waitFor(() => expect(lastHookArgs().filters.questionBankId).toBe("b2"));

    fireEvent.click(screen.getByLabelText("Filter by course"));
    fireEvent.click(
      screen.getByText("All courses", { selector: "[role=option] *, [role=option]" }),
    );

    await waitFor(() => expect(lastHookArgs().filters.questionBankId).toBeNull());
    expect(lastHookArgs().courseId).toBeUndefined();
  });
});

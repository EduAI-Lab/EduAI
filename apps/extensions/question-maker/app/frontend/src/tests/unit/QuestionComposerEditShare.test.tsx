/**
 * @vitest-environment jsdom
 *
 * #1652 review: the composer's edit branch sent `isDraft` and content but not
 * `shareWithExtensions`, so an instructor who ticked both boxes while
 * re-approving an edited draft silently saved it unshared.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { QuestionComposerPage } from "../../pages/QuestionComposerPage";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: vi.fn() }) }));

vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissionsForCourse: () => ({
    canManageCanvas: true,
    canApproveVariant: true,
    canCreateQuestion: true,
    canEditResource: () => true,
    canDeleteResource: () => true,
    hasCourseAccess: true,
    accessLoading: false,
    courseAccess: { level: "instructor" },
  }),
}));

vi.mock("@/hooks/useEduAIStatus", () => ({
  useEduAIStatus: () => ({
    isConnected: false,
    isLoading: false,
    setQuestionGenerationPhase: vi.fn(),
  }),
}));

vi.mock("@/services/questionService", () => ({
  questionService: {
    getQuestion: vi.fn(),
    updateVariant: vi.fn(),
    updateQuestion: vi.fn(),
    createQuestion: vi.fn(),
    createVariant: vi.fn(),
  },
}));

vi.mock("@/services/courseService", () => ({
  courseService: {
    getCourse: vi.fn().mockResolvedValue({ id: 9, code: "CS 101" }),
    getCourses: vi.fn().mockResolvedValue([]),
    getCourseTopics: vi
      .fn()
      .mockResolvedValue([
        { id: "topic_cuid_1", name: "Topic A", courseId: 9, createdAt: "", updatedAt: "" },
      ]),
  },
}));

vi.mock("@/services/eduaiService", () => ({
  default: {
    getModels: vi.fn().mockResolvedValue([]),
    getCourses: vi.fn().mockResolvedValue([]),
    generateQuestion: vi.fn(),
  },
}));

vi.mock("@/services/apiKeyStorage", () => ({
  apiKeyStorage: {
    getKeys: vi.fn().mockReturnValue({}),
    hasAnyKey: vi.fn().mockReturnValue(false),
    getProviderFromModel: vi.fn().mockReturnValue(null),
    getKey: vi.fn().mockReturnValue(null),
    setKey: vi.fn(),
    requiresApiKey: vi.fn().mockReturnValue(false),
  },
}));

import { questionService } from "@/services/questionService";

/** A draft variant under edit: re-approving it is the case that lost the flag. */
const draftQuestion = {
  id: 42,
  type: "SA" as const,
  description: "Stable sorts",
  courseId: 9,
  primaryTopicId: "topic_cuid_1",
  variants: [
    {
      id: 77,
      questionText: "Define a stable sort",
      difficulty: "medium" as const,
      reasoningLevel: "factual" as const,
      answer: "Preserves order",
      choices: null,
      selectAllThatApply: false,
      correctAnswers: null,
      secondaryTopicsId: [],
      isDraft: true,
    },
  ],
};

function renderEditRoute() {
  return render(
    <MemoryRouter initialEntries={["/courses/9/questions/42/edit"]}>
      <Routes>
        <Route
          path="/courses/:courseId/questions/:questionId/edit"
          element={<QuestionComposerPage />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.mocked(questionService.getQuestion).mockResolvedValue(draftQuestion as never);
  vi.mocked(questionService.updateVariant).mockResolvedValue({ id: 77 } as never);
  vi.mocked(questionService.updateQuestion).mockResolvedValue({ id: 42 } as never);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("QuestionComposerPage edit-mode sharing", () => {
  it("sends the share choice with the write that approves an edited draft", async () => {
    renderEditRoute();

    await screen.findByTestId("share-with-extensions");
    fireEvent.click(document.getElementById("composer-mark-reviewed")!);
    const share = screen.getByTestId("share-with-extensions");
    fireEvent.click(share);
    expect(share).toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(questionService.updateVariant).toHaveBeenCalled());
    const [variantId, payload] = vi.mocked(questionService.updateVariant).mock.calls[0];
    expect(variantId).toBe(77);
    expect(payload.isDraft).toBe(false);
    expect(payload.shareWithExtensions).toBe(true);
  });

  it("omits the share choice on an edit that leaves the variant a draft", async () => {
    renderEditRoute();

    await screen.findByTestId("share-with-extensions");
    fireEvent.click(screen.getByRole("button", { name: /Save changes/i }));

    await waitFor(() => expect(questionService.updateVariant).toHaveBeenCalled());
    const [, payload] = vi.mocked(questionService.updateVariant).mock.calls[0];
    // Sharing is meaningless on a draft, and the server forces it false anyway.
    expect(payload).not.toHaveProperty("shareWithExtensions");
  });
});

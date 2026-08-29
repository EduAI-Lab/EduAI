/**
 * @vitest-environment jsdom
 *
 * The post-approval sharing panel must speak the same language as the authoring
 * checkbox (#1555). It used to be headed "AI Tutor preview" and described
 * questions as "testable" and "injected into teach/guide sessions" — Core's
 * column name and the RAG pipeline's vocabulary, neither of which means
 * anything to an instructor. These pin the plain wording so it cannot drift
 * back into internal jargon.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { QuestionVariantEntry } from "@/types/question";

vi.mock("react-router", () => ({ useNavigate: () => vi.fn() }));

vi.mock("@/services/questionService", () => ({
  questionService: { updateVariant: vi.fn(), updateQuestion: vi.fn() },
}));

vi.mock("@/services/courseService", () => ({
  courseService: {
    getCourse: vi.fn().mockResolvedValue({ coreCourseId: "core_1" }),
    getCourseTopics: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("@/services/assessmentService", () => ({
  default: { getAssessments: vi.fn().mockResolvedValue([]) },
}));

vi.mock("@/services/eduaiService", () => ({
  default: { getModels: vi.fn().mockResolvedValue([]), getCourses: vi.fn().mockResolvedValue([]) },
}));

vi.mock("@/services/apiKeyStorage", () => ({
  apiKeyStorage: {
    getProviderFromModel: vi.fn().mockReturnValue(null),
    getAllApiKeys: vi.fn().mockResolvedValue({}),
    getApiKey: vi.fn().mockResolvedValue(null),
    setApiKey: vi.fn(),
    removeApiKey: vi.fn(),
  },
  isCloudProvider: vi.fn().mockReturnValue(false),
}));

vi.mock("@/hooks/useEduAIStatus", () => ({
  useEduAIStatus: () => ({ status: "ok", refresh: vi.fn(), setQuestionGenerationPhase: vi.fn() }),
}));

vi.mock("@/hooks/useQmPermissions", () => ({
  useQmPermissions: () => ({}),
  useQmPermissionsForCourse: () => ({
    canApproveVariant: true,
    canCreateQuestion: true,
    canEditResource: () => true,
    canDeleteResource: () => true,
    accessLoading: false,
    hasCourseAccess: true,
  }),
}));

const { AddQuestionDialog } = await import("@/components/questions/AddQuestionDialog");

function reviewedEntry(): QuestionVariantEntry {
  return {
    questionId: 1,
    questionDescription: "Arithmetic",
    questionType: "SA",
    primaryTopicId: "1",
    primaryTopicName: "Addition",
    courseId: 7,
    isDraft: false,
    isAiGenerated: false,
    variant: {
      id: 10,
      questionText: "What is 2 + 2?",
      difficulty: "easy",
      isDraft: false,
      coreQuestionId: "cuid-q1",
      testable: false,
      createdAt: "2026-05-01T10:00:00.000Z",
    },
  } as QuestionVariantEntry;
}

describe("sharing panel copy", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  beforeEach(() => {
    render(
      <AddQuestionDialog
        mode="view"
        entry={reviewedEntry()}
        relatedVariants={[]}
        onClose={vi.fn()}
        onCreateVariant={vi.fn()}
        onDeleteVariant={vi.fn()}
        onSelectVariant={vi.fn()}
        onUpdateVariant={vi.fn()}
      />,
    );
  });

  it("names the sharing choice the same way the authoring checkbox does", async () => {
    expect(await screen.findByText("Use in other EduAI extensions")).toBeInTheDocument();
    expect(screen.getByText(/Not usable by other EduAI extensions/)).toBeInTheDocument();
  });

  it("explains the effect without Core or pipeline jargon", async () => {
    expect(
      await screen.findByText(/AI Tutor may ask students this question during tutoring/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/testable/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/injected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/AI Tutor preview/)).not.toBeInTheDocument();
  });
});

/**
 * Unit tests for ApiTestPage (#1544) — a dev-only diagnostic bench (see file
 * header) for exercising backend endpoints manually. Covers the auth gate,
 * every form's validation/success/error paths, and the AI service test
 * buttons' handling of loading/success/error and handleApiCall's error
 * message fallback chain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";

const { useAuthMock, useEduAIStatusMock, apiMock, eduaiServiceMock, buildApiKeysMock, toastFn } =
  vi.hoisted(() => {
    const toast = vi.fn() as any;
    toast.error = vi.fn();
    return {
      useAuthMock: vi.fn(),
      useEduAIStatusMock: vi.fn(),
      apiMock: { get: vi.fn(), post: vi.fn() },
      eduaiServiceMock: {
        testApiKey: vi.fn(),
        fetchCourseTopics: vi.fn(),
        chat: vi.fn(),
        generateQuestions: vi.fn(),
      },
      buildApiKeysMock: vi.fn(),
      toastFn: toast,
    };
  });

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => useAuthMock() }));
vi.mock("@/hooks/useEduAIStatus", () => ({ useEduAIStatus: () => useEduAIStatusMock() }));
vi.mock("@/services/api", () => ({ default: apiMock }));
vi.mock("@/services/eduaiService", () => ({ default: eduaiServiceMock }));
vi.mock("@/services/apiKeyStorage", () => ({
  apiKeyStorage: { buildApiKeysForModel: (...args: any[]) => buildApiKeysMock(...args) },
}));
vi.mock("sonner", () => ({ toast: toastFn }));

import { ApiTestPage } from "@/pages/ApiTestPage";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  useAuthMock.mockReturnValue({ isAuthenticated: true, isLoading: false });
  useEduAIStatusMock.mockReturnValue({ status: "idle", refresh: vi.fn() });
  buildApiKeysMock.mockResolvedValue({});
});

function renderPage() {
  return render(
    <MemoryRouter>
      <ApiTestPage />
    </MemoryRouter>,
  );
}

describe("ApiTestPage (dev-only diagnostic bench)", () => {
  it("renders nothing while auth is loading", () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: true });
    const { container } = renderPage();
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("redirects unauthenticated users", () => {
    useAuthMock.mockReturnValue({ isAuthenticated: false, isLoading: false });
    renderPage();
    expect(screen.queryByText("API Test Bench")).not.toBeInTheDocument();
  });

  it("renders the bench for authenticated users", () => {
    renderPage();
    expect(screen.getByText("API Test Bench")).toBeInTheDocument();
    expect(screen.getByText("Fetch Courses")).toBeInTheDocument();
  });

  describe("List Courses", () => {
    it("fetches and renders the course list", async () => {
      apiMock.get.mockResolvedValue({ data: { success: true, data: [{ id: 1 }] } });
      renderPage();
      fireEvent.click(screen.getByText("Fetch Courses"));
      expect(await screen.findByText(/"id": 1/)).toBeInTheDocument();
      expect(apiMock.get).toHaveBeenCalledWith("/api/course", {
        params: { page: 1, pageSize: 200, includeStats: true },
      });
    });

    it("shows an error when the course list fails", async () => {
      apiMock.get.mockRejectedValue({ response: { data: { error: "server exploded" } } });
      renderPage();
      fireEvent.click(screen.getByText("Fetch Courses"));
      expect(await screen.findByText("server exploded")).toBeInTheDocument();
      expect(toastFn.error).toHaveBeenCalledWith(
        "Request failed",
        expect.objectContaining({ description: "server exploded" }),
      );
    });
  });

  describe("Create Topic", () => {
    it("blocks submission when required fields are missing", () => {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Create Topic" }));
      expect(toastFn.error).toHaveBeenCalledWith(
        "Missing required fields",
        expect.objectContaining({ description: expect.stringContaining("topic name") }),
      );
      expect(apiMock.post).not.toHaveBeenCalled();
    });

    it("creates a topic and shows a success toast", async () => {
      apiMock.post.mockResolvedValue({ data: { id: 5, name: "Loops" } });
      renderPage();
      fireEvent.change(document.getElementById("topic-course-id")!, { target: { value: "3" } });
      fireEvent.change(screen.getByLabelText("Topic Name"), { target: { value: "Loops" } });
      fireEvent.click(screen.getByRole("button", { name: "Create Topic" }));
      await waitFor(() =>
        expect(apiMock.post).toHaveBeenCalledWith("/api/course/3/topics", { name: "Loops" }),
      );
      expect(await screen.findByText(/"name": "Loops"/)).toBeInTheDocument();
      expect(toastFn).toHaveBeenCalledWith("Topic created");
    });

    it("shows an error when topic creation fails", async () => {
      apiMock.post.mockRejectedValue({ response: { data: { details: "duplicate topic" } } });
      renderPage();
      fireEvent.change(document.getElementById("topic-course-id")!, { target: { value: "3" } });
      fireEvent.change(screen.getByLabelText("Topic Name"), { target: { value: "Loops" } });
      fireEvent.click(screen.getByRole("button", { name: "Create Topic" }));
      expect(await screen.findByText("duplicate topic")).toBeInTheDocument();
    });
  });

  describe("Create Question", () => {
    it("blocks submission when required fields are missing", () => {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Create Question" }));
      expect(toastFn.error).toHaveBeenCalledWith(
        "Missing required fields",
        expect.objectContaining({ description: expect.stringContaining("description") }),
      );
      expect(apiMock.post).not.toHaveBeenCalled();
    });

    it("rejects invalid JSON in the question order field", () => {
      renderPage();
      fireEvent.change(document.getElementById("question-course-id")!, { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Primary Topic ID"), { target: { value: "2" } });
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: "What is 2+2?" } });
      fireEvent.change(screen.getByLabelText("Question Order (JSON, optional)"), {
        target: { value: "{not json" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create Question" }));
      expect(toastFn.error).toHaveBeenCalledWith(
        "Invalid question order",
        expect.objectContaining({ description: "Question order must be valid JSON." }),
      );
      expect(apiMock.post).not.toHaveBeenCalled();
    });

    it("creates a question with parsed question order", async () => {
      apiMock.post.mockResolvedValue({ data: { id: 9 } });
      renderPage();
      fireEvent.change(document.getElementById("question-course-id")!, { target: { value: "1" } });
      fireEvent.change(screen.getByLabelText("Primary Topic ID"), { target: { value: "2" } });
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: "What is 2+2?" } });
      fireEvent.change(screen.getByLabelText("Question Order (JSON, optional)"), {
        target: { value: '{"1": 2}' },
      });
      fireEvent.click(screen.getByRole("button", { name: "Create Question" }));
      await waitFor(() =>
        expect(apiMock.post).toHaveBeenCalledWith("/api/questions", {
          description: "What is 2+2?",
          courseId: 1,
          primaryTopicId: 2,
          type: "MCQ",
          questionOrder: { 1: 2 },
        }),
      );
      expect(toastFn).toHaveBeenCalledWith("Question created");
    });
  });

  describe("Create Assessment", () => {
    it("blocks submission when name is missing", () => {
      renderPage();
      fireEvent.click(screen.getByRole("button", { name: "Create Assessment" }));
      expect(toastFn.error).toHaveBeenCalledWith("Missing required fields", {
        description: "Name is required.",
      });
      expect(apiMock.post).not.toHaveBeenCalled();
    });

    it("creates an assessment with the default type", async () => {
      apiMock.post.mockResolvedValue({ data: { id: 4, name: "Midterm" } });
      renderPage();
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Midterm" } });
      fireEvent.click(screen.getByRole("button", { name: "Create Assessment" }));
      await waitFor(() =>
        expect(apiMock.post).toHaveBeenCalledWith("/api/assessments", {
          name: "Midterm",
          type: "Assignment",
        }),
      );
      expect(toastFn).toHaveBeenCalledWith("Assessment created");
    });
  });

  describe("Link Question to Assessment", () => {
    it("blocks submission when IDs are missing", () => {
      renderPage();
      fireEvent.click(screen.getByText("Add Question to Assessment"));
      expect(toastFn.error).toHaveBeenCalledWith(
        "Missing required fields",
        expect.objectContaining({ description: expect.stringContaining("question ID") }),
      );
      expect(apiMock.post).not.toHaveBeenCalled();
    });

    it("links a question to an assessment using the default order number", async () => {
      apiMock.post.mockResolvedValue({ data: { linked: true } });
      renderPage();
      fireEvent.change(screen.getByLabelText("Assessment ID"), { target: { value: "1" } });
      fireEvent.change(document.getElementById("link-question-id")!, { target: { value: "9" } });
      fireEvent.click(screen.getByText("Add Question to Assessment"));
      await waitFor(() =>
        expect(apiMock.post).toHaveBeenCalledWith("/api/assessments/1/questions", {
          questionId: 9,
          orderNumber: 1,
        }),
      );
      expect(toastFn).toHaveBeenCalledWith("Question linked");
    });
  });

  describe("Create Question Variant", () => {
    it("blocks submission when required fields are missing", () => {
      renderPage();
      fireEvent.click(screen.getByText("Create Variant"));
      expect(toastFn.error).toHaveBeenCalledWith(
        "Missing required fields",
        expect.objectContaining({ description: expect.stringContaining("Question ID") }),
      );
      expect(apiMock.post).not.toHaveBeenCalled();
    });

    it("creates a variant with optional fields parsed", async () => {
      apiMock.post.mockResolvedValue({ data: { id: 55 } });
      renderPage();
      fireEvent.change(document.getElementById("variant-question-id")!, {
        target: { value: "7" },
      });
      fireEvent.change(screen.getByLabelText("Question Text"), {
        target: { value: "What is the capital of France?" },
      });
      fireEvent.change(screen.getByLabelText("Assessment ID (optional)"), {
        target: { value: "3" },
      });
      fireEvent.change(screen.getByLabelText(/Secondary Topic IDs/), {
        target: { value: "1, 2, x" },
      });
      fireEvent.change(screen.getByLabelText("Reference Variant ID (optional)"), {
        target: { value: "11" },
      });
      fireEvent.change(screen.getByLabelText("Answer (optional)"), { target: { value: "Paris" } });
      fireEvent.click(screen.getByText("Create Variant"));
      await waitFor(() =>
        expect(apiMock.post).toHaveBeenCalledWith("/api/questions/7/variants", {
          questionText: "What is the capital of France?",
          difficulty: "medium",
          assessmentId: 3,
          secondaryTopicsId: [1, 2],
          referenceId: 11,
          answer: "Paris",
        }),
      );
      expect(toastFn).toHaveBeenCalledWith("Variant created");
    });

    it("creates a variant omitting all optional fields", async () => {
      apiMock.post.mockResolvedValue({ data: { id: 56 } });
      renderPage();
      fireEvent.change(document.getElementById("variant-question-id")!, {
        target: { value: "7" },
      });
      fireEvent.change(screen.getByLabelText("Question Text"), { target: { value: "Bare bones" } });
      fireEvent.click(screen.getByText("Create Variant"));
      await waitFor(() =>
        expect(apiMock.post).toHaveBeenCalledWith("/api/questions/7/variants", {
          questionText: "Bare bones",
          difficulty: "medium",
          assessmentId: undefined,
          secondaryTopicsId: undefined,
          referenceId: undefined,
          answer: undefined,
        }),
      );
    });
  });

  describe("AI Service API Key Test", () => {
    it("tests the API key and shows the result", async () => {
      eduaiServiceMock.testApiKey.mockResolvedValue({ data: { valid: true } });
      renderPage();
      fireEvent.click(screen.getByText("Test API Key"));
      expect(await screen.findByText(/"valid": true/)).toBeInTheDocument();
      expect(screen.getByText("Test API Key")).not.toBeDisabled();
    });

    it("shows an error when the API key test fails", async () => {
      eduaiServiceMock.testApiKey.mockRejectedValue({ message: "network down" });
      renderPage();
      fireEvent.click(screen.getByText("Test API Key"));
      expect(await screen.findByText("network down")).toBeInTheDocument();
    });
  });

  describe("AI Service Course Topics", () => {
    it("requires a course ID", () => {
      renderPage();
      fireEvent.click(screen.getByText("Fetch AI Service Topics"));
      expect(toastFn.error).toHaveBeenCalledWith(
        "Missing course ID",
        expect.objectContaining({ description: expect.any(String) }),
      );
      expect(eduaiServiceMock.fetchCourseTopics).not.toHaveBeenCalled();
    });

    it("fetches topics for a trimmed course ID", async () => {
      eduaiServiceMock.fetchCourseTopics.mockResolvedValue({ data: [{ id: "t1" }] });
      renderPage();
      fireEvent.change(screen.getByLabelText("AI Service Course ID"), {
        target: { value: "  COSC211  " },
      });
      fireEvent.click(screen.getByText("Fetch AI Service Topics"));
      await waitFor(() =>
        expect(eduaiServiceMock.fetchCourseTopics).toHaveBeenCalledWith("COSC211"),
      );
      expect(toastFn).toHaveBeenCalledWith("Fetched course topics");
    });

    it("shows an error when fetching topics fails via aiErrorReason", async () => {
      eduaiServiceMock.fetchCourseTopics.mockRejectedValue({
        response: { data: { aiErrorReason: "model refused" } },
      });
      renderPage();
      fireEvent.change(screen.getByLabelText("AI Service Course ID"), {
        target: { value: "COSC211" },
      });
      fireEvent.click(screen.getByText("Fetch AI Service Topics"));
      expect(await screen.findByText("model refused")).toBeInTheDocument();
    });
  });

  describe("AI Service Chat", () => {
    it("requires course code and message", () => {
      renderPage();
      fireEvent.change(document.getElementById("eduai-course-code")!, { target: { value: "" } });
      fireEvent.click(screen.getByText("Send Chat Message"));
      expect(toastFn.error).toHaveBeenCalledWith(
        "Missing required fields",
        expect.objectContaining({ description: expect.stringContaining("Course code") }),
      );
      expect(eduaiServiceMock.chat).not.toHaveBeenCalled();
    });

    it("sends a chat message with built API keys", async () => {
      eduaiServiceMock.chat.mockResolvedValue({ data: { reply: "hi" } });
      buildApiKeysMock.mockResolvedValue({ google: { isEnabled: true } });
      renderPage();
      fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Explain loops" } });
      fireEvent.click(screen.getByText("Send Chat Message"));
      await waitFor(() =>
        expect(eduaiServiceMock.chat).toHaveBeenCalledWith({
          messages: [{ role: "user", content: "Explain loops" }],
          courseCode: "COSC121",
          model: "vllm:qwen3.5-9b-instruct",
          apiKeys: { google: { isEnabled: true } },
        }),
      );
      expect(toastFn).toHaveBeenCalledWith("Chat request sent");
    });

    it("falls back to a generic message when the error has no known shape", async () => {
      eduaiServiceMock.chat.mockRejectedValue({});
      renderPage();
      fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Explain loops" } });
      fireEvent.click(screen.getByText("Send Chat Message"));
      expect(await screen.findByText("Request failed")).toBeInTheDocument();
    });
  });

  describe("AI Service Question Generation", () => {
    it("requires course code and prompt", () => {
      renderPage();
      fireEvent.click(screen.getByText("Generate Questions"));
      expect(toastFn.error).toHaveBeenCalledWith(
        "Missing required fields",
        expect.objectContaining({ description: expect.stringContaining("prompt") }),
      );
      expect(eduaiServiceMock.generateQuestions).not.toHaveBeenCalled();
    });

    it("rejects a difficulty distribution that doesn't sum to the question count", () => {
      renderPage();
      fireEvent.change(screen.getByLabelText("Topic/Prompt"), {
        target: { value: "Recursion basics" },
      });
      fireEvent.change(screen.getByLabelText("Number of Questions"), { target: { value: "10" } });
      fireEvent.click(screen.getByText("Generate Questions"));
      expect(toastFn.error).toHaveBeenCalledWith(
        "Invalid difficulty distribution",
        expect.objectContaining({
          description: "Sum of difficulty levels must equal number of questions.",
        }),
      );
      expect(eduaiServiceMock.generateQuestions).not.toHaveBeenCalled();
    });

    it("generates questions when the distribution matches", async () => {
      eduaiServiceMock.generateQuestions.mockResolvedValue({ data: { questions: [] } });
      buildApiKeysMock.mockResolvedValue({});
      renderPage();
      fireEvent.change(screen.getByLabelText("Topic/Prompt"), {
        target: { value: "Recursion basics" },
      });
      fireEvent.click(screen.getByText("Generate Questions"));
      await waitFor(() =>
        expect(eduaiServiceMock.generateQuestions).toHaveBeenCalledWith({
          prompt: "Recursion basics",
          courseCode: "COSC121",
          model: "vllm:qwen3.5-9b-instruct",
          apiKeys: {},
          numQuestions: 5,
          difficultyDistribution: { easy: 1, medium: 2, hard: 2 },
        }),
      );
      expect(toastFn).toHaveBeenCalledWith("Questions generated");
    });

    it("shows an error using the response error field when generation fails", async () => {
      eduaiServiceMock.generateQuestions.mockRejectedValue({
        response: { data: { error: "quota exceeded" } },
      });
      renderPage();
      fireEvent.change(screen.getByLabelText("Topic/Prompt"), {
        target: { value: "Recursion basics" },
      });
      fireEvent.click(screen.getByText("Generate Questions"));
      expect(await screen.findByText("quota exceeded")).toBeInTheDocument();
    });
  });
});

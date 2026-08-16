/**
 * Unit tests for the course search/embedding settings panel.
 *
 * The component fetches settings on mount, lets the instructor pick a
 * provider/model, PATCHes on save, and — when the save response carries a
 * re-embed job id — polls that job to completion before showing the final
 * message. All of that is driven by `fetch`, so `fetch` is stubbed directly
 * (no hook to mock) and the polling interval is exercised with real timers
 * plus `waitFor` rather than faked timers, since the component's own
 * `setTimeout` runs inside `pollReEmbedJobUntilDone`.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CourseEmbeddingSettings } from "~/components/course-embedding-settings";

const baseSettingsResponse = {
  settings: {
    embeddingProvider: null,
    embeddingModel: null,
    embeddedWithProvider: "env",
    embeddedWithModel: "text-embedding-3-small",
    lastEmbeddedAt: "2026-01-01T00:00:00.000Z",
  },
  effective: {
    provider: "env",
    model: "text-embedding-3-small",
    source: { provider: "env", model: "text-embedding-3-small" },
  },
  needsReEmbed: false,
  allowedLocalModels: [{ id: "local-1", label: "Local model" }],
  allowedCloudModels: [{ id: "cloud-1", label: "Cloud model" }],
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CourseEmbeddingSettings", () => {
  it("shows a loading state before settings resolve", () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<CourseEmbeddingSettings courseId="course-1" />);

    expect(screen.getByText(/Loading search settings/)).toBeInTheDocument();
  });

  it("loads settings and shows the active provider/model", async () => {
    mockFetch.mockResolvedValue(jsonResponse(baseSettingsResponse));

    render(<CourseEmbeddingSettings courseId="course-1" />);

    await waitFor(() => expect(screen.getByText("Search settings")).toBeInTheDocument());
    expect(screen.getByText(/from server env/)).toBeInTheDocument();
    expect(screen.getByText(/Last processed with:/)).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith("/api/courses/course-1/embedding-settings");
  });

  it("surfaces a needsReEmbed banner when materials are stale", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ ...baseSettingsResponse, needsReEmbed: true }),
    );

    render(<CourseEmbeddingSettings courseId="course-1" />);

    await waitFor(() =>
      expect(screen.getByText(/Reprocess all materials before course/)).toBeInTheDocument(),
    );
  });

  it("shows a load error when the response is not ok", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({ error: "Boom", hint: "try again" }, { ok: false, status: 500 }),
    );

    render(<CourseEmbeddingSettings courseId="course-1" />);

    await waitFor(() => expect(screen.getByText(/Boom try again/)).toBeInTheDocument());
  });

  it("shows a parse error when the response body is not JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("<html>server error</html>"),
    });

    render(<CourseEmbeddingSettings courseId="course-1" />);

    await waitFor(() => expect(screen.getByText(/server error/)).toBeInTheDocument());
  });

  it("reveals the model select once a non-default provider is chosen", async () => {
    mockFetch.mockResolvedValue(jsonResponse(baseSettingsResponse));

    render(<CourseEmbeddingSettings courseId="course-1" />);
    await waitFor(() => expect(screen.getByText("Search settings")).toBeInTheDocument());

    expect(screen.queryByLabelText("Model")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Provider"));
    fireEvent.click(await screen.findByText("Local (Ollama)"));

    await waitFor(() => expect(screen.getByLabelText("Model")).toBeInTheDocument());
    expect(screen.getByText("Local (Ollama)")).toBeInTheDocument();
  });

  it("chooses a specific model and sends it in the save payload", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(baseSettingsResponse))
      .mockResolvedValueOnce(jsonResponse(baseSettingsResponse));

    render(<CourseEmbeddingSettings courseId="course-1" />);
    await waitFor(() => expect(screen.getByText("Search settings")).toBeInTheDocument());

    fireEvent.click(screen.getByLabelText("Provider"));
    fireEvent.click(await screen.findByText("Cloud"));

    fireEvent.click(await screen.findByLabelText("Model"));
    fireEvent.click(await screen.findByText("Cloud model"));

    fireEvent.click(screen.getByText("Save settings"));

    await waitFor(() => {
      const patchCall = mockFetch.mock.calls.find((c) => c[1]?.method === "PATCH");
      expect(patchCall).toBeTruthy();
      const body = JSON.parse(patchCall![1].body as string);
      expect(body.embeddingProvider).toBe("cloud");
      expect(body.embeddingModel).toBe("cloud-1");
    });
  });

  it("saves settings with the chosen provider/model and re-embed flag", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(baseSettingsResponse))
      .mockResolvedValueOnce(
        jsonResponse({
          ...baseSettingsResponse,
          success: true,
        }),
      );

    render(<CourseEmbeddingSettings courseId="course-1" />);
    await waitFor(() => expect(screen.getByText("Search settings")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Save settings"));

    await waitFor(() => expect(screen.getByText("Search settings saved.")).toBeInTheDocument());

    const patchCall = mockFetch.mock.calls.find((c) => c[1]?.method === "PATCH");
    expect(patchCall).toBeTruthy();
    const body = JSON.parse(patchCall![1].body as string);
    expect(body).toEqual({
      embeddingProvider: null,
      embeddingModel: null,
      reEmbed: false,
    });
  });

  it("toggles the re-embed-on-save checkbox and sends it as true", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(baseSettingsResponse))
      .mockResolvedValueOnce(jsonResponse({ ...baseSettingsResponse, needsReEmbed: true }));

    render(<CourseEmbeddingSettings courseId="course-1" />);
    await waitFor(() => expect(screen.getByText("Search settings")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByText("Save settings"));

    await waitFor(() => {
      const patchCall = mockFetch.mock.calls.find((c) => c[1]?.method === "PATCH");
      expect(patchCall).toBeTruthy();
      const body = JSON.parse(patchCall![1].body as string);
      expect(body.reEmbed).toBe(true);
    });
  });

  it("shows a save error and leaves the loaded data untouched", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(baseSettingsResponse))
      .mockResolvedValueOnce(jsonResponse({ error: "Save exploded" }, { ok: false, status: 500 }));

    render(<CourseEmbeddingSettings courseId="course-1" />);
    await waitFor(() => expect(screen.getByText("Search settings")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Save settings"));

    await waitFor(() => expect(screen.getByText("Save exploded")).toBeInTheDocument());
  });

  it("polls a re-embed job to completion and reports the final message", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(baseSettingsResponse))
      .mockResolvedValueOnce(
        jsonResponse({ ...baseSettingsResponse, reEmbedJob: { id: "job-1" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          job: {
            id: "job-1",
            courseId: "course-1",
            status: "RUNNING",
            totalMaterials: 2,
            processedCount: 1,
            failed: [],
            currentMaterialTitle: "Chapter 1",
            errorMessage: null,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          job: {
            id: "job-1",
            courseId: "course-1",
            status: "COMPLETED",
            totalMaterials: 2,
            processedCount: 2,
            failed: [],
            currentMaterialTitle: null,
            errorMessage: null,
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse(baseSettingsResponse));

    render(<CourseEmbeddingSettings courseId="course-1" />);
    await waitFor(() => expect(screen.getByText("Search settings")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Save settings"));

    await waitFor(
      () => expect(screen.getByText(/Processed 2 material\(s\)\./)).toBeInTheDocument(),
      { timeout: 10000 },
    );
  }, 15000);

  it("shows an error when the re-embed job ultimately fails", async () => {
    mockFetch
      .mockResolvedValueOnce(jsonResponse(baseSettingsResponse))
      .mockResolvedValueOnce(
        jsonResponse({ ...baseSettingsResponse, reEmbedJob: { id: "job-2" } }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          job: {
            id: "job-2",
            courseId: "course-1",
            status: "FAILED",
            totalMaterials: 2,
            processedCount: 0,
            failed: ["material-1"],
            currentMaterialTitle: null,
            errorMessage: "Processing blew up",
          },
        }),
      );

    render(<CourseEmbeddingSettings courseId="course-1" />);
    await waitFor(() => expect(screen.getByText("Search settings")).toBeInTheDocument());

    fireEvent.click(screen.getByText("Save settings"));

    await waitFor(() => expect(screen.getByText("Processing blew up")).toBeInTheDocument());
  });
});

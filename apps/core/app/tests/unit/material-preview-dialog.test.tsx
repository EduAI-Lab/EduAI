/**
 * Text-preview dialog for a course material. Fetches an excerpt on open and
 * covers: loading state, successful excerpt render (with/without truncation),
 * an empty-excerpt fallback message, a non-ok response surfacing the server
 * error message, a rejected fetch surfacing the generic error, an aborted
 * fetch (component closing mid-request) not setting an error, and re-fetching
 * when the materialId changes while open.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

import { MaterialPreviewDialog } from "~/components/courses/material-preview-dialog";

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) };
}

describe("MaterialPreviewDialog", () => {
  it("does not fetch when closed", () => {
    render(
      <MaterialPreviewDialog
        courseId="course-1"
        materialId="mat-1"
        title="Lecture 1"
        open={false}
        onOpenChange={vi.fn()}
      />,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does not fetch when materialId is null", () => {
    render(
      <MaterialPreviewDialog
        courseId="course-1"
        materialId={null}
        title="Lecture 1"
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("shows a loading state while the request is in flight", async () => {
    let resolveFetch: (v: unknown) => void = () => {};
    mockFetch.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));

    render(
      <MaterialPreviewDialog
        courseId="course-1"
        materialId="mat-1"
        title="Lecture 1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("Loading preview…")).toBeInTheDocument();
    resolveFetch(jsonResponse({ excerpt: "hello", truncated: false }));
    await waitFor(() => expect(screen.queryByText("Loading preview…")).not.toBeInTheDocument());
  });

  it("renders the excerpt on a successful response", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ excerpt: "Some material text", truncated: false }));

    render(
      <MaterialPreviewDialog
        courseId="course-1"
        materialId="mat-1"
        title="Lecture 1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("Some material text")).toBeInTheDocument();
    expect(
      screen.queryByText(/Preview truncated/),
    ).not.toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/courses/course-1/materials/mat-1",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("shows the truncation notice when the response is truncated", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ excerpt: "partial text", truncated: true }));

    render(
      <MaterialPreviewDialog
        courseId="course-1"
        materialId="mat-1"
        title="Lecture 1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("partial text")).toBeInTheDocument();
    expect(screen.getByText(/Preview truncated/)).toBeInTheDocument();
  });

  it("shows a fallback message when the excerpt is empty", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ excerpt: "", truncated: false }));

    render(
      <MaterialPreviewDialog
        courseId="course-1"
        materialId="mat-1"
        title="Lecture 1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("No text content available for preview."),
    ).toBeInTheDocument();
  });

  it("surfaces the server error message on a non-ok response", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ error: "Material not found" }, false));

    render(
      <MaterialPreviewDialog
        courseId="course-1"
        materialId="mat-1"
        title="Lecture 1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("Could not load preview")).toBeInTheDocument();
  });

  it("falls back to a generic error when a non-ok body can't be parsed as JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.reject(new Error("bad json")),
    });

    render(
      <MaterialPreviewDialog
        courseId="course-1"
        materialId="mat-1"
        title="Lecture 1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("Could not load preview")).toBeInTheDocument();
  });

  it("shows a generic error when the fetch itself rejects", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    render(
      <MaterialPreviewDialog
        courseId="course-1"
        materialId="mat-1"
        title="Lecture 1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("Could not load preview")).toBeInTheDocument();
  });

  it("does not set an error when the fetch is aborted", async () => {
    mockFetch.mockRejectedValue(new DOMException("aborted", "AbortError"));

    render(
      <MaterialPreviewDialog
        courseId="course-1"
        materialId="mat-1"
        title="Lecture 1"
        open
        onOpenChange={vi.fn()}
      />,
    );

    await waitFor(() => expect(screen.queryByText("Loading preview…")).not.toBeInTheDocument());
    expect(screen.queryByText("Could not load preview")).not.toBeInTheDocument();
  });

  it("re-fetches when materialId changes while the dialog stays open", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ excerpt: "first excerpt", truncated: false }));

    const { rerender } = render(
      <MaterialPreviewDialog
        courseId="course-1"
        materialId="mat-1"
        title="Lecture 1"
        open
        onOpenChange={vi.fn()}
      />,
    );
    expect(await screen.findByText("first excerpt")).toBeInTheDocument();

    mockFetch.mockResolvedValue(jsonResponse({ excerpt: "second excerpt", truncated: false }));
    rerender(
      <MaterialPreviewDialog
        courseId="course-1"
        materialId="mat-2"
        title="Lecture 2"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("second excerpt")).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledWith(
      "/api/courses/course-1/materials/mat-2",
      expect.anything(),
    );
  });

  it("renders the dialog title and description", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ excerpt: "text", truncated: false }));

    render(
      <MaterialPreviewDialog
        courseId="course-1"
        materialId="mat-1"
        title="Lecture Notes"
        open
        onOpenChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("Lecture Notes")).toBeInTheDocument();
    expect(screen.getByText("Text preview of course material")).toBeInTheDocument();
  });
});

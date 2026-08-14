/**
 * Unit tests for the course AI response-style editor.
 *
 * Tag selection and the instructions textarea are local state; save PATCHes
 * `/api/courses/:id/response-style` directly, so `fetch` is stubbed rather
 * than a hook. Also covers `CourseResponseStyleSummary`, the read-only
 * badge list rendered on the Overview tab.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CourseResponseStyleSettings,
  CourseResponseStyleSummary,
} from "~/components/courses/course-response-style-settings";

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CourseResponseStyleSettings", () => {
  it("renders with no tags selected and no preview", () => {
    render(<CourseResponseStyleSettings courseId="course-1" initialTags={[]} />);

    expect(screen.getByText("AI response style")).toBeInTheDocument();
    expect(screen.queryByText("Preview")).not.toBeInTheDocument();
  });

  it("toggles a tag on and shows its preview", () => {
    render(<CourseResponseStyleSettings courseId="course-1" initialTags={[]} />);

    fireEvent.click(screen.getByText("Concise"));

    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(
      screen.getByText(/Three things to remember/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Concise" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("toggles a tag back off, removing it from the preview", () => {
    render(<CourseResponseStyleSettings courseId="course-1" initialTags={["concise"]} />);

    expect(screen.getByText("Preview")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Concise" }));

    expect(screen.queryByText("Preview")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Concise" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("edits the additional-instructions textarea", () => {
    render(<CourseResponseStyleSettings courseId="course-1" initialTags={[]} />);

    const textarea = screen.getByPlaceholderText(/Prefer diagrams/);
    fireEvent.change(textarea, { target: { value: "Always show a worked example." } });

    expect(textarea).toHaveValue("Always show a worked example.");
  });

  it("saves the selected tags and instructions, calling onSaved", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    const onSaved = vi.fn();

    render(
      <CourseResponseStyleSettings
        courseId="course-1"
        initialTags={[]}
        onSaved={onSaved}
      />,
    );

    fireEvent.click(screen.getByText("Formal"));
    fireEvent.change(screen.getByPlaceholderText(/Prefer diagrams/), {
      target: { value: "Use British spelling." },
    });
    fireEvent.click(screen.getByText("Save response style"));

    await waitFor(() => expect(screen.getByText("Saved.")).toBeInTheDocument());

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/courses/course-1/response-style",
      expect.objectContaining({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          responseStyleTags: ["formal"],
          aiInstructions: "Use British spelling.",
        }),
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(["formal"], "Use British spelling.");
  });

  it("shows the server error message when save fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Instructions too long" }),
    });

    render(<CourseResponseStyleSettings courseId="course-1" initialTags={[]} />);

    fireEvent.click(screen.getByText("Save response style"));

    await waitFor(() =>
      expect(screen.getByText("Instructions too long")).toBeInTheDocument(),
    );
  });

  it("falls back to a generic message when the error body can't be parsed", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.reject(new Error("bad json")),
    });

    render(<CourseResponseStyleSettings courseId="course-1" initialTags={[]} />);

    fireEvent.click(screen.getByText("Save response style"));

    await waitFor(() => expect(screen.getByText("Save failed.")).toBeInTheDocument());
  });

  it("shows a network-error message when the fetch itself rejects", async () => {
    mockFetch.mockRejectedValue(new Error("offline"));

    render(<CourseResponseStyleSettings courseId="course-1" initialTags={[]} />);

    fireEvent.click(screen.getByText("Save response style"));

    await waitFor(() => expect(screen.getByText("Network error.")).toBeInTheDocument());
  });

  it("renders in embedded mode without the outer card header", () => {
    render(
      <CourseResponseStyleSettings courseId="course-1" initialTags={[]} embedded />,
    );

    expect(
      screen.getByText("Choose how the course chatbot should respond for students."),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/students see that AI is enabled/),
    ).not.toBeInTheDocument();
  });
});

describe("CourseResponseStyleSummary", () => {
  it("renders nothing when there are no tags and showEmpty is not set", () => {
    const { container } = render(<CourseResponseStyleSummary tagIds={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an empty-state message when showEmpty is true", () => {
    render(<CourseResponseStyleSummary tagIds={[]} showEmpty />);
    expect(screen.getByText("No response style configured")).toBeInTheDocument();
  });

  it("renders a badge for each resolved tag", () => {
    render(<CourseResponseStyleSummary tagIds={["concise", "formal", "unknown-id"]} />);
    expect(screen.getByText("Concise")).toBeInTheDocument();
    expect(screen.getByText("Formal")).toBeInTheDocument();
  });
});

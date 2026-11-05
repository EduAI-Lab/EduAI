import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCoursePublishToggle } from "~/components/courses/useCoursePublishToggle";
import type { Course } from "~/lib/types";

/** The confirm-then-publish flow shared by the dashboard, Courses list and course banner. */
const mockPublishCourse = vi.fn();
const mockUnpublishCourse = vi.fn();
const mockRevalidate = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("~/lib/api", () => ({
  default: {
    publishCourse: (...args: unknown[]) => mockPublishCourse(...args),
    unpublishCourse: (...args: unknown[]) => mockUnpublishCourse(...args),
  },
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));
vi.mock("react-router", async (importActual) => ({
  ...(await importActual<typeof import("react-router")>()),
  useRevalidator: () => ({ revalidate: mockRevalidate, state: "idle" }),
}));

const draft: Course = { id: 7, code: "COSC 211", title: "Architecture", isPublished: false };
const live: Course = { ...draft, isPublished: true };

function Harness({ course }: { course: Course }) {
  const { requestToggle, dialog } = useCoursePublishToggle();
  return (
    <>
      <button type="button" onClick={() => requestToggle(course)}>
        toggle
      </button>
      {dialog}
    </>
  );
}

function requestAndAnswer(course: Course, answer: string) {
  render(<Harness course={course} />);
  fireEvent.click(screen.getByRole("button", { name: "toggle" }));
  fireEvent.click(screen.getByRole("button", { name: answer }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPublishCourse.mockResolvedValue({ ...live });
  mockUnpublishCourse.mockResolvedValue({ ...draft });
});

describe("useCoursePublishToggle", () => {
  it("names the course and says publishing does not cascade", () => {
    render(<Harness course={draft} />);
    fireEvent.click(screen.getByRole("button", { name: "toggle" }));
    expect(screen.getByText('Publish "Architecture"?')).toBeInTheDocument();
    expect(screen.getByText(/modules and lessons stay hidden/i)).toBeInTheDocument();
  });

  it("publishes a draft, reports it, and revalidates", async () => {
    requestAndAnswer(draft, "Publish");
    await waitFor(() => expect(mockRevalidate).toHaveBeenCalled());
    expect(mockPublishCourse).toHaveBeenCalledWith(7);
    expect(toastSuccess).toHaveBeenCalledWith("COSC 211 is now visible to students.");
  });

  it("unpublishes a published course", async () => {
    requestAndAnswer(live, "Unpublish");
    await waitFor(() => expect(mockUnpublishCourse).toHaveBeenCalledWith(7));
    expect(toastSuccess).toHaveBeenCalledWith("COSC 211 is now hidden from students.");
  });

  it("says so when Core accepted the write but could not confirm it back", async () => {
    mockPublishCourse.mockResolvedValue({ ...live, corePublishStale: true });
    requestAndAnswer(draft, "Publish");
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Saved COSC 211. EduAI hasn't confirmed it back yet.",
      ),
    );
  });

  it("reports a refused write and does not revalidate", async () => {
    mockPublishCourse.mockRejectedValue(new Error("403"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    requestAndAnswer(draft, "Publish");
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Could not update COSC 211. Try again."),
    );
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("leaves the course alone when the confirm is cancelled", () => {
    requestAndAnswer(draft, "Cancel");
    expect(mockPublishCourse).not.toHaveBeenCalled();
  });
});

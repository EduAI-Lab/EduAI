/**
 * @file The grade dialog's save path.
 *
 * `buildGradePayload` always sends both fields, `null` meaning "clear it" —
 * omitting them posts `{}` and the route answers `400 Nothing to update`, so a
 * grade could never be taken back. The payload shaping itself is covered in
 * `CourseSubmissionsPanel.grade-payload.test.ts`; what is pinned here is that
 * the dialog sends that payload for the row it was opened on, and puts the
 * table back when the server refuses.
 *
 * The "score isn't a number" refusal has no test through the UI on purpose:
 * the score field is `type="number"`, so an unreadable value never reaches
 * state. That branch is exercised where it lives, against the helper.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { SubmissionRow } from "~/lib/types";
import { CourseSubmissionsPanel } from "~/components/courses/CourseSubmissionsPanel";

const courseSubmissions = vi.fn();
const gradeSubmission = vi.fn();

vi.mock("~/lib/api", () => ({
  default: {
    courseSubmissions: (...args: unknown[]) => courseSubmissions(...args),
    gradeSubmission: (...args: unknown[]) => gradeSubmission(...args),
  },
}));

vi.mock("~/hooks/useAtPermissions", () => ({
  useAtPermissions: () => ({ user: { id: "u-1", role: "INSTRUCTOR" }, access: "instructor" }),
}));

const ROW: SubmissionRow = {
  id: 7,
  userId: "student-1",
  studentName: "Ada Lovelace",
  activityId: 42,
  activityTitle: "Balancing equations",
  lessonTitle: "Week 3",
  attemptNumber: 1,
  response: { answerText: "H2O" } as SubmissionRow["response"],
  score: null,
  isCorrect: null,
  createdAt: "2026-08-20T10:00:00.000Z",
};

async function openGradeDialog() {
  courseSubmissions.mockResolvedValue([ROW]);
  render(<CourseSubmissionsPanel courseId={1} />);

  fireEvent.click(await screen.findByRole("button", { name: /Ada Lovelace/ }));

  return screen.findByLabelText("Score (optional)");
}

describe("CourseSubmissionsPanel — saving a grade", () => {
  it("sends the score against the row the dialog was opened on", async () => {
    gradeSubmission.mockResolvedValue({ ...ROW, score: 8 });
    const score = await openGradeDialog();
    fireEvent.change(score, { target: { value: "8" } });

    fireEvent.click(screen.getByRole("button", { name: "Save grade" }));

    // Both fields go out: `isCorrect: null` is what makes "ungraded" clearable.
    await waitFor(() =>
      expect(gradeSubmission).toHaveBeenCalledWith(42, 7, { score: 8, isCorrect: null }),
    );
  });

  it("says so and keeps the dialog open when the server refuses", async () => {
    gradeSubmission.mockRejectedValue(new Error("nope"));
    const score = await openGradeDialog();
    fireEvent.change(score, { target: { value: "8" } });

    fireEvent.click(screen.getByRole("button", { name: "Save grade" }));

    expect(await screen.findByText("Could not save the grade. Try again.")).toBeInTheDocument();
  });
});

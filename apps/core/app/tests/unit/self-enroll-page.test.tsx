/**
 * #1939 — the student-facing "Can't join this course" page must not be a dead
 * end. It renders outside the app shell (no sidebar, no nav), so before this a
 * student who opened a link to a Draft course had no way back but the browser.
 */
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

// The route module also exports a loader and action; keep their server-only
// imports out of jsdom. The page component itself never calls them.
vi.mock("~/lib/auth/request-session.server", () => ({ getRequestSession: vi.fn() }));
vi.mock("~/lib/courses/self-enrollment.server", () => ({
  previewSelfEnrollmentLink: vi.fn(),
  redeemSelfEnrollmentLink: vi.fn(),
}));
vi.mock("~/lib/logging.server", () => ({ fireAndForget: vi.fn(), logAuditAction: vi.fn() }));
vi.mock("~/lib/request-context.server", () => ({
  getActorContext: vi.fn(),
  getRequestContext: vi.fn(),
}));

import SelfEnrollPage from "~/routes/courses.self-enroll";

/** What the page's loader returns when it renders (a redirect never reaches it). */
type SelfEnrollLoaderData =
  | { ok: false; error: string; message: string }
  | { ok: true; token: string; courseId: string; courseCode: string; courseName: string };

function renderWithLoaderData(data: SelfEnrollLoaderData) {
  const router = createMemoryRouter(
    [{ path: "/courses/self-enroll", loader: () => data, Component: SelfEnrollPage }],
    { initialEntries: ["/courses/self-enroll?token=t"] },
  );
  render(<RouterProvider router={router} />);
}

describe("self-enroll page — a link the student can't use", () => {
  it("offers a way back to the dashboard under the explanation", async () => {
    renderWithLoaderData({
      ok: false,
      error: "COURSE_NOT_PUBLISHED",
      message:
        "This course is not open to students yet. Try again once your instructor publishes it.",
    });

    expect(await screen.findByText("Can't join this course")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });

  it("does not show the dashboard link on a usable link, where Join is the action", async () => {
    renderWithLoaderData({
      ok: true,
      token: "t",
      courseId: "c1",
      courseCode: "DATA 301",
      courseName: "Intro to Data Analytics",
    });

    expect(await screen.findByRole("button", { name: "Join course" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Go to dashboard" })).toBeNull();
  });
});

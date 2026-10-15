// #1961 — where a course join that waited for sign-up lands: into the course,
// or the reason the link stopped working before the account was activated.
import { render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth/request-session.server", () => ({ getRequestSession: vi.fn() }));
vi.mock("~/lib/courses/pending-self-enrollment.server", () => ({
  redeemPendingSelfEnrollments: vi.fn(),
  latestPendingSelfEnrollmentOutcome: vi.fn(),
}));
vi.mock("~/lib/courses/self-enrollment.server", () => ({
  SELF_ENROLL_COMPLETE_PATH: "/courses/self-enroll/complete",
}));

import { getRequestSession } from "~/lib/auth/request-session.server";
import {
  latestPendingSelfEnrollmentOutcome,
  redeemPendingSelfEnrollments,
} from "~/lib/courses/pending-self-enrollment.server";
import SelfEnrollCompletePage, { loader } from "~/routes/courses.self-enroll.complete";

const PAGE_URL = "http://localhost/courses/self-enroll/complete";
const STUDENT = { user: { id: "u1", role: "STUDENT", emailVerified: true } };

function loaderArgs() {
  return { request: new Request(PAGE_URL), params: {}, context: {} as never } as never;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(redeemPendingSelfEnrollments).mockResolvedValue([]);
});

describe("/courses/self-enroll/complete loader (#1961)", () => {
  it("sends a signed-out visitor to sign in and back here", async () => {
    vi.mocked(getRequestSession).mockResolvedValue(null as never);

    const res = (await loader(loaderArgs())) as Response;

    expect(res.headers.get("Location")).toBe(
      "/auth/login?redirect=%2Fcourses%2Fself-enroll%2Fcomplete",
    );
    expect(redeemPendingSelfEnrollments).not.toHaveBeenCalled();
  });

  it("finishes anything still waiting, then lands a joined student in the course", async () => {
    vi.mocked(getRequestSession).mockResolvedValue(STUDENT as never);
    vi.mocked(latestPendingSelfEnrollmentOutcome).mockResolvedValue({
      joined: true,
      outcome: "JOINED",
      courseId: "c1",
      courseCode: "PSYO 121",
    });

    const res = (await loader(loaderArgs())) as Response;

    expect(redeemPendingSelfEnrollments).toHaveBeenCalledWith(STUDENT.user, expect.any(Request));
    expect(res.headers.get("Location")).toBe("/courses/c1");
  });

  it("explains a link that stopped working before they activated", async () => {
    vi.mocked(getRequestSession).mockResolvedValue(STUDENT as never);
    vi.mocked(latestPendingSelfEnrollmentOutcome).mockResolvedValue({
      joined: false,
      outcome: "LINK_EXPIRED",
      courseId: "c1",
      courseCode: "PSYO 121",
    });

    expect(await loader(loaderArgs())).toEqual({
      courseCode: "PSYO 121",
      message: "This enrollment link has expired. Ask your instructor for a new one.",
    });
  });

  it("falls back to the generic copy for a refusal it has no words for", async () => {
    vi.mocked(getRequestSession).mockResolvedValue(STUDENT as never);
    vi.mocked(latestPendingSelfEnrollmentOutcome).mockResolvedValue({
      joined: false,
      outcome: "USER_NOT_FOUND",
      courseId: "c1",
      courseCode: "PSYO 121",
    });

    expect(await loader(loaderArgs())).toEqual({
      courseCode: "PSYO 121",
      message: "Something went wrong with this enrollment link.",
    });
  });

  it("carries on to onboarding when there is no join to report", async () => {
    vi.mocked(getRequestSession).mockResolvedValue(STUDENT as never);
    vi.mocked(latestPendingSelfEnrollmentOutcome).mockResolvedValue(null);

    const res = (await loader(loaderArgs())) as Response;

    expect(res.headers.get("Location")).toBe("/onboarding/student-id");
  });
});

describe("/courses/self-enroll/complete page (#1961)", () => {
  it("names the course, gives the reason and a way to the dashboard", async () => {
    const router = createMemoryRouter(
      [
        {
          path: "/courses/self-enroll/complete",
          loader: () => ({
            courseCode: "PSYO 121",
            message: "This enrollment link was turned off. Ask your instructor for a new one.",
          }),
          Component: SelfEnrollCompletePage,
        },
      ],
      { initialEntries: ["/courses/self-enroll/complete"] },
    );
    render(<RouterProvider router={router} />);

    expect(await screen.findByText("Can't join PSYO 121")).toBeInTheDocument();
    expect(screen.getByText(/was turned off/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to dashboard" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});

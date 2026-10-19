import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OnboardingChecklist, PageTourButton } from "../onboarding/onboarding";
import { onboardingTasks, resolveOnboardingPage } from "../onboarding/catalog";

const startTour = vi.hoisted(() => vi.fn());
vi.mock("../tour/tour-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../tour/tour-provider")>()),
  useTour: () => ({ startTour }),
}));

beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

describe("onboarding routes and roles", () => {
  it("has five tasks per supported platform and no QM tasks for students or TAs", () => {
    for (const platform of ["core", "ai-tutor", "question-maker"] as const) {
      expect(onboardingTasks(platform, "INSTRUCTOR")).toHaveLength(5);
    }
    expect(onboardingTasks("question-maker", "STUDENT")).toEqual([]);
    expect(onboardingTasks("question-maker", "TA")).toEqual([]);
    expect(onboardingTasks("core", null)).toEqual([]);
  });
  it("matches real pages only, never dashboards, nested unknown routes, or query strings", () => {
    expect(resolveOnboardingPage("core", "/dashboard", "ADMIN")).toBeNull();
    expect(resolveOnboardingPage("core", "/chat/abc", "STUDENT")).toBe("core.chat");
    expect(resolveOnboardingPage("core", "/courses/self-enroll", "STUDENT")).toBeNull();
    expect(resolveOnboardingPage("core", "/courses/new", "INSTRUCTOR")).toBeNull();
    expect(resolveOnboardingPage("core", "/courses/c123", "STUDENT")).toBe("core.course");
    expect(resolveOnboardingPage("core", "/courses/c123/unknown", "ADMIN")).toBeNull();
    expect(resolveOnboardingPage("ai-tutor", "/student/lesson/42", "STUDENT")).toBe(
      "ai-tutor.lesson",
    );
    expect(resolveOnboardingPage("ai-tutor", "/instructor/lesson/42", "STUDENT")).toBeNull();
    expect(resolveOnboardingPage("question-maker", "/courses/1/questions/new", "INSTRUCTOR")).toBe(
      "question-maker.question",
    );
    expect(
      resolveOnboardingPage("question-maker", "/courses/1/assessments/2/variants", "ADMIN"),
    ).toBeNull();
  });
  it("uses learner copy for TAs without promising author access", () => {
    expect(onboardingTasks("ai-tutor", "TA")[1].label).toBe("Choose a module");
    expect(onboardingTasks("ai-tutor", "TA")[0].href).toBe("/instructor");
    expect(onboardingTasks("core", "INSTRUCTOR")[1].label).toBe(
      "Prepare materials, topics and enrollments",
    );
  });
});

describe("onboarding progress", () => {
  const navigate = vi.fn();
  it("saves explicit completion across remounts and keeps accounts separate", () => {
    const props = { platform: "core" as const, role: "STUDENT", navigate };
    const view = render(<OnboardingChecklist {...props} userId="one" />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByText("1 of 5 complete")).toBeInTheDocument();
    view.rerender(<OnboardingChecklist {...props} userId="two" />);
    expect(screen.getByText("0 of 5 complete")).toBeInTheDocument();
    view.rerender(<OnboardingChecklist {...props} userId="one" />);
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
    view.unmount();
    render(<OnboardingChecklist {...props} userId="one" />);
    expect(screen.getByText("1 of 5 complete")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByText("0 of 5 complete")).toBeInTheDocument();
  });
  it("does not mark a task done just because its destination was opened", () => {
    render(<OnboardingChecklist platform="core" role="STUDENT" userId="one" navigate={navigate} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Open / })[0]);
    expect(navigate).toHaveBeenCalledWith("/courses");
    expect(screen.getByText("0 of 5 complete")).toBeInTheDocument();
  });
  it("handles corrupted storage and reports unavailable persistence", () => {
    window.localStorage.setItem("eduai:onboarding:v1:core:one", "not json");
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<OnboardingChecklist platform="core" role="STUDENT" userId="one" navigate={navigate} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByText(/Progress cannot be saved/)).toBeInTheDocument();
    expect(screen.getByText("1 of 5 complete")).toBeInTheDocument();
    spy.mockRestore();
  });
});

describe("page tours", () => {
  it("starts only on request and closes when navigating to a different page", () => {
    const view = render(<PageTourButton platform="core" pathname="/courses" role="STUDENT" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play page tour" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    view.rerender(<PageTourButton platform="core" pathname="/settings" role="STUDENT" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("plays the app's dashboard tour only when given one, and never auto-starts it", () => {
    const view = render(<PageTourButton platform="core" pathname="/dashboard" role="STUDENT" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    view.rerender(
      <PageTourButton
        platform="core"
        pathname="/dashboard"
        role="STUDENT"
        dashboardTour="dashboard"
      />,
    );
    expect(startTour).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Play page tour" }));
    expect(startTour).toHaveBeenCalledWith("dashboard");
  });
});

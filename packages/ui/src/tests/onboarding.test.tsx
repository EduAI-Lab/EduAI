import { act, fireEvent, render, screen, cleanup, within } from "@testing-library/react";
import * as React from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Toaster } from "sonner";
import {
  GettingStartedButton,
  ONBOARDING_SLOT_ATTRIBUTE,
  OnboardingChecklist,
  PageTourButton,
} from "../onboarding/onboarding";
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
  it("gives TAs staff copy that matches their teaching workspace, without promising authoring", () => {
    expect(onboardingTasks("ai-tutor", "TA")[1].label).toBe("Review a module");
    expect(onboardingTasks("ai-tutor", "TA")[0].href).toBe("/instructor");
    // A Core TA cannot create courses or manage enrollments, so neither staff task promises it.
    expect(
      onboardingTasks("core", "TA")
        .map((task) => task.label)
        .slice(0, 2),
    ).toEqual(["Find your teaching course", "Review the course's materials and topics"]);
  });
});

describe("onboarding progress", () => {
  const navigate = vi.fn();
  it("saves explicit completion across remounts and keeps accounts separate", () => {
    const props = { platform: "core" as const, role: "STUDENT", navigate };
    const view = render(<OnboardingChecklist {...props} userId="one" />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByText("1 of 5 done")).toBeInTheDocument();
    view.rerender(<OnboardingChecklist {...props} userId="two" />);
    expect(screen.getByText("0 of 5 done")).toBeInTheDocument();
    view.rerender(<OnboardingChecklist {...props} userId="one" />);
    // Started, so it comes back collapsed; expanding is remembered from here on.
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getAllByRole("checkbox")[0]).toBeChecked();
    view.unmount();
    render(<OnboardingChecklist {...props} userId="one" />);
    expect(screen.getByText("1 of 5 done")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByText("0 of 5 done")).toBeInTheDocument();
  });
  it("does not mark a task done just because its destination was opened", () => {
    render(<OnboardingChecklist platform="core" role="STUDENT" userId="one" navigate={navigate} />);
    fireEvent.click(screen.getAllByRole("button", { name: /^Open / })[0]);
    expect(navigate).toHaveBeenCalledWith("/courses");
    expect(screen.getByText("0 of 5 done")).toBeInTheDocument();
  });
  it("handles corrupted storage and reports unavailable persistence", () => {
    window.localStorage.setItem("eduai:onboarding:v1:core:one", "not json");
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<OnboardingChecklist platform="core" role="STUDENT" userId="one" navigate={navigate} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByText(/Progress cannot be saved/)).toBeInTheDocument();
    expect(screen.getByText("1 of 5 done")).toBeInTheDocument();
    spy.mockRestore();
  });
  it("remembers collapse and close per account across remounts", () => {
    const props = { platform: "core" as const, role: "STUDENT", navigate };
    const view = render(<OnboardingChecklist {...props} userId="one" />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Expand" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    view.unmount();
    const collapsed = render(<OnboardingChecklist {...props} userId="one" />);
    expect(screen.getByText("0 of 5 done")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(5);
    fireEvent.click(screen.getByRole("button", { name: "Close getting started" }));
    expect(screen.queryByText("Getting started")).not.toBeInTheDocument();
    collapsed.unmount();
    render(<OnboardingChecklist {...props} userId="one" />);
    expect(screen.queryByText("Getting started")).not.toBeInTheDocument();
    cleanup();
    render(<OnboardingChecklist {...props} userId="two" />);
    expect(screen.getByText("Getting started")).toBeInTheDocument();
  });
  it("keeps the dashboard when closed, says how to undo it, and reopens from the header button", async () => {
    const props = { platform: "core" as const, role: "STUDENT", userId: "one", navigate };
    render(
      <>
        <Toaster />
        <GettingStartedButton {...props} pathname="/dashboard" />
        <OnboardingChecklist {...props}>
          <p>Dashboard body</p>
        </OnboardingChecklist>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close getting started" }));
    expect(screen.queryByText("Getting started")).not.toBeInTheDocument();
    expect(screen.getByText("Dashboard body")).toBeInTheDocument();
    expect(
      await screen.findByText(/Bring it back anytime with the checklist icon in the top bar/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show getting started checklist" }));
    expect(screen.getByText("Getting started")).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalledWith("/dashboard");
    cleanup();
    render(<GettingStartedButton {...props} pathname="/settings" />);
    fireEvent.click(screen.getByRole("button", { name: "Show getting started checklist" }));
    expect(navigate).toHaveBeenCalledWith("/dashboard");
    expect(window.localStorage.getItem("eduai:onboarding:v1:core:one:panel")).toBe("open");
  });
});

describe("inline checklist with its own tasks", () => {
  const tasks = [
    { id: "admin.invite-user", label: "Invite a user", href: "/admin/invitations" },
    { id: "admin.review-roles", label: "Review user roles", href: "/admin/users" },
  ];

  it("renders only the card with the given tasks, and opens each task's page", () => {
    const navigate = vi.fn();
    render(
      <OnboardingChecklist
        platform="core"
        role="ADMIN"
        userId="a1"
        navigate={navigate}
        tasks={tasks}
        layout="inline"
        intro="Tick each task when done."
      >
        <p>dashboard body</p>
      </OnboardingChecklist>,
    );
    expect(screen.queryByText("dashboard body")).toBeNull();
    expect(screen.getByText("0 of 2 done")).toBeInTheDocument();
    expect(screen.getByText("Tick each task when done.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open Review user roles" }));
    expect(navigate).toHaveBeenCalledWith("/admin/users");
  });

  it("collapses but cannot be closed, and still shows when the aside card was closed", () => {
    window.localStorage.setItem("eduai:onboarding:v1:core:a1:panel", "dismissed");
    render(
      <OnboardingChecklist
        platform="core"
        role="ADMIN"
        userId="a1"
        navigate={vi.fn()}
        tasks={tasks}
        layout="inline"
      />,
    );
    expect(screen.queryByRole("button", { name: "Close getting started" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.queryByText("Invite a user")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
  });
});

/** A dashboard with local state, so a remount would show up as a reset counter. */
function Dashboard({ withSlot = false }: { withSlot?: boolean }) {
  const [clicks, setClicks] = React.useState(0);
  return (
    <div>
      <button type="button" onClick={() => setClicks((n) => n + 1)}>
        clicked {clicks}
      </button>
      {withSlot && <aside aria-label="Side" {...{ [ONBOARDING_SLOT_ATTRIBUTE]: "" }} />}
    </div>
  );
}

function LateDashboard() {
  const [loaded, setLoaded] = React.useState(false);
  React.useEffect(() => {
    const t = setTimeout(() => setLoaded(true), 0);
    return () => clearTimeout(t);
  }, []);
  return loaded ? <Dashboard withSlot /> : <p>Loading</p>;
}

describe("onboarding placement", () => {
  const navigate = vi.fn();
  const props = { platform: "core" as const, role: "STUDENT", userId: "one", navigate };

  it("comes back collapsed to a one-line strip once a task is done, unless kept open", () => {
    window.localStorage.setItem("eduai:onboarding:v1:core:one", "core.courses");
    const view = render(
      <OnboardingChecklist {...props}>
        <Dashboard />
      </OnboardingChecklist>,
    );
    expect(screen.getByRole("button", { name: "Expand" })).toBeInTheDocument();
    expect(view.container.innerHTML).not.toContain("w-80");
    // Expanding and collapsing moves the card, never the dashboard.
    fireEvent.click(screen.getByRole("button", { name: "clicked 0" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    expect(screen.getByRole("button", { name: "clicked 1" })).toBeInTheDocument();
  });

  it("renders inside the dashboard's side column when it offers a slot", () => {
    const view = render(
      <OnboardingChecklist {...props}>
        <Dashboard withSlot />
      </OnboardingChecklist>,
    );
    const side = screen.getByRole("complementary", { name: "Side" });
    expect(within(side).getByText("Getting started")).toBeInTheDocument();
    expect(view.container.innerHTML).not.toContain("w-80");
  });

  it("keeps focus on the toggle across expand, collapse, and a move into the slot", async () => {
    window.localStorage.setItem("eduai:onboarding:v1:core:one", "core.courses");
    const view = render(
      <OnboardingChecklist {...props}>
        <Dashboard />
      </OnboardingChecklist>,
    );
    const toggle = screen.getByRole("button", { name: "Expand" });
    toggle.focus();
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Collapse" })).toBe(toggle);
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(toggle);
    view.rerender(
      <OnboardingChecklist {...props}>
        <Dashboard withSlot />
      </OnboardingChecklist>,
    );
    await act(async () => {});
    const side = screen.getByRole("complementary", { name: "Side" });
    expect(within(side).getByRole("button", { name: "Expand" })).toBe(toggle);
    expect(document.activeElement).toBe(toggle);
  });

  it("does not re-query for the slot while it is still on the page", async () => {
    render(
      <OnboardingChecklist {...props}>
        <Dashboard withSlot />
      </OnboardingChecklist>,
    );
    const spy = vi.spyOn(Element.prototype, "querySelector");
    fireEvent.click(screen.getByRole("button", { name: "Collapse" }));
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    await act(async () => {});
    const slotQueries = spy.mock.calls.filter(([s]) => s === `[${ONBOARDING_SLOT_ATTRIBUTE}]`);
    spy.mockRestore();
    expect(slotQueries).toHaveLength(0);
    expect(
      within(screen.getByRole("complementary", { name: "Side" })).getByText("Getting started"),
    ).toBeInTheDocument();
  });

  it("moves into a slot that only appears once the dashboard has loaded", async () => {
    render(
      <OnboardingChecklist {...props}>
        <LateDashboard />
      </OnboardingChecklist>,
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    const side = screen.getByRole("complementary", { name: "Side" });
    expect(within(side).getByText("Getting started")).toBeInTheDocument();
  });
});

describe("page tours", () => {
  it("starts only on request and closes when navigating to a different page", () => {
    const view = render(<PageTourButton platform="core" pathname="/courses" role="STUDENT" />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Play page tour" }));
    // Portalled to <body>, so the sticky header's stacking context can't put it under Penny.
    expect(view.container.contains(screen.getByRole("dialog"))).toBe(false);
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
  it("reserves no column before the saved state is read, so a closed card never moves the dashboard", () => {
    // Server and first-paint markup: no effects have run, so nothing is known about the account yet.
    const html = renderToString(
      <OnboardingChecklist platform="core" userId="u1" role="INSTRUCTOR" navigate={vi.fn()}>
        <p>Dashboard</p>
      </OnboardingChecklist>,
    );
    expect(html).toContain("Dashboard");
    expect(html).not.toContain("w-80");
    expect(html).not.toContain("Getting started");
  });
});

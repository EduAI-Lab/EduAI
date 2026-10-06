import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { LocalTour } from "../tour/local-tour";
import type { TourDefinition } from "../tour/tour-engine";
import { TourProvider, useAutoStartTour, useTour } from "../tour/tour-provider";

const TOURS = {
  basic: {
    id: "basic",
    storageKey: "test:tour:basic",
    steps: [
      { id: "welcome", title: "Welcome", body: "Start here." },
      { id: "absent", target: "missing", title: "Absent", body: "Skipped.", waitMs: 0 },
      { id: "hero", target: "hero", title: "Hero", body: "The hero." },
    ],
  },
  journey: {
    id: "journey",
    storageKey: "test:tour:journey",
    seedRoutes: (pathname) => ({ course: /^\/courses\/\d+$/.test(pathname) ? pathname : null }),
    steps: [
      {
        id: "card",
        route: "/courses",
        target: "course-card",
        emptyTarget: "courses-empty",
        captureRoute: "course",
        title: "Pick a course",
        body: "card",
      },
      {
        id: "inside",
        route: (r) => r.course && `${r.course}?tab=questions`,
        target: "course-page",
        title: "Inside the course",
        body: "inside",
      },
    ],
  },
} satisfies Record<string, TourDefinition>;

/** Minimal in-memory router: each path renders the targets its page would have. */
function Page({ path }: { path: string }) {
  if (path === "/courses") {
    return (
      <div data-tour="course-card" data-tour-route="/courses/7">
        Course 7
      </div>
    );
  }
  if (path.startsWith("/courses/")) return <div data-tour="course-page">Course page</div>;
  return <div data-tour="hero">Hero</div>;
}

let controls: ReturnType<typeof useTour>;
function Capture() {
  controls = useTour();
  return null;
}

function Harness({ initial = "/", autoStart }: { initial?: string; autoStart?: string }) {
  const [location, setLocation] = React.useState(() => {
    const [pathname, search = ""] = initial.split("?");
    return { pathname, search: search ? `?${search}` : "" };
  });
  const navigate = React.useCallback((to: string) => {
    const [pathname, search = ""] = to.split("?");
    setLocation({ pathname, search: search ? `?${search}` : "" });
  }, []);
  return (
    <TourProvider tours={TOURS} location={location} navigate={navigate}>
      <Capture />
      {autoStart ? <AutoStart id={autoStart} /> : null}
      <span data-testid="location">{location.pathname + location.search}</span>
      <Page path={location.pathname} />
    </TourProvider>
  );
}

function AutoStart({ id }: { id: string }) {
  useAutoStartTour(id);
  return null;
}

describe("TourProvider", () => {
  beforeEach(() => localStorage.clear());

  it("walks the steps, skipping one whose target never appears", async () => {
    render(<Harness />);
    act(() => controls.startTour("basic"));
    expect(await screen.findByText("Welcome")).toBeInTheDocument();
    expect(screen.getByText("1 of 3")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByRole("heading", { name: "Hero" })).toBeInTheDocument();
    expect(screen.queryByText("Absent")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("marks the tour seen when finished or skipped", async () => {
    render(<Harness />);
    act(() => controls.startTour("basic"));
    fireEvent.click(await screen.findByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.queryByTestId("tour-overlay")).not.toBeInTheDocument());
    expect(localStorage.getItem("test:tour:basic")).toBe("1");
    expect(controls.hasSeenTour("basic")).toBe(true);
  });

  it("closes on Escape", async () => {
    render(<Harness />);
    act(() => controls.startTour("basic"));
    await screen.findByText("Welcome");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(controls.isRunning).toBe(false));
  });

  it("navigates to each step's page and follows a captured route", async () => {
    render(<Harness initial="/dashboard" />);
    act(() => controls.startTour("journey"));
    expect(await screen.findByText("Pick a course")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/courses");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Inside the course")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/courses/7?tab=questions");
  });

  it("starts inside a course when launched from one", async () => {
    render(<Harness initial="/courses/3" />);
    act(() => controls.startTour("journey"));
    expect(await screen.findByText("Inside the course")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/courses/3?tab=questions");
  });

  it("auto-starts once for a viewer who hasn't seen the tour", async () => {
    const { unmount } = render(<Harness autoStart="basic" />);
    expect(await screen.findByText("Welcome")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    unmount();

    render(<Harness autoStart="basic" />);
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByText("Welcome")).not.toBeInTheDocument();
  });
});

/** Stand-in for a dialog body: one present target, one absent. */
function Dialog() {
  const [open, setOpen] = React.useState(true);
  return (
    <div>
      <div data-tour="first">First field</div>
      <LocalTour
        open={open}
        onOpenChange={setOpen}
        steps={[
          { id: "a", target: "first", title: "Step A", body: "a" },
          { id: "b", target: "nowhere", title: "Step B", body: "b" },
        ]}
      />
    </div>
  );
}

describe("LocalTour", () => {
  it("runs a single-screen tour in place and skips absent targets", () => {
    render(<Dialog />);
    expect(screen.getByText("Step A")).toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    // Step B's target is absent, so A is the last step.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByTestId("tour-overlay")).not.toBeInTheDocument();
  });
});

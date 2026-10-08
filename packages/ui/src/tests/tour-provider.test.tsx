import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  firstMissing: {
    id: "firstMissing",
    storageKey: "test:tour:firstMissing",
    steps: [
      { id: "gone", target: "missing", title: "Gone", body: "Never shown.", waitMs: 0 },
      { id: "hero", target: "hero", title: "Hero", body: "The hero." },
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

  it("returns to the current step when Back finds the earlier target missing", async () => {
    render(<Harness />);
    act(() => controls.startTour("firstMissing"));
    expect(await screen.findByRole("heading", { name: "Hero" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "Hero" })).toBeInTheDocument());
    expect(screen.queryByText("Gone")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(controls.isRunning).toBe(false));
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

/** A dialog whose (?) button opens its tour after mount, so the target exists. */
function OpenedLater() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => setOpen(true), []);
  return (
    <div>
      <div data-tour="first">Generate</div>
      <LocalTour
        open={open}
        onOpenChange={setOpen}
        steps={[{ id: "a", target: "first", title: "Step A", body: "a" }]}
      />
    </div>
  );
}

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
  }) as DOMRect;

describe("LocalTour", () => {
  it("runs a single-screen tour in place and skips absent targets", () => {
    render(<Dialog />);
    expect(screen.getByText("Step A")).toBeInTheDocument();
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    // Step B's target is absent, so A is the last step.
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.queryByTestId("tour-overlay")).not.toBeInTheDocument();
  });

  describe("inside a dialog that is its containing block", () => {
    afterEach(() => vi.restoreAllMocks());

    it("keeps the card inside the dialog box, which clips it, not just the viewport", () => {
      // A centred dialog at x=145..1295 in a 1440px viewport, with the target
      // near its top-right corner (QM's Generate button).
      vi.spyOn(window, "innerWidth", "get").mockReturnValue(1440);
      vi.spyOn(window, "innerHeight", "get").mockReturnValue(661);
      vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
        function (this: Element) {
          if (this.getAttribute("data-testid") === "tour-overlay") return rect(145, 34, 1150, 593);
          if (this.getAttribute("data-tour") === "first") return rect(1128, 58, 103, 36);
          return rect(0, 0, 0, 0);
        },
      );

      render(<OpenedLater />);
      const card = screen.getByText("Step A").closest<HTMLElement>("[style]")!;
      const left = parseFloat(card.style.left);
      expect(left).toBeGreaterThanOrEqual(16);
      expect(left + 340).toBeLessThanOrEqual(1150 - 16);
    });
  });
});

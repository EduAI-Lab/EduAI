/**
 * Unit tests for HelpPage (#1544): search filtering, empty-search state,
 * shortcut list, and guided-tour relaunch wiring — plus the #1055 hash deep
 * links that open one accordion article.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";

const { startTourMock } = vi.hoisted(() => ({ startTourMock: vi.fn() }));
vi.mock("@eduai/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@eduai/ui")>()),
  useTour: () => ({ startTour: startTourMock }),
}));

import { HelpPage } from "@/pages/HelpPage";
import { QUESTION_MAKER_HELP } from "@/lib/helpHints";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderHelp(path = "/help") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <HelpPage />
    </MemoryRouter>,
  );
}

const trigger = (name: string) => screen.getByRole("button", { name });

describe("HelpPage", () => {
  it("renders all articles by default", () => {
    renderHelp();
    expect(screen.getByText("Before you start")).toBeInTheDocument();
    expect(screen.getByText("Tips & common issues")).toBeInTheDocument();
  });

  it("filters articles by title search", () => {
    renderHelp();
    const search = screen.getByLabelText("Search help topics");
    fireEvent.change(search, { target: { value: "variants" } });
    expect(screen.getByText("Create variants of a question")).toBeInTheDocument();
    expect(screen.queryByText("Before you start")).not.toBeInTheDocument();
  });

  it("filters articles by keyword search", () => {
    renderHelp();
    const search = screen.getByLabelText("Search help topics");
    fireEvent.change(search, { target: { value: "ocr" } });
    expect(screen.getByText("Upload PDF/Image → extract questions")).toBeInTheDocument();
  });

  it("shows a no-match message for unmatched search terms", () => {
    renderHelp();
    const search = screen.getByLabelText("Search help topics");
    fireEvent.change(search, { target: { value: "zzzznomatch" } });
    expect(screen.getByText("No topics match “zzzznomatch”.")).toBeInTheDocument();
  });

  it("renders the keyboard shortcuts list", () => {
    renderHelp();
    expect(screen.getByText("Open command palette")).toBeInTheDocument();
    expect(screen.getByText("Save in composer")).toBeInTheDocument();
  });

  it("starts the guided tour when the relaunch button is clicked", () => {
    renderHelp();
    fireEvent.click(screen.getByText("Relaunch guided tour"));
    expect(startTourMock).toHaveBeenCalledWith("main");
  });

  it("opens no article when there is no hash", () => {
    renderHelp();
    expect(trigger("Before you start")).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { expanded: true })).not.toBeInTheDocument();
  });

  it("opens, scrolls to and focuses the article a valid hash names", () => {
    const scrolled: string[] = [];
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(
      function (this: HTMLElement) {
        scrolled.push(this.id);
      },
    );
    renderHelp("/help#export-readiness");

    const button = trigger("Export readiness");
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveFocus();
    expect(scrolled).toEqual(["export-readiness"]);
    expect(screen.getByText(/every variant in it is marked reviewed/)).toBeVisible();
    expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
  });

  it.each(["#not-a-section", "#%E0%A4%A", "#"])(
    "fails safely on the unknown or malformed hash %s",
    (hash) => {
      const scroll = vi.spyOn(HTMLElement.prototype, "scrollIntoView");
      expect(() => renderHelp(`/help${hash}`)).not.toThrow();
      expect(screen.queryByRole("button", { expanded: true })).not.toBeInTheDocument();
      expect(scroll).not.toHaveBeenCalled();
    },
  );

  it("keeps normal accordion toggling after opening from a hash", () => {
    renderHelp("/help#topics");
    fireEvent.click(trigger("Before you start"));
    expect(trigger("Before you start")).toHaveAttribute("aria-expanded", "true");
    expect(trigger("Primary and secondary topics")).toHaveAttribute("aria-expanded", "false");
  });

  it("opens a newly linked article while already on the page, clearing the search", async () => {
    vi.spyOn(HTMLElement.prototype, "scrollIntoView").mockImplementation(() => {});
    const router = createMemoryRouter([{ path: "/help", element: <HelpPage /> }], {
      initialEntries: ["/help#topics"],
    });
    render(<RouterProvider router={router} />);
    fireEvent.change(screen.getByLabelText("Search help topics"), {
      target: { value: "topics" },
    });

    await act(() => router.navigate("/help#draft-vs-reviewed"));
    expect(screen.getByLabelText("Search help topics")).toHaveValue("");
    expect(trigger("Draft vs reviewed")).toHaveAttribute("aria-expanded", "true");
    expect(trigger("Primary and secondary topics")).toHaveAttribute("aria-expanded", "false");
  });

  it.each(Object.entries(QUESTION_MAKER_HELP))(
    "HelpHint %s links to an article that exists",
    (_key, hint) => {
      expect(hint.href).toMatch(/^\/help#[a-z0-9-]+$/);
      expect(hint.details.length).toBeGreaterThan(hint.summary.length);
      const { container } = renderHelp(hint.href);
      const id = hint.href.split("#")[1];
      const item = container.querySelector(`#${id}`);
      expect(item, `missing help article #${id}`).not.toBeNull();
      expect(item!.querySelector("[data-slot=accordion-trigger]")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    },
  );
});

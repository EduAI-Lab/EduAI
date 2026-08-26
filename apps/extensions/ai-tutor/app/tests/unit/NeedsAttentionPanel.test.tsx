import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NeedsAttentionPanel } from "~/components/dashboard/NeedsAttentionPanel";
import type { AuthUser } from "~/hooks/useLocalUser";
import type { Course } from "~/lib/types";

/**
 * The dashboard's publish control (#1611).
 *
 * The e2e suite drives the happy path only, so every failure branch, the
 * compact rows, the revalidation behind the row disappearing and the empty
 * state were unpinned. All of that lives in this component, so it is cheaper
 * and more precise to assert here than through a browser.
 */
const mockPublishCourse = vi.fn();
const mockNavigate = vi.fn();
const mockRevalidate = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

let mockUser: AuthUser = {
  id: "u1",
  name: "Unit Admin",
  role: "UNIT_ADMIN",
  authorizedUnits: ["CPSC"],
};

vi.mock("~/lib/api", () => ({
  default: { publishCourse: (...args: unknown[]) => mockPublishCourse(...args) },
}));

vi.mock("~/hooks/useLocalUser", () => ({ useLocalUser: () => ({ user: mockUser }) }));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

vi.mock("react-router", async (importActual) => {
  const actual = await importActual<typeof import("react-router")>();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useRevalidator: () => ({ revalidate: mockRevalidate, state: "idle" }),
  };
});

function course(id: number, code: string, isPublished = false): Course {
  return {
    id,
    code,
    title: `${code} course title`,
    isPublished,
  } as unknown as Course;
}

function renderPanel(courses: Course[], total?: number) {
  return render(
    <MemoryRouter>
      <NeedsAttentionPanel courses={courses} coursesBaseHref="/instructor" total={total} />
    </MemoryRouter>,
  );
}

/** Click a publish control and confirm the dialog it opens. */
async function publishAndConfirm(name: RegExp) {
  fireEvent.click(screen.getByRole("button", { name }));
  fireEvent.click(await screen.findByRole("button", { name: "Publish" }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUser = { id: "u1", name: "Unit Admin", role: "UNIT_ADMIN", authorizedUnits: ["CPSC"] };
  mockPublishCourse.mockResolvedValue({ id: 1, isPublished: true });
});

describe("NeedsAttentionPanel — publish failure branches", () => {
  it("keeps the row in the panel and reports the failure when the write is refused", async () => {
    mockPublishCourse.mockRejectedValue(new Error("403"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderPanel([course(1, "CPSC 101")]);

    await publishAndConfirm(/^Publish CPSC 101/);

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringContaining("CPSC 101")),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
    // The optimistic hide must not apply to a write that never landed.
    expect(screen.getByRole("button", { name: /^Publish CPSC 101/ })).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(mockRevalidate).not.toHaveBeenCalled();
  });

  it("says so when Core accepted the write but could not confirm it back", async () => {
    // #225 SEAM-04 — reporting this as a confirmed publish would be a lie.
    mockPublishCourse.mockResolvedValue({ id: 1, isPublished: true, corePublishStale: true });
    renderPanel([course(1, "CPSC 101")]);

    await publishAndConfirm(/^Publish CPSC 101/);

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(expect.stringContaining("confirmed it back")),
    );
    expect(toastSuccess).not.toHaveBeenCalledWith(
      expect.stringContaining("now visible to students"),
    );
  });

  it("reports a plain success when Core confirms the publish", async () => {
    renderPanel([course(1, "CPSC 101")]);

    await publishAndConfirm(/^Publish CPSC 101/);

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        expect.stringContaining("CPSC 101 is now visible to students"),
      ),
    );
  });

  it("leaves the course a draft when the confirm is cancelled", async () => {
    renderPanel([course(1, "CPSC 101")]);

    fireEvent.click(screen.getByRole("button", { name: /^Publish CPSC 101/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    expect(mockPublishCourse).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /^Publish CPSC 101/ })).toBeInTheDocument();
    expect(screen.getByText("Draft")).toBeInTheDocument();
  });

  it("names the course in the confirm and states that publishing does not cascade", async () => {
    renderPanel([course(1, "CPSC 101")]);

    fireEvent.click(screen.getByRole("button", { name: /^Publish CPSC 101/ }));

    // Scoped to the confirm: the panel row behind it names the same course, so
    // an unscoped query matches twice and proves nothing about the dialog.
    const confirm = within(await screen.findByRole("alertdialog"));
    expect(confirm.getByText(/CPSC 101 course title/)).toBeInTheDocument();
    expect(
      confirm.getByText(/modules and lessons stay hidden until you publish them individually/i),
    ).toBeInTheDocument();
  });
});

describe("NeedsAttentionPanel — more than one draft", () => {
  const twoDrafts = () => [course(1, "CPSC 101"), course(2, "CPSC 210")];

  it("publishes the course whose own row control was clicked, not the hero", async () => {
    renderPanel(twoDrafts());

    await publishAndConfirm(/^Publish CPSC 210/);

    await waitFor(() => expect(mockPublishCourse).toHaveBeenCalledWith(2));
    expect(mockPublishCourse).not.toHaveBeenCalledWith(1);
  });

  it("removes only the published row and re-runs the loader behind it", async () => {
    renderPanel(twoDrafts());

    await publishAndConfirm(/^Publish CPSC 210/);

    // The tiles and donut above the panel come from the dashboard loader, so
    // they only follow the panel if the revalidation actually fires.
    await waitFor(() => expect(mockRevalidate).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Publish CPSC 210/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: /^Publish CPSC 101/ })).toBeInTheDocument();
  });

  it("renders at most four compact rows beneath the hero", () => {
    renderPanel([1, 2, 3, 4, 5, 6, 7].map((id) => course(id, `CPSC ${id}00`)));

    // One hero plus four rows; the seventh draft is only reachable via search.
    expect(screen.getAllByRole("button", { name: /^Publish CPSC/ })).toHaveLength(5);
  });

  it("opens a compact row's course without publishing it", async () => {
    renderPanel(twoDrafts());

    fireEvent.click(screen.getByRole("button", { name: /^CPSC 210/ }));

    expect(mockNavigate).toHaveBeenCalledWith("/instructor/courses/2");
    expect(mockPublishCourse).not.toHaveBeenCalled();
  });
});

describe("NeedsAttentionPanel — empty and gated states", () => {
  it("says it is all caught up, and still discloses the page bound", () => {
    renderPanel([course(1, "CPSC 101", true)], 12);

    expect(screen.getByText("All caught up")).toBeInTheDocument();
    // "Every course you can see is published" is only true of this page (#1208).
    expect(screen.getByText(/12/)).toBeInTheDocument();
  });

  it("falls back to caught-up once the last draft has been published from here", async () => {
    renderPanel([course(1, "CPSC 101")]);

    await publishAndConfirm(/^Publish CPSC 101/);

    expect(await screen.findByText("All caught up")).toBeInTheDocument();
  });

  it("hides both publish controls from a role that cannot publish", () => {
    // The guard is unreachable from the two dashboards that render this panel
    // (both roles satisfy it) — this pins the defensive branch itself.
    mockUser = { id: "u2", name: "Student", role: "STUDENT", authorizedUnits: [] };
    renderPanel([course(1, "CPSC 101"), course(2, "CPSC 210")]);

    expect(screen.queryByRole("button", { name: /^Publish CPSC/ })).not.toBeInTheDocument();
    // The drafts are still listed, and still openable.
    expect(screen.getByRole("button", { name: /Open CPSC 101 first/ })).toBeInTheDocument();
  });
});

/**
 * Unit tests for Core's breadcrumb course switcher (#1041, #1143).
 *
 * The picker used to read an unbounded course list. It now takes one bounded
 * 200-row page and re-queries Core with `?search=` as the user types, so what
 * matters is that the request always carries paging params (an unpaged read now
 * 400s), that a failed or malformed response degrades to the current course
 * instead of an empty dropdown, and that the seeded label is dropped once a
 * search is active — seeding it there would render the current course as if it
 * had matched the query.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { CourseSwitcher } from "~/components/layout/course-switcher";

const props = {
  currentCourseId: "course-1",
  currentCourseCode: "CS101",
  currentCourseName: "Intro to CS",
};

function renderSwitcher(overrides: Partial<typeof props> = {}) {
  const router = createMemoryRouter(
    [{ path: "/", element: <CourseSwitcher {...props} {...overrides} /> }],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

function courseUrls(mockFetch: ReturnType<typeof vi.fn>) {
  return mockFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/courses?"));
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve({
        data: [
          { id: "course-1", code: "CS101", name: "Intro to CS" },
          { id: "course-2", code: "CS201", name: "Data Structures" },
        ],
        total: 2,
        page: 1,
        pageSize: 200,
      }),
  });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CourseSwitcher", () => {
  it("requests one bounded page with paging params — an unpaged read would 400", async () => {
    renderSwitcher();

    await waitFor(() => expect(courseUrls(mockFetch)).toHaveLength(1));
    const url = courseUrls(mockFetch)[0];
    expect(url).toContain("page=1");
    expect(url).toContain("pageSize=200");
    // No search typed yet, so no filter is sent.
    expect(url).not.toContain("search=");
  });

  it("renders the current course label immediately, before the list resolves", () => {
    renderSwitcher();

    // Seeded from props so the trigger doesn't flash name→code on resolve.
    expect(screen.getByText("CS101")).toBeInTheDocument();
  });

  it("falls back to the course name when it has no code", () => {
    renderSwitcher({ currentCourseCode: "" });

    expect(screen.getByText("Intro to CS")).toBeInTheDocument();
  });

  it("keeps showing the current course when the list request fails", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: () => Promise.resolve({}) });

    renderSwitcher();

    await waitFor(() => expect(courseUrls(mockFetch)).toHaveLength(1));
    // Non-fatal: a 400 PAGINATION_REQUIRED must not blank the breadcrumb.
    expect(screen.getByText("CS101")).toBeInTheDocument();
  });

  it("survives a rejected fetch without throwing", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));

    renderSwitcher();

    await waitFor(() => expect(courseUrls(mockFetch)).toHaveLength(1));
    expect(screen.getByText("CS101")).toBeInTheDocument();
  });

  it("tolerates an envelope with no data array", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ total: 0, page: 1, pageSize: 200 }),
    });

    renderSwitcher();

    await waitFor(() => expect(courseUrls(mockFetch)).toHaveLength(1));
    expect(screen.getByText("CS101")).toBeInTheDocument();
  });

  it("drops a stale in-flight response when the component unmounts", async () => {
    let resolveFetch: (value: unknown) => void = () => {};
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { unmount } = renderSwitcher();
    await waitFor(() => expect(courseUrls(mockFetch)).toHaveLength(1));
    unmount();

    // Resolving after unmount must not attempt a setState on a dead component.
    resolveFetch({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ data: [], total: 0, page: 1, pageSize: 200 }),
    });
    await Promise.resolve();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

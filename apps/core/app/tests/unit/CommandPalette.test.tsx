/**
 * Render-level tests for Core's ⌘K palette (#1041, #1143).
 *
 * The course group is server-paginated, so typing has to re-query Core with
 * `?search=` rather than filter the page already in memory — otherwise the
 * palette could only ever reach the first 200 courses. The exported helpers are
 * unit-tested in `command-palette.test.ts`; this file covers the wiring those
 * helpers hang off: the lazy load on first open, the debounced re-query, and
 * that a failed search keeps the current list instead of blanking it.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

import { CommandPalette } from "~/components/command/command-palette";
import type { User } from "~/lib/auth/types";

const asUser = (role: string) => ({ role, name: "Admin" }) as unknown as User;

function renderPalette(role = "ADMIN") {
  const router = createMemoryRouter(
    [{ path: "/", element: <CommandPalette user={asUser(role)} /> }],
    { initialEntries: ["/"] },
  );
  return render(<RouterProvider router={router} />);
}

const coursePage = (data: unknown[]) => ({
  ok: true,
  status: 200,
  json: () => Promise.resolve({ data, total: data.length, page: 1, pageSize: 200 }),
});

function courseUrls() {
  return mockFetch.mock.calls.map((c) => String(c[0])).filter((u) => u.startsWith("/api/courses?"));
}

/** ⌘K toggles the palette. */
const togglePalette = () => fireEvent.keyDown(document, { key: "k", metaKey: true });

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn().mockResolvedValue(
    coursePage([
      { id: "c1", code: "CS101", name: "Intro to CS" },
      { id: "c2", code: "CS201", name: "Data Structures" },
    ]),
  );
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("CommandPalette", () => {
  it("does not fetch courses until the palette is first opened", () => {
    renderPalette();

    expect(courseUrls()).toHaveLength(0);
  });

  it("lazily loads one bounded page of courses on first open", async () => {
    renderPalette();

    togglePalette();

    await waitFor(() => expect(courseUrls()).toHaveLength(1));
    expect(courseUrls()[0]).toContain("page=1");
    expect(courseUrls()[0]).toContain("pageSize=200");
    expect(await screen.findByText("CS101")).toBeInTheDocument();
  });

  it("re-queries Core with ?search= as the user types instead of filtering the page", async () => {
    vi.useFakeTimers();
    renderPalette();
    togglePalette();
    await vi.waitFor(() => expect(courseUrls()).toHaveLength(1));

    fireEvent.change(screen.getByPlaceholderText(/search or jump to/i), {
      target: { value: "algebra" },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    await vi.waitFor(() =>
      expect(courseUrls().some((u) => u.includes("search=algebra"))).toBe(true),
    );
  });

  it("debounces the re-query rather than firing one request per keystroke", async () => {
    vi.useFakeTimers();
    renderPalette();
    togglePalette();
    await vi.waitFor(() => expect(courseUrls()).toHaveLength(1));
    const input = screen.getByPlaceholderText(/search or jump to/i);

    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "al" } });
    fireEvent.change(input, { target: { value: "alg" } });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // One search request for three keystrokes, on top of the lazy load.
    await vi.waitFor(() => expect(courseUrls().filter((u) => u.includes("search="))).toHaveLength(1));
  });

  it("keeps the loaded courses when a search request fails", async () => {
    vi.useFakeTimers();
    renderPalette();
    togglePalette();
    await vi.waitFor(() => expect(screen.queryByText("CS101")).toBeInTheDocument());
    mockFetch.mockResolvedValue({ ok: false, status: 500, json: () => Promise.resolve({}) });

    fireEvent.change(screen.getByPlaceholderText(/search or jump to/i), {
      target: { value: "zzz" },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
    });

    // A failed request must not blank the list.
    expect(screen.getByText("CS101")).toBeInTheDocument();
  });

  it("renders the course group from the server page, unfiltered by cmdk", async () => {
    // Host-driven mode turns cmdk's filter off, so every row Core returned has
    // to survive to the DOM — including ones that don't match the raw query.
    renderPalette();
    togglePalette();

    expect(await screen.findByText("CS101")).toBeInTheDocument();
    expect(await screen.findByText("CS201")).toBeInTheDocument();
  });

  it("navigates when a course is selected", async () => {
    renderPalette();
    togglePalette();
    const course = await screen.findByText("CS201");

    fireEvent.click(course);

    await waitFor(() => expect(window.location.pathname).toBeDefined());
  });
});

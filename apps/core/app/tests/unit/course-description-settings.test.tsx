/**
 * #2136 — the Settings tab's course description editor: what it sends, what it
 * shows afterwards, and how a failed save reads.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CourseDescriptionSettings } from "~/components/courses/course-description-settings";

const fetchMock = vi.fn();

function renderEditor(initialDescription = "", onSaved?: () => void) {
  render(
    <CourseDescriptionSettings
      courseId="c1"
      initialDescription={initialDescription}
      onSaved={onSaved}
    />,
  );
  return screen.getByLabelText("Description");
}

function lastBody() {
  return JSON.parse(fetchMock.mock.calls.at(-1)![1].body);
}

beforeEach(() => vi.stubGlobal("fetch", fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("CourseDescriptionSettings", () => {
  it("saves the trimmed text, shows it trimmed, and tells the page to refresh", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const onSaved = vi.fn();
    const input = renderEditor("", onSaved);

    fireEvent.change(input, { target: { value: "  Intro to data  " } });
    fireEvent.click(screen.getByRole("button", { name: "Save description" }));

    expect(await screen.findByRole("status")).toHaveTextContent("Saved.");
    expect(fetchMock.mock.calls[0][0]).toBe("/api/courses/c1");
    expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
    expect(lastBody()).toEqual({ description: "Intro to data" });
    expect(input).toHaveValue("Intro to data");
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("sends null when the description is cleared", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const input = renderEditor("Old text");

    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save description" }));

    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
    expect(lastBody()).toEqual({ description: null });
  });

  it("drops the Saved. message as soon as the text is edited again", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const input = renderEditor("Old text");
    fireEvent.click(screen.getByRole("button", { name: "Save description" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "Old text, edited" } });

    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("shows the server's reason, or a plain message when it gives none", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => ({ error: "Forbidden" }) });
    renderEditor("x");
    fireEvent.click(screen.getByRole("button", { name: "Save description" }));
    expect(await screen.findByText("Forbidden")).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => {
        throw new Error("not json");
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save description" }));
    expect(await screen.findByText("Could not save the description.")).toBeInTheDocument();
  });

  it("says so when the request never arrives, and keeps the text and the button usable", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const input = renderEditor("Keep me");

    fireEvent.click(screen.getByRole("button", { name: "Save description" }));

    expect(await screen.findByText("Network error.")).toBeInTheDocument();
    expect(input).toHaveValue("Keep me");
    expect(screen.getByRole("button", { name: "Save description" })).toBeEnabled();
  });

  it("disables the button while a save is in flight", async () => {
    let finish: (value: { ok: boolean }) => void = () => {};
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderEditor("x");

    fireEvent.click(screen.getByRole("button", { name: "Save description" }));

    expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
    finish({ ok: true });
    expect(await screen.findByRole("button", { name: "Save description" })).toBeEnabled();
  });
});

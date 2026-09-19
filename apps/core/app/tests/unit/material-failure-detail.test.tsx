// #1749: a failed material showed a bare red badge — no reason, no recourse,
// so the only move was to re-upload the file and hope. This is the `(?)` that
// explains the failure and, where it can actually work, retries it from the
// text already stored server-side.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { MaterialFailureDetail } from "~/components/courses/material-failure-detail";
import { describeMaterialFailure } from "~/lib/material-failure-notice";

const indexingFailure = describeMaterialFailure({
  status: "FAILED",
  duplicateOfId: null,
  hasExtractedText: true,
})!;
const unreadableFailure = describeMaterialFailure({
  status: "FAILED",
  duplicateOfId: null,
  hasExtractedText: false,
})!;

beforeEach(() => {
  cleanup();
});

describe("MaterialFailureDetail — revealing the reason", () => {
  it("keeps the explanation behind the (?) instead of crowding every row", () => {
    render(<MaterialFailureDetail notice={indexingFailure} />);

    expect(screen.queryByText(indexingFailure.title)).not.toBeInTheDocument();
  });

  it("gives the (?) an accessible name, so it is not an unlabelled icon button", () => {
    render(<MaterialFailureDetail notice={indexingFailure} />);

    expect(screen.getByRole("button", { name: /why did this fail/i })).toBeInTheDocument();
  });

  it("reveals the failure title and description when the (?) is opened", async () => {
    render(<MaterialFailureDetail notice={indexingFailure} />);

    fireEvent.click(screen.getByRole("button", { name: /why did this fail/i }));

    expect(await screen.findByText(indexingFailure.title)).toBeInTheDocument();
    expect(screen.getByText(indexingFailure.description)).toBeInTheDocument();
  });
});

describe("MaterialFailureDetail — retrying", () => {
  it("offers Try again for a failure whose stored text can be re-indexed", async () => {
    render(<MaterialFailureDetail notice={indexingFailure} onRetry={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /why did this fail/i }));

    expect(await screen.findByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("retries the material without asking for the file again", async () => {
    const onRetry = vi.fn();
    render(<MaterialFailureDetail notice={indexingFailure} onRetry={onRetry} />);

    fireEvent.click(screen.getByRole("button", { name: /why did this fail/i }));
    fireEvent.click(await screen.findByRole("button", { name: /try again/i }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("offers no Try again when the upload bytes are gone, rather than a button that cannot work", async () => {
    render(<MaterialFailureDetail notice={unreadableFailure} onRetry={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /why did this fail/i }));

    expect(await screen.findByText(unreadableFailure.title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });

  it("disables Try again while a retry is already in flight", async () => {
    render(<MaterialFailureDetail notice={indexingFailure} onRetry={vi.fn()} retrying />);

    fireEvent.click(screen.getByRole("button", { name: /why did this fail/i }));

    expect(await screen.findByRole("button", { name: /retrying/i })).toBeDisabled();
  });
});

/**
 * Regression cover for the unbounded fetch loop the three header panels shared
 * (#764 follow-on review, CRITICAL 1). The old guard
 * (`opened && data === null && !loading`, deps `[opened, data, loading, load]`)
 * re-entered on every rejection, so a persistent 401/500 re-requested forever.
 * The first test here fails against that code and passes against the ref-based
 * attempt tracking.
 */
import { describe, it, expect, vi } from "vitest";
import * as React from "react";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";

import { useHistoryOnOpen } from "../hooks/use-history-on-open";

function Harness({ fetcher }: { fetcher: () => Promise<string> }) {
  const { data, loading, error, onOpenChange, refresh } = useHistoryOnOpen(fetcher);
  return (
    <div>
      <button type="button" onClick={() => onOpenChange(true)}>
        open
      </button>
      <button type="button" onClick={() => onOpenChange(false)}>
        close
      </button>
      <button type="button" onClick={refresh}>
        refresh
      </button>
      <span data-testid="data">{data ?? "none"}</span>
      <span data-testid="loading">{loading ? "yes" : "no"}</span>
      <span data-testid="error">{error ?? "none"}</span>
    </div>
  );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useHistoryOnOpen", () => {
  it("attempts a failing fetch exactly once while the panel stays open", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("401"));
    render(<Harness fetcher={fetcher} />);

    fireEvent.click(screen.getByText("open"));
    await flush();
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent(/could not load/i));

    // The loop reproduced as "many calls"; give the old effect several more
    // chances to re-enter before asserting.
    await flush();
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("loading")).toHaveTextContent("no");
  });

  it("fetches once on first open and not again on reopen after success", async () => {
    const fetcher = vi.fn().mockResolvedValue("payload");
    render(<Harness fetcher={fetcher} />);

    fireEvent.click(screen.getByText("open"));
    await flush();
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("payload"));

    fireEvent.click(screen.getByText("close"));
    fireEvent.click(screen.getByText("open"));
    await flush();

    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("retries exactly once when the panel is reopened after a failure", async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error("500")).mockResolvedValue("payload");
    render(<Harness fetcher={fetcher} />);

    fireEvent.click(screen.getByText("open"));
    await flush();
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent(/could not load/i));

    fireEvent.click(screen.getByText("close"));
    fireEvent.click(screen.getByText("open"));
    await flush();
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("payload"));

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("keeps the last payload and surfaces an error when a refresh fails", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce("payload").mockRejectedValue(new Error("boom"));
    render(<Harness fetcher={fetcher} />);

    fireEvent.click(screen.getByText("open"));
    await flush();
    await waitFor(() => expect(screen.getByTestId("data")).toHaveTextContent("payload"));

    fireEvent.click(screen.getByText("refresh"));
    await flush();
    await waitFor(() => expect(screen.getByTestId("error")).toHaveTextContent(/could not load/i));

    expect(screen.getByTestId("data")).toHaveTextContent("payload");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

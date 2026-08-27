import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiTraceRow } from "~/lib/api";

const { mockAdminAiTraces } = vi.hoisted(() => ({ mockAdminAiTraces: vi.fn() }));

vi.mock("~/lib/api", () => ({
  default: { adminAiTraces: mockAdminAiTraces },
}));

import AiOversightPanel from "~/components/admin/AiOversightPanel";

const now = Date.now();

function trace(overrides: Partial<AiTraceRow> = {}): AiTraceRow {
  return {
    id: "trace-1",
    courseId: 1,
    courseTitle: "Math 101",
    activity: { id: 1, title: "Solve for x" },
    mode: "SOCRATIC",
    tutorModelId: "google:gemini-2.5-flash",
    iterationCount: 2,
    finalOutcome: "completed",
    createdAt: new Date(now - 5 * 60_000).toISOString(),
    user: { name: "Ada Lovelace" },
    ...overrides,
  } as AiTraceRow;
}

describe("AiOversightPanel", () => {
  beforeEach(() => {
    mockAdminAiTraces.mockReset();
  });

  it("renders initial trace rows without refetching", () => {
    render(<AiOversightPanel initialTraces={[trace()]} />);

    expect(screen.getByText("AI oversight")).toBeInTheDocument();
    expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    expect(screen.getByText("Math 101")).toBeInTheDocument();
    expect(screen.getByText("Solve for x")).toBeInTheDocument();
    expect(screen.getByText("Socratic")).toBeInTheDocument();
    expect(screen.getByText("5m ago")).toBeInTheDocument();
    expect(mockAdminAiTraces).not.toHaveBeenCalled();
  });

  it("renders an empty state when there are no traces", () => {
    render(<AiOversightPanel initialTraces={[]} />);
    expect(screen.getByText("No AI tutoring interactions yet.")).toBeInTheDocument();
  });

  it("renders defensive fallbacks for missing optional fields", () => {
    render(
      <AiOversightPanel
        initialTraces={[
          {
            id: "trace-2",
            courseId: null,
            courseTitle: null,
            activity: null,
            mode: null,
            tutorModelId: null,
            iterationCount: null,
            finalOutcome: null,
            createdAt: null,
            user: null,
          } as unknown as AiTraceRow,
        ]}
      />,
    );
    expect(screen.getByText("Unknown student")).toBeInTheDocument();
    // Every unresolved optional field renders as an em-dash.
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("badges an error-ish outcome as destructive and a normal one as outline", () => {
    render(
      <AiOversightPanel
        initialTraces={[
          trace({ id: "t-ok", finalOutcome: "completed" }),
          trace({ id: "t-err", finalOutcome: "error_timeout" }),
        ]}
      />,
    );
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Error timeout")).toBeInTheDocument();
  });

  it("refetches with the selected course filter", async () => {
    mockAdminAiTraces.mockResolvedValue([trace({ id: "trace-refetched" })]);
    render(
      <AiOversightPanel
        initialTraces={[trace({ id: "trace-1", courseId: 1, courseTitle: "Math 101" })]}
      />,
    );

    fireEvent.click(screen.getByLabelText("Filter by course"));
    fireEvent.click(await screen.findByRole("option", { name: "Math 101" }));

    await waitFor(() => {
      expect(mockAdminAiTraces).toHaveBeenCalledWith({ courseId: "1", limit: 50 });
    });
  });

  it("refetches with the selected row limit", async () => {
    mockAdminAiTraces.mockResolvedValue([]);
    render(<AiOversightPanel initialTraces={[trace()]} />);

    fireEvent.click(screen.getByLabelText("Rows to show"));
    fireEvent.click(await screen.findByRole("option", { name: "Show 100" }));

    await waitFor(() => {
      expect(mockAdminAiTraces).toHaveBeenCalledWith({ courseId: undefined, limit: 100 });
    });
  });

  it("shows an error alert when the refetch fails", async () => {
    mockAdminAiTraces.mockRejectedValue(new Error("boom"));
    render(<AiOversightPanel initialTraces={[trace()]} />);

    fireEvent.click(screen.getByLabelText("Rows to show"));
    fireEvent.click(await screen.findByRole("option", { name: "Show 200" }));

    expect(
      await screen.findByText("Could not load AI oversight data. Try again."),
    ).toBeInTheDocument();
  });
});

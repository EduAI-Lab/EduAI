import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { BugReportsAdminView } from "@eduai/ui";
import { stubBugReports } from "~/hooks/api/fixtures/platform/bug-reports";
import { toUiStatus } from "@eduai/ui";

// The fixture carries Core's Prisma enum casing; the view renders the UI form.
const rows = stubBugReports.map((r) => ({
  ...r,
  status: toUiStatus(r.status as unknown as string),
  userId: r.id,
})) as never[];

describe("BugReportsAdminView (shared)", () => {
  it("renders bug reports for admin triage", () => {
    render(
      <BugReportsAdminView reports={rows} isLoading={false} onUpdateStatus={vi.fn()} showSourceColumn />,
    );

    expect(screen.getByText("Bug reports")).toBeInTheDocument();
    expect(
      screen.getByText("User reported chatId not persisting in local state."),
    ).toBeInTheDocument();
  });

  it("shows the source column only when asked", () => {
    const { rerender } = render(
      <BugReportsAdminView reports={rows} onUpdateStatus={vi.fn()} showSourceColumn />,
    );
    expect(screen.getByRole("button", { name: /Source/ })).toBeInTheDocument();

    rerender(<BugReportsAdminView reports={rows} onUpdateStatus={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Source/ })).not.toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(<BugReportsAdminView reports={[]} isLoading onUpdateStatus={vi.fn()} />);
    expect(screen.getByText("Loading bug reports…")).toBeInTheDocument();
  });

  it("surfaces a truncation notice", () => {
    render(
      <BugReportsAdminView
        reports={rows}
        onUpdateStatus={vi.fn()}
        notice="Showing the 200 most recent of 512 reports."
      />,
    );
    expect(screen.getByText("Showing the 200 most recent of 512 reports.")).toBeInTheDocument();
  });
});

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { BugReportsAdminView } from "~/components/admin/bug-reports-admin-view";
import { stubBugReports } from "~/hooks/api/fixtures/platform/bug-reports";

describe("BugReportsAdminView", () => {
  it("renders bug reports for admin triage", () => {
    render(
      <BugReportsAdminView
        reports={stubBugReports}
        isLoading={false}
        sourceFilter="ALL"
        onSourceFilterChange={vi.fn()}
        onUpdateStatus={vi.fn()}
      />,
    );

    expect(screen.getByText("Bug reports")).toBeInTheDocument();
    expect(screen.getByText("User reported chatId not persisting in local state.")).toBeInTheDocument();
    expect(screen.getByText("CORE")).toBeInTheDocument();
    expect(screen.getByText("All sources")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(
      <BugReportsAdminView
        reports={[]}
        isLoading
        sourceFilter="ALL"
        onSourceFilterChange={vi.fn()}
        onUpdateStatus={vi.fn()}
      />,
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});

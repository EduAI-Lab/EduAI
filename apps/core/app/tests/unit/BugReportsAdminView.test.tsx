import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { BugReportsAdminView } from "~/components/admin/bug-reports-admin-view";
import { stubBugReports } from "~/hooks/api/fixtures/platform/bug-reports";

describe("BugReportsAdminView", () => {
  it("renders stub bug reports for admin triage", () => {
    render(
      <BugReportsAdminView
        reports={stubBugReports}
        isLoading={false}
        isStubbed
        onUpdateStatus={vi.fn()}
      />,
    );

    expect(screen.getByText("Bug reports")).toBeInTheDocument();
    expect(screen.getByText("Chat session lost after refresh")).toBeInTheDocument();
    expect(screen.getByText("CORE")).toBeInTheDocument();
  });

  it("shows loading state", () => {
    render(
      <BugReportsAdminView
        reports={[]}
        isLoading
        isStubbed
        onUpdateStatus={vi.fn()}
      />,
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });
});

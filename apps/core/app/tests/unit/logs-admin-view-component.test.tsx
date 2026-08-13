/**
 * Component-level coverage for LogsAdminView + LogDetailsDialog.
 *
 * logs-admin-view.test.ts only covers the pure `buildLogsTabLinks` helper —
 * this file exercises the actual rendered component: tab switching, the GET
 * filter <Form>, pagination links, and opening/closing the row details
 * dialog. Since the real component is URL-driven (react-router <Form> /
 * <Link> / useNavigation), a thin wrapper route reads useSearchParams and
 * recomputes the props LogsAdminView would receive from the real route's
 * loader, mounted via createMemoryRouter + RouterProvider so navigations
 * actually happen (a plain MemoryRouter can't drive useNavigation()).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createMemoryRouter,
  RouterProvider,
  useSearchParams,
} from "react-router";

import { LogsAdminView, type LogsTab } from "~/components/admin/logs-admin-view";

const ROWS_BY_TAB: Record<LogsTab, Array<Record<string, unknown>>> = {
  audit: [
    {
      id: "a1",
      createdAt: "2026-08-01T10:00:00.000Z",
      actionCode: "LOGIN",
      category: "USER",
      user: { name: "Alice", role: "ADMIN" },
      entityLabel: "User Alice",
      outcome: "SUCCESS",
      routePath: "/login",
    },
    {
      id: "a2",
      createdAt: "2026-08-02T11:00:00.000Z",
      actionCode: "DELETE_COURSE",
      category: "COURSE",
      actorRole: "INSTRUCTOR",
      entityLabel: "Course X",
      outcome: "DENIED",
      routePath: "/courses/1",
    },
  ],
  security: [
    {
      id: "s1",
      createdAt: "2026-08-01T09:00:00.000Z",
      actionCode: "FAILED_LOGIN",
      user: { name: "Bob" },
      outcome: "FAILURE",
      routePath: "/auth/login",
      ipAddress: "1.2.3.4",
    },
  ],
  system: [
    {
      id: "y1",
      createdAt: "2026-08-01T08:00:00.000Z",
      level: "ERROR",
      source: "AI",
      code: "TIMEOUT",
      message: "Request timed out",
    },
  ],
  servers: [],
};

/**
 * Stands in for the real admin.logs.tsx route: parses URL search params into
 * the same LogsQueryState shape the loader would build, and derives the
 * props LogsAdminView expects — so clicking tab links, submitting the
 * filter <Form>, and clicking pagination links all drive real navigations
 * that this wrapper reacts to, exactly like the real route does.
 */
function LogsPageWrapper() {
  const [searchParams] = useSearchParams();
  const query: Record<string, string | undefined> = {};
  for (const [key, value] of searchParams.entries()) {
    query[key] = value;
  }

  const tab = (query.tab as LogsTab | undefined) ?? "audit";
  const page = Number(query.page ?? "1");
  const pageSize = Number(query.pageSize ?? "25");
  const rows = ROWS_BY_TAB[tab];
  // Audit gets a fake larger total so both Previous and Next pagination
  // links can be exercised across pages.
  const total = tab === "audit" ? 60 : rows.length;
  const hasMore = page * pageSize < total;

  return (
    <LogsAdminView
      tab={tab}
      rows={rows}
      total={total}
      page={page}
      pageSize={pageSize}
      hasMore={hasMore}
      query={query}
      retentionPolicy={{ auditRetentionDays: 90, systemRetentionDays: 30 }}
      serverStats={[]}
      modelStats={[]}
      peakUsageHours={[]}
    />
  );
}

function renderLogsPage(initialPath = "/admin/logs?tab=audit") {
  const router = createMemoryRouter(
    [{ path: "/admin/logs", element: <LogsPageWrapper /> }],
    { initialEntries: [initialPath] },
  );
  const utils = render(<RouterProvider router={router} />);
  return { router, ...utils };
}

describe("LogsAdminView", () => {
  it("renders the audit tab's rows and column headers on initial load", () => {
    renderLogsPage("/admin/logs?tab=audit");

    expect(screen.getByText("Logs")).toBeInTheDocument();
    expect(screen.getByText("LOGIN")).toBeInTheDocument();
    expect(screen.getByText("Alice (ADMIN)")).toBeInTheDocument();
    expect(screen.getByText("DELETE_COURSE")).toBeInTheDocument();
    // actorRole-only fallback (no joined user) still resolves to a display value.
    expect(screen.getByText("INSTRUCTOR")).toBeInTheDocument();
  });

  it("switches to the security tab via the tab links and renders security rows", async () => {
    const { router } = renderLogsPage("/admin/logs?tab=audit");

    // Radix Tabs overrides the accessible role of these <Link>-backed
    // triggers from "link" to "tab".
    fireEvent.click(screen.getByRole("tab", { name: "Security" }));

    await waitFor(() =>
      expect(router.state.location.search).toContain("tab=security"),
    );
    expect(screen.getByText("FAILED_LOGIN")).toBeInTheDocument();
    expect(screen.getByText("1.2.3.4")).toBeInTheDocument();
  });

  it("switches to the system tab and renders system-specific columns", async () => {
    const { router } = renderLogsPage("/admin/logs?tab=audit");

    fireEvent.click(screen.getByRole("tab", { name: "System" }));

    await waitFor(() =>
      expect(router.state.location.search).toContain("tab=system"),
    );
    expect(screen.getByText("TIMEOUT")).toBeInTheDocument();
    expect(screen.getByText("Request timed out")).toBeInTheDocument();
  });

  it("switches to the servers tab and renders the server routing panel instead of the row table", async () => {
    const { router } = renderLogsPage("/admin/logs?tab=audit");

    fireEvent.click(screen.getByRole("tab", { name: "Servers" }));

    await waitFor(() =>
      expect(router.state.location.search).toContain("tab=servers"),
    );
    expect(
      screen.getByText("No fleet servers registered and no fleet-routed interactions found for the selected window."),
    ).toBeInTheDocument();
    expect(screen.getByText("Routing by server")).toBeInTheDocument();
  });

  it("submits the audit filter form with an updated date range, resetting to page 1", async () => {
    const { router, container } = renderLogsPage("/admin/logs?tab=audit&page=2");

    // The design-system Label isn't wired to its Input via htmlFor, so
    // getByLabelText can't resolve these — select by the Form's `name`
    // attribute instead, which is what actually drives the GET submission.
    const dateFromInput = container.querySelector('input[name="dateFrom"]');
    const dateToInput = container.querySelector('input[name="dateTo"]');
    expect(dateFromInput).toBeTruthy();
    expect(dateToInput).toBeTruthy();
    fireEvent.change(dateFromInput as HTMLInputElement, { target: { value: "2026-07-01" } });
    fireEvent.change(dateToInput as HTMLInputElement, { target: { value: "2026-08-01" } });

    fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

    await waitFor(() =>
      expect(router.state.location.search).toContain("dateFrom=2026-07-01"),
    );
    expect(router.state.location.search).toContain("dateTo=2026-08-01");
    expect(router.state.location.search).toContain("page=1");
  });

  it("clears audit filters via the Clear filters link", async () => {
    const { router } = renderLogsPage(
      "/admin/logs?tab=audit&category=COURSE&outcome=DENIED&page=3",
    );

    fireEvent.click(screen.getByRole("link", { name: "Clear filters" }));

    await waitFor(() =>
      expect(router.state.location.search).not.toContain("category"),
    );
    expect(router.state.location.search).not.toContain("outcome");
    expect(router.state.location.search).toContain("page=1");
  });

  it("navigates to the next page via the pagination link", async () => {
    const { router } = renderLogsPage("/admin/logs?tab=audit&page=1&pageSize=25");

    expect(screen.getByText(/Page 1 of/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "Next" }));

    await waitFor(() => expect(router.state.location.search).toContain("page=2"));
    expect(screen.getByText(/Page 2 of/)).toBeInTheDocument();
  });

  it("disables the Previous link (renders a plain span) on page 1", () => {
    renderLogsPage("/admin/logs?tab=audit&page=1&pageSize=25");
    // On page 1 there is no prevHref, so Previous renders as a disabled span, not a link.
    expect(screen.queryByRole("link", { name: "Previous" })).not.toBeInTheDocument();
    expect(screen.getByText("Previous")).toBeInTheDocument();
  });

  it("navigates to the previous page via the pagination link", async () => {
    const { router } = renderLogsPage("/admin/logs?tab=audit&page=2&pageSize=25");
    fireEvent.click(screen.getByRole("link", { name: "Previous" }));

    await waitFor(() => expect(router.state.location.search).toContain("page=1"));
    expect(screen.getByText(/Page 1 of/)).toBeInTheDocument();
  });

  it("opens the details dialog for a row and renders its serialized content, then closes it", async () => {
    renderLogsPage("/admin/logs?tab=audit");

    const detailButtons = screen.getAllByRole("button", { name: "View details" });
    fireEvent.click(detailButtons[0]);

    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByText("AUDIT log details")).toBeInTheDocument();
    // The dialog renders the raw row as safe pretty-printed JSON.
    expect(screen.getByText(/"actionCode": "LOGIN"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});

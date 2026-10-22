// Admin API access page (#2039): the grants table, granting and revoking.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/api/use-api-access", () => ({
  searchGrantableUsers: vi.fn(),
}));

import { ApiAccessAdminView } from "~/components/admin/api-access-admin-view";
import { searchGrantableUsers, type ApiAccessGrantRow } from "~/hooks/api/use-api-access";

const activeGrant: ApiAccessGrantRow = {
  id: "g1",
  userId: "s1",
  purpose: "Honours project: LLM judge evaluation",
  expiresAt: "2026-12-31T23:59:59.000Z",
  dailyRequestLimit: 200,
  dailyTokenLimit: 200_000,
  revokedAt: null,
  createdAt: "2026-10-21T00:00:00.000Z",
  active: true,
  user: { id: "s1", name: "Sam Student", email: "sam@student.ubc.ca", role: "STUDENT" },
  usageLast24h: { requests: 40, tokens: 12_000 },
};

const revokedGrant: ApiAccessGrantRow = {
  ...activeGrant,
  id: "g0",
  active: false,
  revokedAt: "2026-10-01T00:00:00.000Z",
  user: { ...activeGrant.user, id: "s2", name: "Rae Revoked" },
};

function renderView(overrides: Partial<React.ComponentProps<typeof ApiAccessAdminView>> = {}) {
  const props: React.ComponentProps<typeof ApiAccessAdminView> = {
    grants: [activeGrant],
    defaults: { dailyRequestLimit: 200, dailyTokenLimit: 200_000 },
    includeInactive: false,
    onIncludeInactiveChange: vi.fn(),
    isLoading: false,
    error: null,
    onCreateGrant: vi.fn().mockResolvedValue(undefined),
    onRevokeGrant: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  render(<ApiAccessAdminView {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(searchGrantableUsers).mockResolvedValue([]);
});

describe("ApiAccessAdminView", () => {
  it("lists each grant with its purpose, use against the limits and status", () => {
    renderView({ grants: [activeGrant, revokedGrant] });
    const row = screen.getByText("Sam Student").closest("tr")!;
    expect(within(row).getByText("Honours project: LLM judge evaluation")).toBeInTheDocument();
    expect(within(row).getByText("40 / 200")).toBeInTheDocument();
    expect(within(row).getByText("12K / 200K")).toBeInTheDocument();
    expect(within(row).getByText("Active")).toBeInTheDocument();

    const revokedRow = screen.getByText("Rae Revoked").closest("tr")!;
    expect(within(revokedRow).getByText("Revoked")).toBeInTheDocument();
    expect(within(revokedRow).queryByRole("button", { name: "Revoke" })).not.toBeInTheDocument();
  });

  it("says when nobody has access", () => {
    renderView({ grants: [] });
    expect(screen.getByText("Nobody has API access yet.")).toBeInTheDocument();
  });

  it("revokes after confirmation", async () => {
    const props = renderView();
    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(props.onRevokeGrant).toHaveBeenCalledWith("g1"));
  });

  it("toggles revoked and ended grants", () => {
    const props = renderView();
    fireEvent.click(screen.getByRole("switch", { name: /show revoked and ended/i }));
    expect(props.onIncludeInactiveChange).toHaveBeenCalledWith(true);
  });

  it("grants access to a person found by search, with the default limits", async () => {
    vi.mocked(searchGrantableUsers).mockResolvedValue([
      { id: "s3", name: "Nia New", email: "nia@student.ubc.ca", role: "STUDENT" } as never,
    ]);
    const props = renderView();

    fireEvent.click(screen.getByRole("button", { name: /give api access/i }));
    const dialog = await screen.findByRole("dialog");
    const give = within(dialog).getByRole("button", { name: "Give access" });
    expect(give).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Person"), { target: { value: "nia" } });
    fireEvent.click(await within(dialog).findByText("Nia New"));
    fireEvent.change(within(dialog).getByLabelText("Purpose"), {
      target: { value: "Capstone evaluation" },
    });
    fireEvent.change(within(dialog).getByLabelText("Ends on"), {
      target: { value: "2026-12-31" },
    });
    fireEvent.click(give);

    await waitFor(() =>
      expect(props.onCreateGrant).toHaveBeenCalledWith({
        userId: "s3",
        purpose: "Capstone evaluation",
        expiresAt: new Date(2026, 11, 31, 23, 59, 59).toISOString(),
        dailyRequestLimit: 200,
        dailyTokenLimit: 200_000,
      }),
    );
    expect(searchGrantableUsers).toHaveBeenCalledWith("nia");
  });

  it("opens the dialog for a person linked from the users table and shows a refusal", async () => {
    const onCreateGrant = vi.fn().mockRejectedValue(new Error("This user already has API access"));
    renderView({
      onCreateGrant,
      initialPerson: {
        id: "s1",
        name: "Sam Student",
        email: "sam@student.ubc.ca",
        role: "STUDENT",
      },
    });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("sam@student.ubc.ca")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText("Purpose"), { target: { value: "Thesis" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Give access" }));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "This user already has API access",
    );
  });
});

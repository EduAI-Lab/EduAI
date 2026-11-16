/**
 * The Invitations page's table: an Actions column with "Resend / copy link"
 * and "Cancel invitation" as buttons on pending rows only (they used to sit
 * in a "…" menu), wired to the same resend and cancel-confirm flows.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

vi.mock("~/components/layout/core-app-shell", () => ({
  CoreAppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("~/hooks/api/use-disciplines", () => ({
  useDisciplines: () => ({ options: [], disciplines: [], loading: false, error: null }),
}));
vi.mock("~/lib/auth/request-session.server", () => ({ getRequestSession: vi.fn() }));
vi.mock("~/lib/not-found.server", () => ({ notFound: vi.fn() }));

import InvitationsPage from "~/routes/admin.invitations";

type InviteStatus = "PENDING" | "ACCEPTED" | "REVOKED";

function invite(id: string, email: string, status: InviteStatus) {
  return {
    id,
    email,
    name: null,
    role: "INSTRUCTOR",
    authorizedUnits: [],
    status,
    expiresAt: "2026-11-08T00:00:00.000Z",
    acceptedAt: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    isExpired: false,
  };
}

const INVITES = [
  invite("i1", "jamie.wu@ubc.ca", "PENDING"),
  invite("i2", "alexis.roy@ubc.ca", "ACCEPTED"),
  invite("i3", "riley.ng@ubc.ca", "REVOKED"),
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((url: string, init?: RequestInit) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(
          url === "/api/invitations" && !init?.method
            ? INVITES
            : { link: "https://eduai.test/invite/abc", emailSent: true },
        ),
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPage() {
  const router = createMemoryRouter(
    [
      {
        path: "/admin/invitations",
        element: <InvitationsPage />,
        loader: () => ({
          user: { id: "admin-1", role: "ADMIN", name: "Admin", email: "admin@eduai.test" },
          invitableRoles: ["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "STUDENT"],
        }),
      },
    ],
    { initialEntries: ["/admin/invitations"] },
  );
  render(<RouterProvider router={router} />);
}

const rowFor = async (email: string) =>
  (await screen.findByText(email)).closest("tr") as HTMLElement;

describe("Invitations page — actions", () => {
  it("shows a visible Actions column with Resend and Cancel on pending rows only", async () => {
    renderPage();

    expect(await screen.findByRole("columnheader", { name: "Actions" })).toBeVisible();
    const pending = await rowFor("jamie.wu@ubc.ca");
    expect(within(pending).getByRole("button", { name: "Resend / copy link" })).toBeInTheDocument();
    expect(within(pending).getByRole("button", { name: "Cancel invitation" })).toBeInTheDocument();

    for (const email of ["alexis.roy@ubc.ca", "riley.ng@ubc.ca"]) {
      expect(within(await rowFor(email)).queryByRole("button")).not.toBeInTheDocument();
    }
  });

  it("resends a pending invitation from its row", async () => {
    renderPage();
    fireEvent.click(
      within(await rowFor("jamie.wu@ubc.ca")).getByRole("button", { name: "Resend / copy link" }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/invitations/i1", expect.anything()),
    );
  });

  it("asks for confirmation before cancelling", async () => {
    renderPage();
    fireEvent.click(
      within(await rowFor("jamie.wu@ubc.ca")).getByRole("button", { name: "Cancel invitation" }),
    );
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("jamie.wu@ubc.ca");
  });
});

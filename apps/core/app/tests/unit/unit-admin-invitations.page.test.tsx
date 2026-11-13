/** The unit-admin invite form defaults to, and resets to, the instructor role (#2162). */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";

vi.mock("~/components/layout/core-app-shell", () => ({
  CoreAppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("~/lib/auth/request-session.server", () => ({ getRequestSession: vi.fn() }));
vi.mock("~/lib/not-found.server", () => ({ notFound: vi.fn() }));
vi.mock("~/lib/policy.server", () => ({ getPolicy: vi.fn() }));

import UnitAdminInvitationsPage from "~/routes/unit-admin.invitations";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn((_url: string, init?: RequestInit) =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve(
          init?.method === "POST"
            ? {
                invitation: { email: "prof@ubc.ca" },
                link: "https://eduai.test/invite/abc",
                emailSent: true,
              }
            : [],
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
        path: "/unit-admin/invitations",
        element: <UnitAdminInvitationsPage />,
        loader: () => ({
          user: { id: "ua-1", role: "UNIT_ADMIN", name: "Unit", email: "ua@eduai.test" },
        }),
      },
    ],
    { initialEntries: ["/unit-admin/invitations"] },
  );
  render(<RouterProvider router={router} />);
}

const openDialog = async () => {
  fireEvent.click(await screen.findByRole("button", { name: /Invite User/ }));
  return screen.findByRole("dialog");
};

const postedRoles = () =>
  fetchMock.mock.calls
    .filter(([, init]) => init?.method === "POST")
    .map(([, init]) => JSON.parse(String(init.body)).role);

describe("Unit admin invitations — invite role", () => {
  it("defaults to Professor (Instructor) and sends INSTRUCTOR", async () => {
    renderPage();
    const dialog = await openDialog();
    expect(within(dialog).getByRole("combobox")).toHaveTextContent("Professor (Instructor)");

    fireEvent.change(within(dialog).getByLabelText("Email"), {
      target: { value: "prof@ubc.ca" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));

    await waitFor(() => expect(postedRoles()).toEqual(["INSTRUCTOR"]));
  });

  it("resets to the instructor role after sending a student invite", async () => {
    renderPage();
    const dialog = await openDialog();
    // Radix renders a hidden native select inside a form; changing it drives the value.
    const native = dialog.querySelector("select") as HTMLSelectElement;
    fireEvent.change(native, { target: { value: "STUDENT" } });
    await waitFor(() => expect(within(dialog).getByRole("combobox")).toHaveTextContent("Student"));

    fireEvent.change(within(dialog).getByLabelText("Email"), {
      target: { value: "student@student.ubc.ca" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Send invite" }));
    await waitFor(() => expect(postedRoles()).toEqual(["STUDENT"]));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const reopened = await openDialog();
    expect(within(reopened).getByRole("combobox")).toHaveTextContent("Professor (Instructor)");
  });
});

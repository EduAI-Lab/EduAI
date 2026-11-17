/**
 * The Edit user dialog locks the Role field for any admin account, the
 * signed-in admin's own included, matching the API's CANNOT_CHANGE_OWN_ROLE
 * and CANNOT_CHANGE_ADMIN_ROLE guards.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/api/use-disciplines", () => ({
  useDisciplines: () => ({ options: [], disciplines: [], loading: false, error: null }),
}));

import { UserFormDialog } from "~/components/admin/user-form-dialog";
import type { User } from "~/components/admin/users-table";
import { CurrentUserIdProvider } from "~/contexts/current-user";

function account(id: string, role: User["role"]): User {
  return {
    id,
    name: `${role} ${id}`,
    email: `${id}@example.com`,
    role,
    isActive: true,
    emailVerified: true,
    authorizedUnits: [],
    taCourseIds: [],
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-07-01T00:00:00.000Z",
  } as unknown as User;
}

function renderDialog(user: User) {
  render(
    <CurrentUserIdProvider userId="me">
      <UserFormDialog open onOpenChange={vi.fn()} user={user} onSubmit={vi.fn()} />
    </CurrentUserIdProvider>,
  );
  return screen.getByRole("combobox", { name: "Role" });
}

describe("UserFormDialog — role lock", () => {
  it("locks your own role", () => {
    expect(renderDialog(account("me", "ADMIN"))).toBeDisabled();
    expect(screen.getByText("You can't change your own role.")).toBeInTheDocument();
  });

  it("locks another admin's role", () => {
    expect(renderDialog(account("admin-2", "ADMIN"))).toBeDisabled();
    expect(screen.getByText("An admin's role can't be changed.")).toBeInTheDocument();
  });

  it("leaves a non-admin's role editable", () => {
    expect(renderDialog(account("inst-1", "INSTRUCTOR"))).toBeEnabled();
    expect(screen.queryByText(/role can't be changed/)).not.toBeInTheDocument();
  });
});

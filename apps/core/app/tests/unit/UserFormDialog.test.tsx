import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { UserFormDialog } from "~/components/admin/user-form-dialog";
import type { User } from "~/components/admin/users-table";

const baseUser: User = {
  id: "u1",
  email: "alice@example.com",
  name: "Alice Smith",
  role: "STUDENT",
  isActive: true,
  emailVerified: true,
  authorizedUnits: [] as string[],
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  _count: {
    enrolledCourses: 2,
    assistedCourses: 0,
    taughtCourses: 0,
    aiInteractions: 10,
  },
};

// ---------------------------------------------------------------------------
// Title
// ---------------------------------------------------------------------------

describe("UserFormDialog — title", () => {
  it("shows 'Create New User' when no user is given", () => {
    render(
      <UserFormDialog open={true} onOpenChange={vi.fn()} onSubmit={vi.fn()} />
    );
    expect(screen.getByRole("heading", { name: "Create New User" })).toBeInTheDocument();
  });

  it("shows 'Edit User' when a user is given", () => {
    render(
      <UserFormDialog open={true} onOpenChange={vi.fn()} user={baseUser} onSubmit={vi.fn()} />
    );
    expect(screen.getByRole("heading", { name: "Edit User" })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Pre-population
// ---------------------------------------------------------------------------

describe("UserFormDialog — pre-population", () => {
  it("pre-fills the Name field from the user prop", () => {
    render(
      <UserFormDialog open={true} onOpenChange={vi.fn()} user={baseUser} onSubmit={vi.fn()} />
    );
    expect(screen.getByPlaceholderText("Enter full name")).toHaveValue("Alice Smith");
  });

  it("pre-fills the Email field from the user prop", () => {
    render(
      <UserFormDialog open={true} onOpenChange={vi.fn()} user={baseUser} onSubmit={vi.fn()} />
    );
    expect(screen.getByPlaceholderText("Enter email address")).toHaveValue("alice@example.com");
  });
});

// ---------------------------------------------------------------------------
// Conditional fields
// ---------------------------------------------------------------------------

describe("UserFormDialog — conditional fields", () => {
  it("does not render the Email Verified field when creating a new user", () => {
    render(
      <UserFormDialog open={true} onOpenChange={vi.fn()} onSubmit={vi.fn()} />
    );
    expect(screen.queryByText("Email Verified")).not.toBeInTheDocument();
  });

  it("renders the Email Verified field when editing an existing user", () => {
    render(
      <UserFormDialog open={true} onOpenChange={vi.fn()} user={baseUser} onSubmit={vi.fn()} />
    );
    expect(screen.getByText("Email Verified")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Form actions
// ---------------------------------------------------------------------------

describe("UserFormDialog — form actions", () => {
  it("calls onOpenChange(false) when Cancel is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <UserFormDialog open={true} onOpenChange={onOpenChange} onSubmit={vi.fn()} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("calls onSubmit when the form is submitted with a valid pre-filled user", async () => {
    const onSubmit = vi.fn();
    render(
      <UserFormDialog open={true} onOpenChange={vi.fn()} user={baseUser} onSubmit={onSubmit} />
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /update user/i }));
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("authorizedUnits");
  });

  it("calls onSubmit with correct data when creating a new user", async () => {
    const onSubmit = vi.fn();
    render(
      <UserFormDialog open={true} onOpenChange={vi.fn()} onSubmit={onSubmit} />
    );
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Enter full name"), {
        target: { value: "Bob Jones" },
      });
      fireEvent.change(screen.getByPlaceholderText("Enter email address"), {
        target: { value: "bob@example.com" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /create user/i }));
    });
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Bob Jones", email: "bob@example.com" })
      )
    );
    expect(onSubmit.mock.calls[0][0]).not.toHaveProperty("authorizedUnits");
  });

  it("includes authorizedUnits when updating a UNIT_ADMIN", async () => {
    const onSubmit = vi.fn();
    render(
      <UserFormDialog
        open={true}
        onOpenChange={vi.fn()}
        user={{ ...baseUser, role: "UNIT_ADMIN", authorizedUnits: ["COSC"] }}
        onSubmit={onSubmit}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /update user/i }));
    });

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ role: "UNIT_ADMIN", authorizedUnits: ["COSC"] }),
      ),
    );
  });

  it("keeps the dialog values and shows an error when an update rejects (#967)", async () => {
    const onOpenChange = vi.fn();
    const onSubmit = vi.fn().mockRejectedValue(new Error("Unable to save user"));
    render(
      <UserFormDialog
        open={true}
        onOpenChange={onOpenChange}
        user={baseUser}
        onSubmit={onSubmit}
      />
    );

    fireEvent.change(screen.getByPlaceholderText("Enter full name"), {
      target: { value: "Alice Updated" },
    });
    fireEvent.click(screen.getByRole("button", { name: /update user/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.getByRole("heading", { name: "Edit User" })).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByPlaceholderText("Enter full name")).toHaveValue("Alice Updated");
    expect(screen.getByPlaceholderText("Enter email address")).toHaveValue("alice@example.com");
    expect(await screen.findByText("Unable to save user")).toBeVisible();
  });
});

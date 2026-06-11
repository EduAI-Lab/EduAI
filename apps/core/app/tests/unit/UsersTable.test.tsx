import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { UsersTable } from "~/components/admin/users-table";

const baseUser = {
  id: "u1",
  email: "alice@example.com",
  name: "Alice Smith",
  role: "STUDENT" as const,
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

const otherUser = {
  ...baseUser,
  id: "u2",
  email: "bob@example.com",
  name: "Bob Jones",
  role: "INSTRUCTOR" as const,
};

const defaultProps = {
  users: [baseUser],
  currentUserId: "current-user",
  onEdit: vi.fn(),
  onDelete: vi.fn(),
  onToggleActive: vi.fn(),
};

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe("UsersTable — empty state", () => {
  it("renders the empty state message when users is empty", () => {
    render(<UsersTable {...defaultProps} users={[]} />);
    expect(screen.getByText("No users found.")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("UsersTable — rendering", () => {
  it("renders the user name and email", () => {
    render(<UsersTable {...defaultProps} />);
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("alice@example.com")).toBeInTheDocument();
  });

  it("renders a row for each user", () => {
    render(<UsersTable {...defaultProps} users={[baseUser, otherUser]} />);
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
  });

  it("renders the Add User button when onCreateUser is provided", () => {
    render(<UsersTable {...defaultProps} onCreateUser={vi.fn()} />);
    expect(screen.getByRole("button", { name: /add user/i })).toBeInTheDocument();
  });

  it("does not render the Add User button when onCreateUser is not provided", () => {
    render(<UsersTable {...defaultProps} />);
    expect(screen.queryByRole("button", { name: /add user/i })).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Name filter
// ---------------------------------------------------------------------------

describe("UsersTable — name filter", () => {
  it("filters rows by name", () => {
    render(<UsersTable {...defaultProps} users={[baseUser, otherUser]} />);
    const filterInput = screen.getByLabelText("Filter by name or email");
    fireEvent.change(filterInput, { target: { value: "bob" } });
    expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
  });

  it("shows all rows again when the filter is cleared", () => {
    render(<UsersTable {...defaultProps} users={[baseUser, otherUser]} />);
    const filterInput = screen.getByLabelText("Filter by name or email");
    fireEvent.change(filterInput, { target: { value: "bob" } });
    fireEvent.change(filterInput, { target: { value: "" } });
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

const openRowMenu = () => {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Open menu" }), {
    button: 0,
    ctrlKey: false,
  });
};

describe("UsersTable — row actions", () => {
  it("calls onEdit with the user when Edit is clicked in the row menu", () => {
    const onEdit = vi.fn();
    render(<UsersTable {...defaultProps} onEdit={onEdit} />);
    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /edit/i }));
    expect(onEdit).toHaveBeenCalledWith(baseUser);
  });

  it("calls onToggleActive with the user when the status switch is clicked", () => {
    const onToggleActive = vi.fn();
    render(<UsersTable {...defaultProps} onToggleActive={onToggleActive} />);
    // The status switch in the table row is not disabled for non-current users
    const switches = screen.getAllByRole("switch");
    fireEvent.click(switches[0]);
    expect(onToggleActive).toHaveBeenCalledWith(baseUser);
  });

  it("disables the delete and deactivate actions for the current user", () => {
    render(
      <UsersTable
        {...defaultProps}
        users={[{ ...baseUser, id: "current-user" }]}
        currentUserId="current-user"
      />
    );
    openRowMenu();
    expect(screen.getByRole("menuitem", { name: /deactivate|activate/i })).toHaveAttribute("data-disabled");
    expect(screen.getByRole("menuitem", { name: /delete/i })).toHaveAttribute("data-disabled");
  });

  it("calls onCreateUser when the Add User button is clicked", () => {
    const onCreateUser = vi.fn();
    render(<UsersTable {...defaultProps} onCreateUser={onCreateUser} />);
    fireEvent.click(screen.getByRole("button", { name: /add user/i }));
    expect(onCreateUser).toHaveBeenCalled();
  });
});

/**
 * #1041: the users table is server-paginated, so this view takes `total` and
 * `stats` from the server instead of counting rows, and its user-form course
 * picker asks for one bounded page rather than the unbounded course list it used
 * to request.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const useCourses = vi.fn();
vi.mock("~/hooks/api/use-courses", () => ({ useCourses: (...a: unknown[]) => useCourses(...a) }));

// UserFormDialog is a fully-featured react-hook-form component covered by its
// own tests; stub it here so this file can exercise UsersAdminView's own
// wiring (which user it's editing, what handleSubmit does with the result,
// success vs. error branches) without re-driving the real form fields.
vi.mock("~/components/admin/user-form-dialog", () => ({
  UserFormDialog: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    user?: { id: string } | null;
    onSubmit: (data: unknown) => Promise<void>;
  }) =>
    props.open ? (
      <div data-testid="user-form-dialog">
        <span data-testid="form-mode">
          {props.user ? `editing:${props.user.id}` : "creating"}
        </span>
        <button
          onClick={() => {
            props.onSubmit({ name: "New Person", email: "new@example.com", role: "STUDENT", isActive: true }).catch(() => {});
          }}
        >
          submit-form
        </button>
        <button onClick={() => props.onOpenChange(false)}>cancel-form</button>
      </div>
    ) : null,
}));

// UserChatHistoryDialog is loaded via lazy()/Suspense (#1223) and has its own
// dedicated test file; stub it so opening it here only asserts that
// UsersAdminView hands it the right user, not its internal fetch/render logic.
vi.mock("~/components/admin/user-chat-history-dialog", () => ({
  UserChatHistoryDialog: (props: { open: boolean; userId: string; userName: string }) =>
    props.open ? (
      <div data-testid="chat-history-dialog">
        {props.userName} ({props.userId})
      </div>
    ) : null,
}));

import { UsersAdminView } from "~/components/admin/users-admin-view";
import type { PlatformUser } from "~/hooks/api/types";

const user = {
  id: "u1",
  email: "student@example.com",
  name: "Student One",
  role: "STUDENT",
  isActive: true,
  emailVerified: true,
  authorizedUnits: [],
  taCourseIds: [],
  createdAt: "2026-07-01T00:00:00.000Z",
  updatedAt: "2026-07-01T00:00:00.000Z",
  _count: { enrolledCourses: 0, assistedCourses: 0, taughtCourses: 0, aiInteractions: 0 },
} as unknown as PlatformUser;

function renderView(overrides: Partial<React.ComponentProps<typeof UsersAdminView>> = {}) {
  return render(
    <MemoryRouter>
      <UsersAdminView
        users={[user]}
        total={137}
        stats={{ total: 137, active: 130, byRole: { STUDENT: 120, INSTRUCTOR: 17 } }}
        onQueryChange={vi.fn()}
        isLoading={false}
        error={null}
        currentUserId="admin-1"
        onCreateUser={vi.fn()}
        onUpdateUser={vi.fn()}
        onDeleteUser={vi.fn()}
        onToggleUserActive={vi.fn()}
        {...overrides}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  useCourses.mockReturnValue({ courses: [], loading: false, total: 0 });
});

describe("UsersAdminView", () => {
  it("asks the course picker for one bounded page at the API's max pageSize", () => {
    renderView();

    // The picker needs a browsable set, not the whole table — and `/api/courses`
    // caps pageSize at 200, so anything larger would be clamped anyway.
    expect(useCourses).toHaveBeenCalledWith({ pageSize: 200 });
  });

  it("renders the server-reported platform counts rather than counting the loaded page", () => {
    renderView();

    // One row loaded, 137 platform-wide.
    expect(screen.getAllByText(/137/).length).toBeGreaterThan(0);
  });

  it("surfaces an error message when the list read failed", () => {
    renderView({ error: "PAGINATION_REQUIRED" });

    expect(screen.getByText(/PAGINATION_REQUIRED/)).toBeInTheDocument();
  });

  it("shows a loading spinner instead of the table while isLoading", () => {
    const { container } = renderView({ isLoading: true });

    expect(container.querySelector(".animate-spin")).toBeInTheDocument();
    expect(screen.queryByText("Platform Users")).not.toBeInTheDocument();
  });
});

const openRowMenu = () => {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Open menu" }), {
    button: 0,
    ctrlKey: false,
  });
};

describe("UsersAdminView — create user", () => {
  it("opens the form dialog in create mode from the Add User button", () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /add user/i }));

    expect(screen.getByTestId("user-form-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("form-mode")).toHaveTextContent("creating");
  });

  it("calls onCreateUser with the submitted data and closes the dialog on success", async () => {
    const onCreateUser = vi.fn().mockResolvedValue(undefined);
    renderView({ onCreateUser });

    fireEvent.click(screen.getByRole("button", { name: /add user/i }));
    fireEvent.click(screen.getByText("submit-form"));

    await waitFor(() =>
      expect(onCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({ name: "New Person", email: "new@example.com" }),
      ),
    );
    await waitFor(() => expect(screen.queryByTestId("user-form-dialog")).not.toBeInTheDocument());
  });

  it("keeps the dialog open and logs when onCreateUser rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onCreateUser = vi.fn().mockRejectedValue(new Error("boom"));
    renderView({ onCreateUser });

    fireEvent.click(screen.getByRole("button", { name: /add user/i }));
    fireEvent.click(screen.getByText("submit-form"));

    await waitFor(() => expect(onCreateUser).toHaveBeenCalled());
    expect(screen.getByTestId("user-form-dialog")).toBeInTheDocument();
    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith("Failed to save user:", expect.any(Error)),
    );
    consoleError.mockRestore();
  });

  it("clears the editing user when the dialog is cancelled", () => {
    renderView();

    fireEvent.click(screen.getByRole("button", { name: /add user/i }));
    fireEvent.click(screen.getByText("cancel-form"));

    expect(screen.queryByTestId("user-form-dialog")).not.toBeInTheDocument();
  });
});

describe("UsersAdminView — edit user", () => {
  it("opens the form dialog in edit mode with the selected user from the row menu", () => {
    renderView();

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /edit/i }));

    expect(screen.getByTestId("form-mode")).toHaveTextContent(`editing:${user.id}`);
  });

  it("calls onUpdateUser with the user id and submitted data", async () => {
    const onUpdateUser = vi.fn().mockResolvedValue(undefined);
    renderView({ onUpdateUser });

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /edit/i }));
    fireEvent.click(screen.getByText("submit-form"));

    await waitFor(() =>
      expect(onUpdateUser).toHaveBeenCalledWith(user.id, expect.objectContaining({ name: "New Person" })),
    );
  });
});

describe("UsersAdminView — delete user", () => {
  it("calls onDeleteUser with the user id after confirming the row delete dialog", async () => {
    const onDeleteUser = vi.fn().mockResolvedValue(undefined);
    renderView({ onDeleteUser, currentUserId: "someone-else" });

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDeleteUser).toHaveBeenCalledWith(user.id));
  });

  it("logs when onDeleteUser rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onDeleteUser = vi.fn().mockRejectedValue(new Error("delete failed"));
    renderView({ onDeleteUser, currentUserId: "someone-else" });

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith("Failed to delete user:", expect.any(Error)),
    );
    consoleError.mockRestore();
  });
});

describe("UsersAdminView — toggle active", () => {
  it("calls onToggleUserActive with the user from the row menu", async () => {
    const onToggleUserActive = vi.fn().mockResolvedValue(undefined);
    renderView({ onToggleUserActive, currentUserId: "someone-else" });

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /deactivate|activate/i }));

    await waitFor(() => expect(onToggleUserActive).toHaveBeenCalledWith(user));
  });

  it("logs when onToggleUserActive rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onToggleUserActive = vi.fn().mockRejectedValue(new Error("toggle failed"));
    renderView({ onToggleUserActive, currentUserId: "someone-else" });

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /deactivate|activate/i }));

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith("Failed to toggle user:", expect.any(Error)),
    );
    consoleError.mockRestore();
  });
});

describe("UsersAdminView — chat history", () => {
  it("opens the chat history dialog with the selected user from the row menu", async () => {
    renderView();

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /view chat history/i }));

    await waitFor(() =>
      expect(screen.getByTestId("chat-history-dialog")).toHaveTextContent(`${user.name} (${user.id})`),
    );
  });
});

describe("UsersAdminView — search", () => {
  it("reports the search term upward via onQueryChange", async () => {
    const onQueryChange = vi.fn();
    renderView({ onQueryChange });

    fireEvent.change(screen.getByLabelText("Filter by name or email"), {
      target: { value: "student" },
    });

    await waitFor(() =>
      expect(onQueryChange).toHaveBeenCalledWith(expect.objectContaining({ search: "student" })),
    );
  });
});

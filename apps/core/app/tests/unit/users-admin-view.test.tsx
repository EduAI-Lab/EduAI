/**
 * #1041: the users table is server-paginated, so this view takes `total` and
 * `stats` from the server instead of counting rows, and its user-form course
 * picker asks for one bounded page rather than the unbounded course list it used
 * to request.
 */
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const useCourses = vi.fn();
/** What the user form hands back on submit. */
type UserFormSubmission = {
  name: string;
  email: string;
  role: string;
  isActive: boolean;
};

vi.mock("~/hooks/api/use-courses", () => ({
  useCourses: (...a: unknown[]) => useCourses(...a),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...a: unknown[]) => toastError(...a),
    success: (...a: unknown[]) => toastSuccess(...a),
  },
}));

// UserFormDialog is a fully-featured react-hook-form component covered by its
// own tests; stub it here so this file can exercise UsersAdminView's own
// wiring (which user it's editing, what handleSubmit does with the result,
// success vs. error branches) without re-driving the real form fields.
vi.mock("~/components/admin/user-form-dialog", () => ({
  UserFormDialog: (props: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    user?: { id: string } | null;
    onSubmit: (data: UserFormSubmission) => Promise<void>;
  }) =>
    props.open ? (
      <div data-testid="user-form-dialog">
        <span data-testid="form-mode">{props.user ? `editing:${props.user.id}` : "creating"}</span>
        <button
          onClick={() => {
            props
              .onSubmit({
                name: "New Person",
                email: "new@example.com",
                role: "STUDENT",
                isActive: true,
              })
              .catch(() => {});
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
import { ApiError } from "~/hooks/api/config";
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
  _count: {
    enrolledCourses: 0,
    assistedCourses: 0,
    taughtCourses: 0,
    aiInteractions: 0,
  },
} as PlatformUser;

function renderView(overrides: Partial<React.ComponentProps<typeof UsersAdminView>> = {}) {
  return render(
    <MemoryRouter>
      <UsersAdminView
        users={[user]}
        total={137}
        stats={{
          total: 137,
          active: 130,
          byRole: { STUDENT: 120, INSTRUCTOR: 17 },
        }}
        onQueryChange={vi.fn()}
        isLoading={false}
        error={null}
        currentUserId="admin-1"
        onCreateUser={vi.fn()}
        onUpdateUser={vi.fn()}
        onDeleteUser={vi.fn()}
        onDeleteUsers={vi.fn().mockResolvedValue([])}
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
    // caps pageSize at 200, so anything larger would be clamped anyway. It opts
    // out of facets, which only the filter toolbar consumes.
    expect(useCourses).toHaveBeenCalledWith({
      pageSize: 200,
      includeFacets: false,
    });
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

describe("UsersAdminView — your own account", () => {
  it("disables Delete and the row checkbox on your own row", () => {
    renderView({ currentUserId: user.id });

    expect(screen.getByRole("checkbox", { name: "Select row" })).toBeDisabled();
    openRowMenu();
    expect(screen.getByRole("menuitem", { name: /delete/i })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("does nothing when the disabled Deactivate or Delete is clicked on your own row", () => {
    const onToggleUserActive = vi.fn();
    const onDeleteUser = vi.fn();
    renderView({ currentUserId: user.id, onToggleUserActive, onDeleteUser });

    openRowMenu();
    // A disabled item leaves the menu open, so both clicks land in one opening.
    fireEvent.click(screen.getByRole("menuitem", { name: /deactivate/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onToggleUserActive).not.toHaveBeenCalled();
    expect(onDeleteUser).not.toHaveBeenCalled();
  });
});

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
        expect.objectContaining({
          name: "New Person",
          email: "new@example.com",
        }),
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
      expect(onUpdateUser).toHaveBeenCalledWith(
        user.id,
        expect.objectContaining({ name: "New Person" }),
      ),
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
    expect(toastError).toHaveBeenCalledWith("Couldn't delete the user. Please try again.");
    consoleError.mockRestore();
  });

  // #1959: a rejected delete used to only reach the console, so the admin saw nothing.
  it.each([
    ["CANNOT_DELETE_USER_WITH_DATA", 400, /Deactivate the account instead/],
    ["ADMIN_FLOOR_VIOLATION", 409, /last active admin/],
    ["USER_NOT_FOUND", 404, /no longer exists/],
  ])("toasts a readable message for %s", async (code, status, message) => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onDeleteUser = vi.fn().mockRejectedValue(new ApiError(status, code));
    renderView({ onDeleteUser, currentUserId: "someone-else" });

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /delete/i }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(message)));
    consoleError.mockRestore();
  });
});

describe("UsersAdminView — toggle active", () => {
  it("asks before deactivating, then calls onToggleUserActive with the user", async () => {
    const onToggleUserActive = vi.fn().mockResolvedValue(undefined);
    renderView({ onToggleUserActive, currentUserId: "someone-else" });

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /deactivate/i }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Student One won't be able to sign in");
    expect(onToggleUserActive).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(onToggleUserActive).toHaveBeenCalledWith(user));
  });

  it("leaves the user active when the deactivate dialog is cancelled", () => {
    const onToggleUserActive = vi.fn();
    renderView({ onToggleUserActive, currentUserId: "someone-else" });

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /deactivate/i }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onToggleUserActive).not.toHaveBeenCalled();
  });

  it("activates an inactive user straight away, without a dialog", async () => {
    const onToggleUserActive = vi.fn().mockResolvedValue(undefined);
    const inactive = { ...user, isActive: false } as PlatformUser;
    renderView({ users: [inactive], onToggleUserActive, currentUserId: "someone-else" });

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /^activate/i }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    await waitFor(() => expect(onToggleUserActive).toHaveBeenCalledWith(inactive));
  });

  it("logs when onToggleUserActive rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const onToggleUserActive = vi.fn().mockRejectedValue(new Error("toggle failed"));
    renderView({ onToggleUserActive, currentUserId: "someone-else" });

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /deactivate/i }));
    fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith("Failed to toggle user:", expect.any(Error)),
    );
    expect(toastError).toHaveBeenCalledWith("Couldn't update the user's status. Please try again.");
    consoleError.mockRestore();
  });
});

describe("UsersAdminView — chat history", () => {
  it("opens the chat history dialog with the selected user from the row menu", async () => {
    renderView();

    openRowMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /view chat history/i }));

    await waitFor(() =>
      expect(screen.getByTestId("chat-history-dialog")).toHaveTextContent(
        `${user.name} (${user.id})`,
      ),
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

describe("UsersAdminView — bulk selection", () => {
  const other = {
    ...user,
    id: "u2",
    email: "other@example.com",
    name: "Other Two",
  } as PlatformUser;
  const me = { ...user, id: "admin-1", email: "me@example.com", name: "Me Admin" } as PlatformUser;

  const selectAll = () => fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
  const bulkBar = () => screen.queryByRole("region", { name: "Bulk actions" });

  it("shows the bulk bar with the selected count only while rows are selected", () => {
    renderView({ users: [user, other] });
    expect(bulkBar()).not.toBeInTheDocument();

    selectAll();
    expect(bulkBar()).toHaveTextContent("2 selected");

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(bulkBar()).not.toBeInTheDocument();
  });

  it("deletes the selected users, skips your own account and says so, then clears", async () => {
    const onDeleteUsers = vi.fn().mockResolvedValue([]);
    renderView({ users: [user, other, me], onDeleteUsers });

    selectAll();
    expect(bulkBar()).toHaveTextContent("3 selected");
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("permanently delete 2 selected users");
    expect(dialog).toHaveTextContent("Your own account is selected and will be skipped.");

    fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));

    await waitFor(() => expect(onDeleteUsers).toHaveBeenCalledWith(["u1", "u2"]));
    await waitFor(() => expect(bulkBar()).not.toBeInTheDocument());
    expect(toastSuccess).toHaveBeenCalledWith("Deleted 2 users.");
  });

  it("names each user a bulk delete could not remove", async () => {
    const onDeleteUsers = vi
      .fn()
      .mockResolvedValue([{ id: "u2", code: "CANNOT_DELETE_USER_WITH_DATA" }]);
    renderView({ users: [user, other], onDeleteUsers });

    selectAll();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    fireEvent.click(
      within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }),
    );

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        expect.stringMatching(/^Other Two: .*Deactivate the account instead/),
      ),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Deleted 1 user.");
  });

  it("clears the selection when the search changes", () => {
    renderView({ users: [user, other] });
    selectAll();
    expect(bulkBar()).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Filter by name or email"), {
      target: { value: "other" },
    });
    expect(bulkBar()).not.toBeInTheDocument();
  });
});

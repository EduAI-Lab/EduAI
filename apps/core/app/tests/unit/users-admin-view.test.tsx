/**
 * #1041: the users table is server-paginated, so this view takes `total` and
 * `stats` from the server instead of counting rows, and its user-form course
 * picker asks for one bounded page rather than the unbounded course list it used
 * to request.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router";

const useCourses = vi.fn();
vi.mock("~/hooks/api/use-courses", () => ({ useCourses: (...a: unknown[]) => useCourses(...a) }));

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
});

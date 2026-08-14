import { lazy, Suspense, useState } from "react";

import { UserFormDialog } from "~/components/admin/user-form-dialog";
import { UsersTable } from "~/components/admin/users-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeading } from "@eduai/ui";
import type {
  CreateUserInput,
  PlatformUser,
  UpdateUserInput,
} from "~/hooks/api/types";
import { useCourses } from "~/hooks/api/use-courses";
import type { UsersQuery, UserStats } from "~/hooks/api/use-users";

// Only mounted when an admin opens a user's chat history, and it pulls the heavy
// chat-message chunk (streamdown + shiki). Load it on open so the users admin
// page's initial bundle doesn't carry it (#1223).
const UserChatHistoryDialog = lazy(() =>
  import("~/components/admin/user-chat-history-dialog").then((m) => ({
    default: m.UserChatHistoryDialog,
  })),
);

/** Upper bound on the course picker's page; matches the API's max pageSize. */
const COURSE_PICKER_PAGE_SIZE = 200;

export type UsersAdminViewProps = {
  users: PlatformUser[];
  /** Rows matching the current filters, from the server. */
  total: number;
  /** Platform-wide counts, unaffected by the current filters. */
  stats: UserStats;
  onQueryChange: (query: UsersQuery) => void;
  isLoading: boolean;
  error: string | null;
  currentUserId: string;
  onCreateUser: (data: CreateUserInput) => Promise<void>;
  onUpdateUser: (id: string, data: UpdateUserInput) => Promise<void>;
  onDeleteUser: (id: string) => Promise<void>;
  onToggleUserActive: (user: PlatformUser) => Promise<void>;
};

export function UsersAdminView({
  users,
  total,
  stats,
  onQueryChange,
  isLoading,
  error,
  currentUserId,
  onCreateUser,
  onUpdateUser,
  onDeleteUser,
  onToggleUserActive,
}: UsersAdminViewProps) {
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<PlatformUser | null>(null);
  const [historyUser, setHistoryUser] = useState<{ id: string; name: string } | null>(null);
  // The user form's course picker needs a browsable set, not the whole table —
  // one bounded page rather than the unbounded list this used to request.
  const { courses, loading: coursesLoading } = useCourses({ pageSize: COURSE_PICKER_PAGE_SIZE });

  const handleUserDialogOpenChange = (open: boolean) => {
    setUserDialogOpen(open);
    if (!open) setEditingUser(null);
  };

  const handleSubmit = async (data: CreateUserInput | UpdateUserInput) => {
    try {
      if (editingUser) {
        await onUpdateUser(editingUser.id, data as UpdateUserInput);
      } else {
        await onCreateUser(data as CreateUserInput);
      }
      handleUserDialogOpenChange(false);
    } catch (err) {
      console.error("Failed to save user:", err);
      throw err;
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      await onDeleteUser(id);
    } catch (err) {
      console.error("Failed to delete user:", err);
    }
  };

  const handleToggleUserActive = async (user: PlatformUser) => {
    try {
      await onToggleUserActive(user);
    } catch (err) {
      console.error("Failed to toggle user:", err);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center">
        <div
          className="animate-spin rounded-full h-8 w-8 border-b-2"
          style={{ borderColor: "var(--primary)" }}
        />
        <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="px-4 lg:px-6">
            <PageHeading
              heading="User management"
              subheading={
                <>
                  Manage users and their access to the platform &mdash;{" "}
                  <span className="text-foreground font-medium">{stats.total} total</span>
                  {" · "}
                  <span className="text-foreground font-medium">{stats.active} active</span>
                </>
              }
            />
          </div>

          {error && (
            <div className="px-4 lg:px-6">
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          <div className="px-4 lg:px-6">
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>Platform Users</CardTitle>
                  <CardDescription>
                    {stats.total} total &middot; {stats.active} active
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <UsersTable
                  users={users}
                  total={total}
                  onQueryChange={onQueryChange}
                  currentUserId={currentUserId}
                  onEdit={(user) => {
                    setEditingUser(user);
                    setUserDialogOpen(true);
                  }}
                  onDelete={handleDeleteUser}
                  onToggleActive={handleToggleUserActive}
                  onViewChatHistory={(user) => {
                    setHistoryUser({ id: user.id, name: user.name });
                  }}
                  onCreateUser={() => {
                    setEditingUser(null);
                    setUserDialogOpen(true);
                  }}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <UserFormDialog
        open={userDialogOpen}
        onOpenChange={handleUserDialogOpenChange}
        user={editingUser}
        courses={courses}
        coursesLoading={coursesLoading}
        onSubmit={handleSubmit}
      />

      {historyUser && (
        <Suspense fallback={null}>
          <UserChatHistoryDialog
            open={!!historyUser}
            onOpenChange={(open) => !open && setHistoryUser(null)}
            userId={historyUser.id}
            userName={historyUser.name}
          />
        </Suspense>
      )}
    </div>
  );
}

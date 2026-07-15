import { useState } from "react";

import { UserFormDialog } from "~/components/admin/user-form-dialog";
import { UserChatHistoryDialog } from "~/components/admin/user-chat-history-dialog";
import { UsersTable } from "~/components/admin/users-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, PageHeading } from "@eduai/ui";
import type {
  CreateUserInput,
  PlatformUser,
  UpdateUserInput,
} from "~/hooks/api/types";

export type UsersAdminViewProps = {
  users: PlatformUser[];
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
                  <span className="text-foreground font-medium">{users.length} total</span>
                  {" · "}
                  <span className="text-foreground font-medium">
                    {users.filter((u) => u.isActive !== false).length} active
                  </span>
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
                    {users.length} total &middot; {users.filter((u) => u.isActive !== false).length} active
                  </CardDescription>
                </div>
              </CardHeader>
              <CardContent>
                <UsersTable
                  users={users}
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
        onSubmit={handleSubmit}
      />

      {historyUser && (
        <UserChatHistoryDialog
          open={!!historyUser}
          onOpenChange={(open) => !open && setHistoryUser(null)}
          userId={historyUser.id}
          userName={historyUser.name}
        />
      )}
    </div>
  );
}

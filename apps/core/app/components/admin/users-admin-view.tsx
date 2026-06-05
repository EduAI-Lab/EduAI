import { useState } from "react";

import { UserFormDialog } from "~/components/admin/user-form-dialog";
import { UsersTable } from "~/components/admin/users-table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
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

  const handleSubmit = async (data: CreateUserInput | UpdateUserInput) => {
    try {
      if (editingUser) {
        await onUpdateUser(editingUser.id, data as UpdateUserInput);
      } else {
        await onCreateUser(data as CreateUserInput);
      }
      setUserDialogOpen(false);
      setEditingUser(null);
    } catch (err) {
      console.error("Failed to save user:", err);
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
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900" />
        <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">
          <div className="px-4 lg:px-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">User Management</h2>
                <p className="text-muted-foreground">
                  Manage users and their access to the platform
                </p>
              </div>
            </div>
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
                    View and manage all users in the system
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
        onOpenChange={setUserDialogOpen}
        user={editingUser}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

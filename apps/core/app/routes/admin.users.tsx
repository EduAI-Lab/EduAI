import { useState, useEffect } from "react";
import { useLoaderData, redirect } from "react-router";
import type { LoaderFunctionArgs } from "react-router";
import { IconPlus } from "@tabler/icons-react";

import { auth } from "~/lib/auth/server";
import { Button } from "~/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { AppSidebar } from "~/components/app-sidebar";
import { SiteHeader } from "~/components/site-header";
import { SidebarInset, SidebarProvider } from "~/components/ui/sidebar";

import { UsersTable } from "~/components/admin/users-table";
import { UserFormDialog } from "~/components/admin/user-form-dialog";

type User = {
  id: string;
  email: string;
  name: string;
  image?: string;
  role: "ADMIN" | "PROFESSOR" | "TA" | "STUDENT";
  isActive: boolean;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
  _count: {
    enrolledCourses: number;
    assistedCourses: number;
    taughtCourses: number;
    aiInteractions: number;
  };
};

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await auth.api.getSession(request);

  if (!session?.user) {
    return redirect("/auth/login");
  }

  if (session.user.role !== "ADMIN") {
    return redirect("/dashboard");
  }

  return {
    user: session.user,
  };
}

export default function UsersPage() {
  const { user } = useLoaderData<typeof loader>();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  // Dialog states
  const [userDialogOpen, setUserDialogOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  // Fetch users
  const fetchUsers = async () => {
    try {
      const response = await fetch("/api/users");
      if (response.ok) {
        const data: User[] = await response.json();
        setUsers(data);
      }
    } catch (error) {
      console.error("Failed to fetch users:", error);
    }
  };

  useEffect(() => {
    const loadData = async () => {
      await fetchUsers();
      setLoading(false);
    };
    loadData();
  }, []);

  // User CRUD operations
  const handleCreateUser = async (data: any) => {
    try {
      const response = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        await fetchUsers();
        setUserDialogOpen(false);
        setEditingUser(null);
      }
    } catch (error) {
      console.error("Failed to create user:", error);
    }
  };

  const handleUpdateUser = async (data: any) => {
    if (!editingUser) return;

    try {
      const response = await fetch(`/api/users/${editingUser.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        await fetchUsers();
        setUserDialogOpen(false);
        setEditingUser(null);
      }
    } catch (error) {
      console.error("Failed to update user:", error);
    }
  };

  const handleDeleteUser = async (id: string) => {
    try {
      const response = await fetch(`/api/users/${id}`, {
        method: "DELETE",
      });

      if (response.ok) {
        await fetchUsers();
      }
    } catch (error) {
      console.error("Failed to delete user:", error);
    }
  };

  const handleToggleUser = async (userToToggle: User) => {
    try {
      const response = await fetch(`/api/users/${userToToggle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !userToToggle.isActive }),
      });

      if (response.ok) {
        await fetchUsers();
      }
    } catch (error) {
      console.error("Failed to toggle user:", error);
    }
  };



  if (loading) {
    return (
      <SidebarProvider>
        <AppSidebar variant="inset" user={user} />
        <SidebarInset>
          <SiteHeader user={user} />
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
            <p className="mt-4 text-sm text-muted-foreground">Loading...</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar variant="inset" user={user} />
      <SidebarInset>
        <SiteHeader user={user} />
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
                      currentUserId={user.id}
                      onEdit={(user) => {
                        setEditingUser(user);
                        setUserDialogOpen(true);
                      }}
                      onDelete={handleDeleteUser}
                      onToggleActive={handleToggleUser}
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

          {/* Dialog */}
          <UserFormDialog
            open={userDialogOpen}
            onOpenChange={setUserDialogOpen}
            user={editingUser}
            onSubmit={editingUser ? handleUpdateUser : handleCreateUser}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
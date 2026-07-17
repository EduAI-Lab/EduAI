import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@eduai/ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@eduai/ui";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@eduai/ui";
import { Input } from "@eduai/ui";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@eduai/ui";
import { Switch } from "@eduai/ui";
import { MultiSelect } from "@eduai/ui";
import { useForm, useWatch } from "react-hook-form";
import { createUserSchema, updateUserSchema } from "~/lib/auth/schemas";
import { useDisciplines } from "~/hooks/api/use-disciplines";
import type { z } from "zod";

import type { User } from "~/components/admin/users-table";
import type { Course } from "~/hooks/api/use-courses";

type CreateUserFormData = z.infer<typeof createUserSchema>;
type UpdateUserFormData = z.infer<typeof updateUserSchema>;

type FormData = {
  name: string;
  email: string;
  role: "ADMIN" | "UNIT_ADMIN" | "INSTRUCTOR" | "STUDENT";
  isActive: boolean;
  emailVerified?: boolean;
};

export interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: User | null;
  courses?: Pick<Course, "id" | "code" | "name" | "term" | "year">[];
  coursesLoading?: boolean;
  onSubmit: (data: CreateUserFormData | UpdateUserFormData) => Promise<void>;
}

// TA is a course-level Enrollment role assigned from a course's staff tab, not a
// platform role — so it is not an option here.
const roleOptions = [
  { value: "STUDENT", label: "Student" },
  { value: "INSTRUCTOR", label: "Instructor" },
  { value: "UNIT_ADMIN", label: "Unit Administrator" },
  { value: "ADMIN", label: "Administrator" },
];

export function UserFormDialog({
  open,
  onOpenChange,
  user,
  courses = [],
  coursesLoading = false,
  onSubmit,
}: UserFormDialogProps) {
  const isEditing = !!user;

  // Authorized units selection managed separately (not in RHF) to avoid string[] typing complexity
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);
  const [selectedTACourseIds, setSelectedTACourseIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const submissionInFlightRef = useRef(false);
  const wasOpenRef = useRef(false);
  const previousUserIdRef = useRef<string | null>(null);
  const { options: departmentOptions } = useDisciplines();

  const form = useForm<FormData>({
    defaultValues: {
      name: "",
      email: "",
      role: "STUDENT",
      isActive: true,
      emailVerified: false,
    },
  });

  const selectedRole = useWatch({ control: form.control, name: "role" });

  const resetLocalFormState = useCallback(() => {
    if (user) {
      form.reset({
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
      });
      setSelectedUnits(user.authorizedUnits ?? []);
      setSelectedTACourseIds(user.taCourseIds ?? []);
    } else {
      form.reset({
        name: "",
        email: "",
        role: "STUDENT",
        isActive: true,
        emailVerified: false,
      });
      setSelectedUnits([]);
      setSelectedTACourseIds([]);
    }
    setSubmitError(null);
  }, [form, user]);

  useEffect(() => {
    const currentUserId = user?.id ?? null;
    const justOpened = open && !wasOpenRef.current;
    const openedDifferentUser = open && previousUserIdRef.current !== currentUserId;

    if (justOpened || openedDifferentUser) {
      resetLocalFormState();
    }

    wasOpenRef.current = open;
    previousUserIdRef.current = currentUserId;
  }, [open, user, resetLocalFormState]);

  const handleSubmit = async (data: FormData) => {
    if (submissionInFlightRef.current) return;

    const payload = {
      ...data,
      ...(data.role === "UNIT_ADMIN" ? { authorizedUnits: selectedUnits } : {}),
      ...(isEditing
        ? { taCourseIds: data.role === "STUDENT" ? selectedTACourseIds : [] }
        : {}),
    };

    const schema = isEditing ? updateUserSchema : createUserSchema;
    const result = schema.safeParse(payload);

    if (!result.success) {
      setSubmitError(result.error.issues[0]?.message ?? "Please check the form and try again.");
      return;
    }

    submissionInFlightRef.current = true;
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      await onSubmit(result.data);
      form.reset();
      setSelectedUnits([]);
      setSelectedTACourseIds([]);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Failed to save user.");
    } finally {
      submissionInFlightRef.current = false;
      setIsSubmitting(false);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (submissionInFlightRef.current) return;
      resetLocalFormState();
    }
    onOpenChange(nextOpen);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit User" : "Create New User"}
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Name</FormLabel>
                  <FormControl>
                    <Input placeholder="Enter full name" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" placeholder="Enter email address" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="role"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Role</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a role" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {roleOptions.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            {selectedRole === "UNIT_ADMIN" && (
              <FormItem>
                <FormLabel>Authorized Course Codes</FormLabel>
                <FormDescription>
                  Select the course codes this administrator can manage.
                </FormDescription>
                <MultiSelect
                  options={departmentOptions.map((dept) => ({
                    value: dept.code,
                    label: dept.label,
                    description: dept.code,
                  }))}
                  value={selectedUnits}
                  onValueChange={setSelectedUnits}
                  placeholder="Select course codes"
                  searchPlaceholder="Search course codes..."
                />
              </FormItem>
            )}

            <FormField
              control={form.control}
              name="isActive"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                  <div className="space-y-0.5">
                    <FormLabel>Active Status</FormLabel>
                    <FormDescription>
                      Active users can sign in and access the platform
                    </FormDescription>
                  </div>
                  <FormControl>
                    <Switch checked={field.value} onCheckedChange={field.onChange} />
                  </FormControl>
                </FormItem>
              )}
            />

            {isEditing && (
              <FormField
                control={form.control}
                name="emailVerified"
                render={({ field }) => (
                  <FormItem className="flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm">
                    <div className="space-y-0.5">
                      <FormLabel>Email Verified</FormLabel>
                      <FormDescription>
                        Whether the user's email address has been verified
                      </FormDescription>
                    </div>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}

            {isEditing && selectedRole === "STUDENT" && (
              <FormItem>
                <FormLabel>TA Courses</FormLabel>
                <FormDescription>
                  Select the courses where this student should be an active teaching assistant.
                </FormDescription>
                <MultiSelect
                  options={courses.map((course) => ({
                    value: course.id,
                    label: course.code,
                    description: `${course.name} · ${course.term} ${course.year}`,
                  }))}
                  value={selectedTACourseIds}
                  onValueChange={setSelectedTACourseIds}
                  placeholder={coursesLoading ? "Loading courses..." : "Select TA courses"}
                  searchPlaceholder="Search courses..."
                  emptyText="No courses found."
                  disabled={coursesLoading || isSubmitting}
                />
              </FormItem>
            )}

            {submitError && (
              <p role="alert" className="text-sm text-destructive">
                {submitError}
              </p>
            )}

            <div className="flex justify-end space-x-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting
                  ? isEditing
                    ? "Updating User..."
                    : "Creating User..."
                  : isEditing
                    ? "Update User"
                    : "Create User"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

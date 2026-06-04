import { useState, useEffect } from "react";
import { Button } from "~/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "~/components/ui/dialog";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Checkbox } from "~/components/ui/checkbox";
import { Badge } from "~/components/ui/badge";
import { useForm, useWatch } from "react-hook-form";
import { createUserSchema, updateUserSchema } from "~/lib/auth/schemas";
import { DEPARTMENTS } from "~/lib/departments";
import type { z } from "zod";

type User = {
  id: string;
  email: string;
  name: string;
  image?: string;
  role: "ADMIN" | "UNIT_ADMIN" | "PROFESSOR" | "TA" | "STUDENT";
  isActive: boolean;
  emailVerified: boolean;
  authorizedUnits: string[];
  createdAt: string;
  updatedAt: string;
  _count: {
    enrolledCourses: number;
    assistedCourses: number;
    taughtCourses: number;
    aiInteractions: number;
  };
};

type CreateUserFormData = z.infer<typeof createUserSchema>;
type UpdateUserFormData = z.infer<typeof updateUserSchema>;

type FormData = {
  name: string;
  email: string;
  role: "ADMIN" | "UNIT_ADMIN" | "PROFESSOR" | "TA" | "STUDENT";
  isActive: boolean;
  emailVerified?: boolean;
};

interface UserFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user?: User | null;
  onSubmit: (data: CreateUserFormData | UpdateUserFormData) => void;
}

const roleOptions = [
  { value: "STUDENT", label: "Student" },
  { value: "TA", label: "Teaching Assistant" },
  { value: "PROFESSOR", label: "Professor" },
  { value: "UNIT_ADMIN", label: "Unit Administrator" },
  { value: "ADMIN", label: "Administrator" },
];

export function UserFormDialog({ open, onOpenChange, user, onSubmit }: UserFormDialogProps) {
  const isEditing = !!user;

  // Authorized units selection managed separately (not in RHF) to avoid string[] typing complexity
  const [selectedUnits, setSelectedUnits] = useState<string[]>([]);

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

  useEffect(() => {
    if (user) {
      form.reset({
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
      });
      setSelectedUnits(user.authorizedUnits ?? []);
    } else {
      form.reset({
        name: "",
        email: "",
        role: "STUDENT",
        isActive: true,
        emailVerified: false,
      });
      setSelectedUnits([]);
    }
  }, [user, form]);

  const toggleUnit = (code: string) => {
    setSelectedUnits((prev) =>
      prev.includes(code) ? prev.filter((u) => u !== code) : [...prev, code]
    );
  };

  const handleSubmit = (data: FormData) => {
    const payload = {
      ...data,
      authorizedUnits: data.role === "UNIT_ADMIN" ? selectedUnits : [],
    };

    const schema = isEditing ? updateUserSchema : createUserSchema;
    const result = schema.safeParse(payload);

    if (result.success) {
      onSubmit(result.data);
      form.reset();
      setSelectedUnits([]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
                <FormLabel>Authorized Departments</FormLabel>
                <FormDescription>
                  Select the departments this administrator can manage.
                </FormDescription>
                <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
                  {DEPARTMENTS.map((dept) => (
                    <label
                      key={dept.code}
                      className="flex items-center gap-2 cursor-pointer select-none"
                    >
                      <Checkbox
                        checked={selectedUnits.includes(dept.code)}
                        onCheckedChange={() => toggleUnit(dept.code)}
                      />
                      <span className="text-sm">
                        {dept.label}
                        <span className="ml-1 text-xs text-muted-foreground">({dept.code})</span>
                      </span>
                    </label>
                  ))}
                </div>
                {selectedUnits.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {selectedUnits.map((code) => (
                      <Badge key={code} variant="secondary" className="text-xs">{code}</Badge>
                    ))}
                  </div>
                )}
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

            <div className="flex justify-end space-x-2 pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">
                {isEditing ? "Update User" : "Create User"}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

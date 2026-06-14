import { z } from "zod";
import { UnitSchema } from "~/lib/units";

/**
 * Platform roles an admin may issue an invitation for. Deliberately excludes
 * STUDENT (self-registers) and TA (a course-enrollment role, not a platform
 * role — a course TA is a STUDENT user with an EnrollmentRole.TA enrollment).
 */
export const INVITABLE_ROLES = ["ADMIN", "UNIT_ADMIN", "INSTRUCTOR"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

export const createInvitationSchema = z
  .object({
    email: z.string().email("Please enter a valid email address"),
    name: z.string().min(2, "Name must be at least 2 characters").optional(),
    role: z.enum(INVITABLE_ROLES, {
      required_error: "Please select a role",
    }),
    // Only meaningful for UNIT_ADMIN; validated by the superRefine below.
    authorizedUnits: z.array(UnitSchema).optional(),
  })
  .superRefine((data, ctx) => {
    const units = data.authorizedUnits ?? [];
    if (data.role === "UNIT_ADMIN") {
      if (units.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["authorizedUnits"],
          message: "A UNIT_ADMIN invitation must include at least one unit",
        });
      }
    } else if (units.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["authorizedUnits"],
        message: "authorizedUnits may only be set for a UNIT_ADMIN invitation",
      });
    }
  });

export const acceptInvitationSchema = z
  .object({
    token: z.string().min(1, "Missing invitation token"),
    name: z.string().min(2, "Name must be at least 2 characters"),
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export type CreateInvitationInput = z.infer<typeof createInvitationSchema>;
export type AcceptInvitationInput = z.infer<typeof acceptInvitationSchema>;

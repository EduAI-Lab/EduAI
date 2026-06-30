import { z } from "zod";

/**
 * Roles an invitation may carry at the schema level — the union across all
 * inviters. TA is excluded (a course TA is a STUDENT user with an
 * EnrollmentRole.TA enrollment, not a platform role). STUDENT is invitable by
 * ADMIN and UNIT_ADMIN (students may also self-register).
 * The per-inviter restriction is enforced in the route via `invitableRolesFor`.
 */
export const INVITABLE_ROLES = ["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "STUDENT"] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];

/**
 * Which roles a given actor may issue invitations for. ADMIN is a strict
 * superset of every lower role, so it may invite any invitable role (incl.
 * STUDENT — students can also self-register); UNIT_ADMIN may invite instructors
 * and students only. Any other actor may invite no one.
 */
export function invitableRolesFor(actorRole: string | null | undefined): readonly InvitableRole[] {
  if (actorRole === "ADMIN") return ["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "STUDENT"];
  if (actorRole === "UNIT_ADMIN") return ["INSTRUCTOR", "STUDENT"];
  return [];
}

export const createInvitationSchema = z
  .object({
    email: z.string().email("Please enter a valid email address"),
    name: z.string().min(2, "Name must be at least 2 characters").optional(),
    role: z.enum(INVITABLE_ROLES, {
      required_error: "Please select a role",
    }),
    // Only meaningful for UNIT_ADMIN; the superRefine below enforces presence
    // rules and code existence is validated server-side against the Discipline
    // table (§541).
    authorizedUnits: z.array(z.string()).optional(),
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

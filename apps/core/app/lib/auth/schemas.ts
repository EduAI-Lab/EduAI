import { z } from "zod";
import { isUbcEmail, UBC_EMAIL_MESSAGE } from "./ubc-email";
import { isStrongPassword, PASSWORD_POLICY_MESSAGE } from "~/lib/auth/password-policy";

/** A password field that must satisfy the UBC strength policy (#339). */
const strongPassword = z.string().refine(isStrongPassword, { message: PASSWORD_POLICY_MESSAGE });

export const signInSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  rememberMe: z.boolean().optional(),
});

export const signUpSchema = z
  .object({
    name: z.string().min(2, "Name must be at least 2 characters"),
    email: z.string().email("Please enter a valid email address"),
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
  .refine((data) => isUbcEmail(data.email), {
    message: UBC_EMAIL_MESSAGE,
    path: ["email"],
  });

export const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address"),
});

export const resetPasswordSchema = z
  .object({
    password: strongPassword,
    confirmPassword: z.string(),
    token: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

/**
 * #1728: length of the emailed password-reset code. Shared with the
 * better-auth emailOTP plugin config so the form and the issuer cannot drift.
 */
export const PASSWORD_RESET_OTP_LENGTH = 6;

/** The code as it is typed back in: digits only, surrounding space forgiven. */
const passwordResetOtp = z
  .string()
  .trim()
  .regex(
    new RegExp(`^\\d{${PASSWORD_RESET_OTP_LENGTH}}$`),
    `Enter the ${PASSWORD_RESET_OTP_LENGTH}-digit code from your email`,
  );

/**
 * #1728: resetting a forgotten password with an emailed one-time code, as
 * opposed to {@link resetPasswordSchema}'s link token. The password still goes
 * through the same #339 strength policy.
 */
export const resetPasswordOtpSchema = z
  .object({
    email: z
      .string()
      .trim()
      .max(320, "Email address is too long")
      .email("Please enter a valid email address"),
    otp: passwordResetOtp,
    password: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: strongPassword,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export const updateProfileSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
});

export type SignInInput = z.infer<typeof signInSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type ResetPasswordOtpInput = z.infer<typeof resetPasswordOtpSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

// User management schemas for admin operations
export const createUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  role: z.enum(["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "STUDENT"], {
    required_error: "Please select a role",
  }),
  isActive: z.boolean().default(true),
  authorizedUnits: z.array(z.string()).optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  email: z.string().email("Please enter a valid email address").optional(),
  role: z.enum(["ADMIN", "UNIT_ADMIN", "INSTRUCTOR", "STUDENT"]).optional(),
  isActive: z.boolean().optional(),
  emailVerified: z.boolean().optional(),
  // #297: unit scoping for UNIT_ADMIN targets; code existence is validated
  // server-side against the Discipline table (§19/§541).
  authorizedUnits: z.array(z.string()).optional(),
  // Existing STUDENT users may be assigned as TAs in these courses. Course
  // existence and effective-role compatibility are enforced server-side.
  taCourseIds: z.array(z.string().min(1)).optional(),
  studentId: z
    .union([
      z
        .string()
        .trim()
        .regex(/^\d{8}$/, "Student number must be 8 digits"),
      z.null(),
    ])
    .optional(),
});

/** #297: self-service profile edits via /api/me — name and image only. */
export const updateMeSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").optional(),
  image: z.string().url("Image must be a valid URL").nullable().optional(),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

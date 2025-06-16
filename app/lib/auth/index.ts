// Server-side exports
export { auth } from "./server";

// Client-side exports
export {
  authClient,
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  updateUser,
  changePassword,
  changeEmail,
} from "./client";

// Types
export type { Session, User, AuthState, AuthCallbacks } from "./types";

// Schemas
export {
  signInSchema,
  signUpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
  updateProfileSchema,
} from "./schemas";

export type {
  SignInInput,
  SignUpInput,
  ForgotPasswordInput,
  ResetPasswordInput,
  ChangePasswordInput,
  UpdateProfileInput,
} from "./schemas";
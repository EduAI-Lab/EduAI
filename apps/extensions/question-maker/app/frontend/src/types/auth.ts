/**
 * Auth-related types used by frontend services and context.
 */
export interface User {
  id: number;
  email: string;
  createdAt: string;
  /** True when the account is the built-in bug admin (admin@mail.com) or listed in BUG_REPORT_ADMIN_EMAILS. */
  isBugReportAdmin?: boolean;
}

export interface AuthResponse {
  success: boolean;
  message: string;
  data: {
    user: User;
    token: string;
  };
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterCredentials {
  email: string;
  password: string;
}

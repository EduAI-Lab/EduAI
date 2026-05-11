import type { auth } from "./server";

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;

export interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  error: string | null;
}

export interface AuthCallbacks {
  onSuccess?: (data: { user: User; session: Session }) => void;
  onError?: (error: { message: string; code?: string }) => void;
  onRequest?: () => void;
}
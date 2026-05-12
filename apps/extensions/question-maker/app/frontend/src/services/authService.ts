/**
 * Auth API client for login/register/me endpoints plus local token/user storage helpers.
 * Wraps axios calls and keeps localStorage in sync with session state.
 */
import api from './api';
import { AuthResponse, LoginCredentials, RegisterCredentials, User } from '../types/auth';

export const authService = {
  /** Calls login API and returns auth payload. */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    const response = await api.post('/api/auth/login', credentials);
    return response.data;
  },

  /** Registers a new user account and returns auth payload. */
  async register(credentials: RegisterCredentials): Promise<AuthResponse> {
    const response = await api.post('/api/auth/register', credentials);
    return response.data;
  },

  /** Fetches the current user profile using stored credentials. */
  async getCurrentUser(): Promise<User> {
    const response = await api.get('/api/auth/me');
    return response.data.data;
  },

  /** Clears local auth tokens/user data. */
  logout(): void {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  /** Reads the persisted JWT from localStorage. */
  getStoredToken(): string | null {
    return localStorage.getItem('token');
  },

  /** Reads the persisted user object from localStorage. */
  getStoredUser(): User | null {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
  },

  /** Persists user and token to localStorage for future sessions. */
  storeAuthData(user: User, token: string): void {
    localStorage.setItem('user', JSON.stringify(user));
    localStorage.setItem('token', token);
  }
};

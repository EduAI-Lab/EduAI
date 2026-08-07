import axios, { AxiosResponse, AxiosError } from 'axios';
import { getCoreLoginUrl } from '@/lib/coreUrl';

const API_URL = (import.meta as any).env?.VITE_API_URL || '/api';

/**
 * Server pagination envelope (#1044). QM's paginated list endpoints return
 * `{ success, data, total, page, pageSize }`; `data` stays a bare array so
 * existing readers that only touch `data` keep working. Mirrors ai-tutor's
 * `Paginated<T>` (#1043) / Core's contract (#1041), plus QM's `success` flag.
 */
export type Paginated<T> = {
  success: boolean;
  data: T[];
  total: number;
  page: number;
  pageSize: number;
};

export const api = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json'
  },
  withCredentials: true
});

api.interceptors.response.use(
  (response: AxiosResponse) => response,
  (error: AxiosError) => {
    if (error.response?.status === 401) {
      const apiError = (error.response.data as { error?: string; success?: boolean })?.error;
      const isSessionExpired =
        apiError === 'Authentication required' ||
        (apiError === 'Unauthorized' &&
          typeof error.config?.url === 'string' &&
          error.config.url.includes('/api/auth/me'));

      if (isSessionExpired) {
        window.location.href = getCoreLoginUrl();
      }
    }
    return Promise.reject(error);
  }
);

export default api;

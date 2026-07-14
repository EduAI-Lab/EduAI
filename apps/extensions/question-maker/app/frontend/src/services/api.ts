import axios, { AxiosResponse, AxiosError } from 'axios';
import { getCoreLoginUrl } from '@/lib/coreUrl';

const API_URL = (import.meta as any).env?.VITE_API_URL || '/api';

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

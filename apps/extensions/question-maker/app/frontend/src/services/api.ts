import axios, { AxiosResponse, AxiosError } from 'axios';

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
      const coreUrl = (import.meta as any).env?.VITE_CORE_URL || 'http://localhost:3000';
      const returnUrl = encodeURIComponent(window.location.href);
      window.location.href = `${coreUrl}/login?redirect=${returnUrl}`;
    }
    return Promise.reject(error);
  }
);

export default api;

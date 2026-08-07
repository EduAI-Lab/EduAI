import api from './api';
import { User } from '../types/auth';

export const authService = {
  async getCurrentUser(): Promise<User> {
    const response = await api.get('/api/auth/me');
    return response.data.user;
  },
};

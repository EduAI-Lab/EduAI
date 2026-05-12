/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from './LoginPage';

const auth = {
  login: vi.fn(),
  register: vi.fn(),
  isAuthenticated: false,
  isLoading: false,
};

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => auth,
}));

vi.mock('../components/FloatingLetters', () => ({
  FloatingLetters: () => null,
}));

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/courses" element={<div data-testid="courses-redirect">Course selection</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('LoginPage', () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    auth.isAuthenticated = false;
    auth.isLoading = false;
    auth.login.mockReset();
    auth.register.mockReset();
    auth.login.mockResolvedValue({ success: true });
    auth.register.mockResolvedValue({ success: true });
  });

  it('submits login and calls auth.login with email and password', async () => {
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'user@test.edu' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret12' } });
    fireEvent.click(screen.getByRole('button', { name: /Login$/ }));

    await waitFor(() => {
      expect(auth.login).toHaveBeenCalledWith('user@test.edu', 'secret12');
    });
  });

  it('shows the server error when login returns success: false', async () => {
    auth.login.mockResolvedValue({ success: false, error: 'Invalid email or password' });
    renderLogin();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@b.co' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByRole('button', { name: /Login$/ }));

    await waitFor(() => {
      expect(screen.getByText('Invalid email or password')).toBeInTheDocument();
    });
  });

  it('switches to register and calls auth.register on submit', async () => {
    renderLogin();

    fireEvent.click(screen.getByRole('button', { name: 'Sign up' }));
    expect(screen.getByRole('button', { name: /^Register$/ })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@test.edu' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'newpass1' } });
    fireEvent.click(screen.getByRole('button', { name: /^Register$/ }));

    await waitFor(() => {
      expect(auth.register).toHaveBeenCalledWith('new@test.edu', 'newpass1');
    });
  });

  it('renders a loading state while auth is initializing', () => {
    auth.isLoading = true;
    const { container } = renderLogin();
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('redirects to /courses when already authenticated', () => {
    auth.isAuthenticated = true;
    renderLogin();
    expect(screen.getByTestId('courses-redirect')).toBeInTheDocument();
  });
});

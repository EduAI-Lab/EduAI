import type { Route } from './+types/home';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { PageLoader } from '@eduai/ui';
import { useLocalUser } from '../hooks/useLocalUser';
import { routeForRole } from '../lib/role-routing';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'AI Tutor' },
    { name: 'description', content: 'AI Tutor — Loading' },
  ];
}

export default function Home() {
  const navigate = useNavigate();
  const { user, isInitializing } = useLocalUser();

  useEffect(() => {
    if (!user) return;
    navigate(routeForRole(user.role), { replace: true });
  }, [navigate, user]);

  useEffect(() => {
    if (isInitializing || user) return;
    // api.ts 401 handler fires first and redirects to Core login, but redirect
    // here too as a safety net for any path that reaches this state without a
    // prior 401 (e.g. a null user returned with 200).
    const coreUrl = import.meta.env.VITE_CORE_URL || 'http://localhost:3000';
    const returnUrl = encodeURIComponent(window.location.href);
    window.location.href = `${coreUrl}/login?redirect=${returnUrl}`;
  }, [isInitializing, user]);

  return <PageLoader />;
}

import type { Route } from './+types/home';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useLocalUser } from '../hooks/useLocalUser';
import { IconBrain } from '@tabler/icons-react';
import { routeForRole } from '../lib/role-routing';
import { getCoreLoginUrl } from '../lib/coreUrl';

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
    window.location.href = getCoreLoginUrl();
  }, [isInitializing, user]);

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background">
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
        <div className="h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
      </div>
      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
          <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <IconBrain className="absolute inset-0 m-auto h-6 w-6 animate-pulse text-primary" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">
          Initializing your workspace...
        </p>
      </div>
    </main>
  );
}

import type { Route } from './+types/home';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useLocalUser } from '../hooks/useLocalUser';
import { BrainCircuit } from 'lucide-react';
import type { Role } from '../lib/types';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'AI Tutor' },
    { name: 'description', content: 'AI Tutor — Loading' },
  ];
}

function routeForRole(role: Role) {
  if (role === 'STUDENT') return '/student';
  if (role === 'INSTRUCTOR') return '/instructor';
  if (role === 'TA') return '/unsupported-role';
  return '/admin';
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

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background">
      <div className="absolute inset-0 dots-pattern opacity-50" />
      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
          <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <BrainCircuit className="absolute inset-0 m-auto h-6 w-6 animate-pulse text-primary" />
        </div>
        <div className="animate-pulse font-display text-lg font-medium text-muted-foreground">
          Initializing your workspace...
        </div>
      </div>
    </main>
  );
}

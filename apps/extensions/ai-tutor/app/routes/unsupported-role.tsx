import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useLocalUser } from '../hooks/useLocalUser';

function routeForRole(role: string) {
  if (role === 'STUDENT') return '/student';
  if (role === 'PROFESSOR') return '/instructor';
  if (role === 'ADMIN') return '/admin';
  return '/';
}

export default function UnsupportedRolePage() {
  const navigate = useNavigate();
  const { user, logout } = useLocalUser();

  useEffect(() => {
    if (!user) {
      navigate('/', { replace: true });
      return;
    }

    if (user.role !== 'TA') {
      navigate(routeForRole(user.role), { replace: true });
    }
  }, [navigate, user]);

  const handleLogout = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  return (
    <main className="relative min-h-dvh overflow-hidden bg-background">
      <div className="absolute inset-0 dots-pattern" />
      <div className="relative container mx-auto flex min-h-dvh items-center justify-center px-6 py-12">
        <div className="card-editorial w-full max-w-xl p-8 sm:p-10">
          <div className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <svg
              className="h-7 w-7"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          </div>

          <h1 className="mb-3 font-display text-3xl font-bold text-foreground">
            TA access is not available yet
          </h1>
          <p className="mb-4 text-base text-muted-foreground">
            Your EduAI account was authenticated successfully, but AI Tutor does not support TA
            access in this first release.
          </p>
          <p className="mb-8 text-sm text-muted-foreground">
            If you expected a different role, update it in EduAI and sign in again. Otherwise,
            please contact the EduAI team for access guidance.
          </p>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button type="button" onClick={handleLogout} className="btn-primary">
              Sign out
            </button>
            <button
              type="button"
              onClick={() => navigate('/', { replace: true })}
              className="btn-ghost"
            >
              Back to home
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}

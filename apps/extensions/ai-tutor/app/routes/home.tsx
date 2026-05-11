import type { Route } from './+types/home';
import { useEffect, useState, cloneElement, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useLocalUser } from '../hooks/useLocalUser';
import { signInWithEduAi } from '../lib/auth-client';
import type { Role } from '../lib/types';
import {
  BookOpen,
  BrainCircuit,
  GraduationCap,
  LayoutDashboard,
  Library,
  LineChart,
  Sparkles,
  Zap,
} from 'lucide-react';

export function meta({}: Route.MetaArgs) {
  return [
    { title: 'AI Tutor - Welcome' },
    { name: 'description', content: 'Sign in to AI Tutor with your EduAI account' },
  ];
}

function routeForRole(role: Role) {
  if (role === 'STUDENT') return '/student';
  if (role === 'PROFESSOR') return '/instructor';
  if (role === 'TA') return '/unsupported-role';
  return '/admin';
}

function extractErrorMessage(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Could not start EduAI sign-in';
  }

  try {
    const parsed = JSON.parse(error.message);
    if (typeof parsed?.message === 'string' && parsed.message.trim()) {
      return parsed.message;
    }
    if (typeof parsed?.error === 'string' && parsed.error.trim()) {
      return parsed.error;
    }
  } catch {
    // Fall back to the raw message when the backend returns plain text.
  }

  return error.message || 'Could not start EduAI sign-in';
}

const HUB_POSITION = { x: 200, y: 200 };

const VISUAL_NODES = [
  {
    label: 'Curriculum',
    icon: <Library className="h-5 w-5" />,
    x: 116,
    y: 98,
    delayClassName: '',
  },
  {
    label: 'AI Insights',
    icon: <Sparkles className="h-5 w-5" />,
    x: 316,
    y: 122,
    delayClassName: 'delay-300',
  },
  {
    label: 'Progress',
    icon: <LineChart className="h-5 w-5" />,
    x: 82,
    y: 306,
    delayClassName: 'delay-500',
  },
  {
    label: 'Dashboard',
    icon: <LayoutDashboard className="h-5 w-5" />,
    x: 294,
    y: 350,
    delayClassName: 'delay-700',
  },
] as const;

export default function Home() {
  const navigate = useNavigate();
  const { user, isInitializing } = useLocalUser();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!user) return;
    navigate(routeForRole(user.role), { replace: true });
  }, [navigate, user]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('authError') === 'eduai_sign_in_failed') {
      setError('EduAI sign-in did not complete. Please try again.');
    }
  }, []);

  const onSignIn = async () => {
    setLoading(true);
    setError('');

    try {
      await signInWithEduAi();
    } catch (err) {
      setError(extractErrorMessage(err));
      setLoading(false);
      return;
    } finally {
      // Full-page redirect keeps this from usually running, but it protects the button on failure.
      setLoading(false);
    }
  };

  if (isInitializing || user) {
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

  return (
    <main className="relative min-h-dvh w-full overflow-hidden bg-background text-foreground lg:grid lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-primary/5 p-12 dark:bg-primary/5 lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 dots-pattern opacity-30" />
        <div className="absolute top-[-20%] left-[-10%] h-[500px] w-[500px] animate-pulse-soft rounded-full bg-primary/10 blur-[100px]" />
        <div className="delay-700 absolute right-[-10%] bottom-[-10%] h-[400px] w-[400px] animate-float rounded-full bg-accent/10 blur-[80px]" />

        <div className="animate-fade-down relative z-10 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
            <GraduationCap className="h-6 w-6" />
          </div>
          <span className="font-display text-xl font-bold tracking-tight">AI Tutor</span>
        </div>

        <div className="relative z-10 flex flex-1 items-center justify-center">
          <div className="aspect-square w-full max-w-md">
            <div className="animate-scale-in absolute inset-0 z-20 m-auto flex h-32 w-32 items-center justify-center rounded-3xl border border-border/50 bg-card shadow-2xl">
              <BrainCircuit className="h-16 w-16 text-primary" />
            </div>

            <svg
              className="pointer-events-none absolute inset-0 z-10 h-full w-full text-primary opacity-20"
              viewBox="0 0 400 400"
            >
              {VISUAL_NODES.map((node) => (
                <path
                  key={node.label}
                  d={`M${HUB_POSITION.x} ${HUB_POSITION.y} L${node.x} ${node.y}`}
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeDasharray="4 4"
                />
              ))}
            </svg>

            {VISUAL_NODES.map((node) => (
              <div
                key={node.label}
                className={`${node.delayClassName} absolute z-20 animate-float -translate-x-1/2 -translate-y-1/2`}
                style={{
                  left: `${(node.x / 400) * 100}%`,
                  top: `${(node.y / 400) * 100}%`,
                }}
              >
                <FloatingNode icon={node.icon} label={node.label} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="relative flex flex-col items-center justify-center bg-background p-6 sm:p-12 lg:p-24">
        <div className="absolute inset-0 dots-pattern opacity-50 lg:hidden" />

        <div className="z-10 w-full max-w-lg space-y-10">
          <div className="animate-fade-down mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg shadow-primary/20">
              <GraduationCap className="h-6 w-6" />
            </div>
            <span className="font-display text-xl font-bold tracking-tight">AI Tutor</span>
          </div>

          <div className="animate-fade-up space-y-4 text-center lg:text-left">
            <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary">
              <Sparkles className="h-3 w-3" />
              <span>Next Gen Learning</span>
            </div>
            <h1 className="font-display text-4xl leading-[1.1] font-bold text-foreground tracking-tight sm:text-5xl lg:text-6xl">
              Master any subject <br />
              <span className="text-gradient">with AI guidance</span>
            </h1>
            <p className="mx-auto max-w-md text-lg text-muted-foreground lg:mx-0">
              Experience a personalized learning journey that adapts to your pace. Get real-time
              feedback, deep insights, and structured curriculum.
            </p>
          </div>

          <div className="panel-glass delay-200 animate-scale-in rounded-2xl border border-border/50 p-8 shadow-xl">
            <div className="mb-6">
              <h2 className="flex items-center gap-2 font-display text-xl font-semibold text-foreground">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-foreground">
                  <BookOpen className="h-4 w-4" />
                </span>
                Welcome back
              </h2>
              <p className="mt-1 ml-10 text-sm text-muted-foreground">
                Sign in to continue your progress
              </p>
            </div>

            {error && (
              <div className="animate-fade-in mb-6 flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">
                <div className="mt-0.5">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <p>{error}</p>
              </div>
            )}

            <div className="space-y-4">
              <button
                type="button"
                onClick={onSignIn}
                disabled={loading}
                className="btn-primary group relative w-full overflow-hidden"
              >
                <div className="relative z-10 flex items-center justify-center gap-2">
                  {loading ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign in with EduAI</span>
                      <Zap className="h-4 w-4 transition-transform group-hover:scale-110" />
                    </>
                  )}
                </div>
                <div className="group-hover:animate-shimmer absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/20 to-transparent" />
              </button>

              <p className="text-center text-xs text-muted-foreground">
                By signing in, you agree to our Terms of Service and Privacy Policy.
              </p>
            </div>
          </div>

          <div className="delay-300 animate-fade-up grid grid-cols-3 gap-4 border-t border-border/50 pt-4">
            <div className="col-span-1">
              <FeatureItem icon={<BrainCircuit />} label="Adaptive" />
            </div>
            <div className="col-span-1">
              <FeatureItem icon={<Library />} label="Structured" />
            </div>
            <div className="col-span-1">
              <FeatureItem icon={<LineChart />} label="Analytics" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function FloatingNode({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card bg-opacity-90 p-3 shadow-lg backdrop-blur-sm">
      <div className="text-primary">{icon}</div>
      <span className="whitespace-nowrap text-xs font-semibold">{label}</span>
    </div>
  );
}

function FeatureItem({
  icon,
  label,
}: {
  icon: ReactElement<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="group flex cursor-default flex-col items-center gap-2 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-secondary text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
        {cloneElement(icon, { className: 'h-5 w-5' })}
      </div>
      <span className="text-xs font-medium text-muted-foreground transition-colors group-hover:text-foreground">
        {label}
      </span>
    </div>
  );
}

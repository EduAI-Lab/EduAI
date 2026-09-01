import type { Route } from "./+types/home";
import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useLocalUser } from "../hooks/useLocalUser";
import { Button } from "@eduai/ui";
import { IconAlertTriangle, IconBrain } from "@tabler/icons-react";
import { routeForRole } from "../lib/role-routing";
import { getCoreLoginUrl } from "../lib/coreUrl";

export function meta(_: Route.MetaArgs) {
  return [{ title: "AI Tutor" }, { name: "description", content: "AI Tutor — Loading" }];
}

export default function Home() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, isInitializing, authError } = useLocalUser();

  useEffect(() => {
    if (!user) return;
    const coreCourseId = searchParams.get("coreCourseId")?.trim();
    const destination = coreCourseId
      ? `${user.role === "STUDENT" ? "/student" : "/instructor"}?coreCourseId=${encodeURIComponent(coreCourseId)}`
      : routeForRole(user.role);
    navigate(destination, { replace: true });
  }, [navigate, searchParams, user]);

  useEffect(() => {
    if (isInitializing || user || authError) return;
    // api.ts 401 handler fires first and redirects to Core login, but redirect
    // here too as a safety net for any path that reaches this state without a
    // prior 401 (e.g. a null user returned with 200).
    window.location.href = getCoreLoginUrl();
  }, [authError, isInitializing, user]);

  if (authError) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center shadow-sm">
          <IconAlertTriangle className="size-10 text-destructive" aria-hidden="true" />
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">Authentication service unavailable</h1>
            <p className="text-sm text-muted-foreground">
              AI Tutor could not verify your EduAI session. Your browser session was not treated as
              logged out. Try again when Core is available.
            </p>
          </div>
          <Button type="button" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background">
      <div aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
        <div className="h-64 w-64 rounded-full bg-primary/10 blur-3xl" />
      </div>
      <div className="relative z-10 flex flex-col items-center gap-4">
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 rounded-full border-4 border-primary/20" />
          <div className="absolute inset-0 rounded-full border-4 border-primary border-t-transparent animate-spin" />
          <IconBrain className="absolute inset-0 m-auto h-6 w-6 animate-pulse text-primary-text" />
        </div>
        <p className="text-sm font-medium text-muted-foreground">Initializing your workspace...</p>
      </div>
    </main>
  );
}

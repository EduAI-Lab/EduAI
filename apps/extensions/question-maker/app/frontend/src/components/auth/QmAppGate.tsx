import { ReactNode, useEffect } from "react";
import { Button, PageLoader } from "@eduai/ui";
import { IconAlertTriangle } from "@tabler/icons-react";
import { useAuth } from "@/contexts/AuthContext";
import { canAccessQm } from "@/lib/rbac/roles";
import { AccessDeniedView } from "@/components/auth/AccessDeniedView";
import { getCoreLoginUrl } from "@/lib/coreUrl";
import { QmAccessShell } from "@/components/layout/QmAppLayout";

type QmAppGateProps = {
  children: ReactNode;
};

export function QmAppGate({ children }: QmAppGateProps) {
  const { user, isLoading, authError } = useAuth();

  useEffect(() => {
    if (!isLoading && !user && !authError) {
      window.location.href = getCoreLoginUrl();
    }
  }, [authError, isLoading, user]);

  if (isLoading) {
    return <PageLoader />;
  }

  // Same bare, centred card AI Tutor shows (ai-tutor/app/routes/home.tsx): with
  // no verified user there is no sidebar worth drawing around it.
  if (authError) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-6">
        <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-xl border bg-card p-8 text-center shadow-sm">
          <IconAlertTriangle className="size-10 text-destructive" aria-hidden="true" />
          <div className="space-y-2">
            <h1 className="text-xl font-semibold">Authentication service unavailable</h1>
            <p className="text-sm text-muted-foreground">
              Question Maker could not verify your EduAI session. Your browser session was not
              treated as logged out. Try again when Core is available.
            </p>
          </div>
          <Button type="button" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </main>
    );
  }

  if (!user) {
    return <PageLoader />;
  }

  if (!canAccessQm(user.questionMakerRole ?? user.role)) {
    return (
      <QmAccessShell>
        <AccessDeniedView />
      </QmAccessShell>
    );
  }

  return <>{children}</>;
}

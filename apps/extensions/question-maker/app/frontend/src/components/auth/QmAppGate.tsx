import { ReactNode, useEffect } from "react";
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  PageLoader,
} from "@eduai/ui";
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

  if (authError) {
    return (
      <QmAccessShell>
        <Card className="w-full max-w-md">
          <CardHeader>
            <IconAlertTriangle className="mb-2 size-8 text-destructive" aria-hidden="true" />
            <CardTitle>
              <h1>Authentication service unavailable</h1>
            </CardTitle>
            <CardDescription>
              Question Maker could not verify your EduAI session. Your browser session was not
              treated as logged out. Try again when Core is available.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button type="button" onClick={() => window.location.reload()}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </QmAccessShell>
    );
  }

  if (!user) {
    return <PageLoader />;
  }

  if (!canAccessQm(user.role)) {
    return (
      <QmAccessShell>
        <AccessDeniedView />
      </QmAccessShell>
    );
  }

  return <>{children}</>;
}

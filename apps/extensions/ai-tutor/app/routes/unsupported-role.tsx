import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { IconInfoCircle } from '@tabler/icons-react';
import { Button, Card } from '@eduai/ui';
import { useLocalUser } from '../hooks/useLocalUser';
import { routeForRole } from '../lib/role-routing';

export default function UnsupportedRolePage() {
  const navigate = useNavigate();
  const { user, logout } = useLocalUser();

  useEffect(() => {
    if (!user) {
      navigate('/', { replace: true });
      return;
    }

    navigate(routeForRole(user.role), { replace: true });
  }, [navigate, user]);

  const handleLogout = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6 py-12">
      <Card className="w-full max-w-xl p-8 sm:p-10">
        <div className="flex flex-col gap-6">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-accent/15 text-accent">
            <IconInfoCircle className="h-7 w-7" />
          </div>

          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-bold text-foreground">Your role is not supported yet</h1>
            <p className="text-base text-muted-foreground">
              Your EduAI account was authenticated successfully, but AI Tutor does not support
              your role ({user?.role}) in this release.
            </p>
            <p className="text-sm text-muted-foreground">
              If you expected a different role, update it in EduAI and sign in again. Otherwise,
              contact the EduAI team for access guidance.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button type="button" onClick={handleLogout}>
              Sign out
            </Button>
          </div>
        </div>
      </Card>
    </main>
  );
}

/**
 * Per-user Settings — Account + Accessibility + Providers (BYOK), matching
 * the dense, tabbed pattern used by Core's `settings-view.tsx` and Question
 * Maker's `SettingsPage.tsx`. Admin-only AI configuration is NOT here; it
 * lives on the `/admin` console alongside bug-report triage.
 *
 * Accessibility now composes the shared `AccessibilitySettings` component
 * (`@eduai/ui`) directly, same as Core and Question Maker. Density and
 * reduce-motion are owned by `UiPreferencesProvider` (mounted in `root.tsx`),
 * which persists them to `localStorage` and applies the `[data-density]` /
 * `[data-reduce-motion]` hooks app-wide; this app's `app.css` carries the CSS
 * that reads them, ported from Core's. Question Maker's settings page still
 * ships the same two toggles as session-only attribute state and needs the
 * same fix — this screen no longer does.
 * Assistive Mode is passed through unchanged: it is BREB-approved and its
 * `[data-assistive] .reading-surface` contract (see
 * `~/components/settings/assistive-mode.tsx`) must not be touched.
 */
import { useNavigate } from "react-router";
import {
  AccessibilitySettings,
  Avatar,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  RoleBadge,
  SettingsPageScaffold,
  SignOutCard,
  useTheme,
  type AccessibilityUiTheme,
} from "@eduai/ui";
import { IconAccessible, IconLogout, IconUser, IconWorld } from "@tabler/icons-react";
import { toast } from "sonner";

import { useAssistiveMode } from "~/components/settings/assistive-mode";
import { useUiPreferences } from "~/components/settings/ui-preferences";
import { ProvidersSettings } from "~/components/settings/providers-settings";
import { useLocalUser } from "~/hooks/useLocalUser";

export function SettingsView() {
  const { user, logout } = useLocalUser();
  const navigate = useNavigate();
  const { theme: nextTheme, setTheme } = useTheme();
  const { assistive, setAssistive } = useAssistiveMode();
  // Owned by `UiPreferencesProvider` (mounted in `root.tsx`), which persists
  // both and applies the html hooks app-wide — not just while this screen is
  // mounted, and not lost on reload.
  const { density, motionReduced, setDensity, setMotionReduced } = useUiPreferences();

  const theme = (nextTheme as AccessibilityUiTheme | undefined) ?? "system";

  const handleLogout = async () => {
    try {
      await logout();
      navigate("/");
    } catch {
      toast.error("Could not log out", {
        description: "Your session is still active. Please try again.",
      });
    }
  };

  return (
    <SettingsPageScaffold
      padding="app"
      subheading="Manage your account, accessibility preferences, and AI provider keys."
      footer={
        <SignOutCard
          action={
            <Button type="button" variant="outline" onClick={() => void handleLogout()}>
              <IconLogout className="h-4 w-4" /> Log out
            </Button>
          }
        />
      }
      tabs={[
        {
          value: "account",
          label: "Account",
          icon: <IconUser className="h-4 w-4" />,
          content: (
            <Card>
              <CardHeader>
                <CardTitle>Profile</CardTitle>
                <CardDescription>Your account details for this AI Tutor session.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-4">
                  <Avatar name={user?.name ?? "You"} size={48} radius={12} />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-medium">{user?.name ?? "Signed in"}</p>
                    {user?.email && (
                      <p className="truncate text-sm text-muted-foreground">{user.email}</p>
                    )}
                  </div>
                  {user?.role && <RoleBadge role={user.role} className="shrink-0" />}
                </div>
              </CardContent>
            </Card>
          ),
        },
        {
          value: "accessibility",
          label: "Accessibility",
          icon: <IconAccessible className="h-4 w-4" />,
          content: (
            <AccessibilitySettings
              theme={theme}
              density={density}
              motionReduced={motionReduced}
              assistive={assistive}
              onThemeChange={(value) => setTheme(value)}
              onDensityChange={setDensity}
              onMotionReducedChange={setMotionReduced}
              onAssistiveChange={setAssistive}
              description="Personalize how AI Tutor looks and feels. These settings are optional for everyone."
            />
          ),
        },
        {
          value: "providers",
          label: "Providers",
          icon: <IconWorld className="h-4 w-4" />,
          content: <ProvidersSettings />,
        },
      ]}
    />
  );
}

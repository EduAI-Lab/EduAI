import { useAssistiveUi } from "~/components/assistive/assistive-ui-provider";
import { useUiPreferences } from "~/components/assistive/ui-preferences-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
  Switch,
  useTheme,
} from "@eduai/ui";
import { DEFAULT_UI_PREFERENCES, type UiTheme } from "~/lib/ui-preferences";

const settingsChoiceClass =
  "settings-choice cursor-pointer flex items-center gap-2 rounded-md border border-border p-3 transition-colors has-[[data-state=checked]]:bg-accent has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-accent dark:has-[[data-state=checked]]:bg-accent dark:has-[[data-state=checked]]:ring-accent";

const settingsSwitchClass =
  "data-[state=checked]:bg-accent dark:data-[state=unchecked]:border-border dark:data-[state=unchecked]:bg-muted cursor-pointer";

export function AccessibilitySettingsTab() {
  const { assistive, setAssistive } = useAssistiveUi();
  const { motionReduced, density, setMotionReduced, setDensity } = useUiPreferences();
  const { theme: nextTheme, setTheme: setNextTheme } = useTheme();

  // Theme is owned by next-themes (shared `theme` localStorage key carries the
  // choice across Core/AI Tutor/Question Maker). We also mirror it to the
  // account so the preference survives across devices.
  const theme = (nextTheme as UiTheme | undefined) ?? DEFAULT_UI_PREFERENCES.theme;
  const setTheme = (value: UiTheme) => {
    setNextTheme(value);
    fetch("/api/preferences", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ theme: value }),
    }).catch((error) => {
      console.error("Failed to persist theme preference:", error);
    });
  };

  return (
    <div className="mt-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Accessibility</CardTitle>
          <CardDescription>
            Personalize how EduAI looks and feels. These settings sync to your account and
            are optional for everyone.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="assistive-mode" className="text-base">
                Assistive Mode
              </Label>
              <p className="text-sm text-muted-foreground">
                Optional reading and focus enhancements across EduAI.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Switch
                id="assistive-mode"
                checked={assistive}
                onCheckedChange={(checked) => setAssistive(Boolean(checked))}
                aria-label="Assistive Mode"
                className={settingsSwitchClass}
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap cursor-pointer">
                {assistive ? "On" : "Off"}
              </span>
            </div>
          </div>

          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="reduce-motion" className="text-base">
                Reduce motion
              </Label>
              <p className="text-sm text-muted-foreground">
                Minimize animations and transitions.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Switch
                id="reduce-motion"
                checked={motionReduced}
                onCheckedChange={(checked) => setMotionReduced(Boolean(checked))}
                aria-label="Reduce motion"
                className={settingsSwitchClass}
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap cursor-pointer">
                {motionReduced ? "On" : "Off"}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-base">Density</Label>
              <p className="text-sm text-muted-foreground">
                Choose a more compact or comfortable layout spacing.
              </p>
            </div>
            <RadioGroup
              value={density}
              onValueChange={(value) => setDensity(value as typeof density)}
              className="grid gap-2 sm:grid-cols-2"
            >
              <div className={settingsChoiceClass}>
                <RadioGroupItem value="comfortable" id="density-comfortable" />
                <Label htmlFor="density-comfortable" className="font-normal cursor-pointer">
                  Comfortable
                </Label>
              </div>
              <div className={settingsChoiceClass}>
                <RadioGroupItem value="compact" id="density-compact" />
                <Label htmlFor="density-compact" className="font-normal cursor-pointer">
                  Compact
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-base">Theme</Label>
              <p className="text-sm text-muted-foreground">
                Match your device or choose light or dark.
              </p>
            </div>
            <RadioGroup
              value={theme}
              onValueChange={(value) => setTheme(value as typeof theme)}
              className="grid gap-2 sm:grid-cols-3"
            >
              <div className={settingsChoiceClass}>
                <RadioGroupItem value="system" id="theme-system" />
                <Label htmlFor="theme-system" className="font-normal cursor-pointer">
                  System
                </Label>
              </div>
              <div className={settingsChoiceClass}>
                <RadioGroupItem value="light" id="theme-light" />
                <Label htmlFor="theme-light" className="font-normal cursor-pointer">
                  Light
                </Label>
              </div>
              <div className={settingsChoiceClass}>
                <RadioGroupItem value="dark" id="theme-dark" />
                <Label htmlFor="theme-dark" className="font-normal cursor-pointer">
                  Dark
                </Label>
              </div>
            </RadioGroup>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

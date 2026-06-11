import { useAssistiveUi } from "~/components/assistive/assistive-ui-provider";
import { useUiPreferences } from "~/components/assistive/ui-preferences-provider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Switch } from "~/components/ui/switch";

export function AccessibilitySettingsTab() {
  const { assistive, setAssistive } = useAssistiveUi();
  const { motionReduced, density, theme, setMotionReduced, setDensity, setTheme } =
    useUiPreferences();

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
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">
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
              />
              <span className="text-sm text-muted-foreground whitespace-nowrap">
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
              <div className="flex items-center gap-2 rounded-md border p-3">
                <RadioGroupItem value="comfortable" id="density-comfortable" />
                <Label htmlFor="density-comfortable" className="font-normal">
                  Comfortable
                </Label>
              </div>
              <div className="flex items-center gap-2 rounded-md border p-3">
                <RadioGroupItem value="compact" id="density-compact" />
                <Label htmlFor="density-compact" className="font-normal">
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
              <div className="flex items-center gap-2 rounded-md border p-3">
                <RadioGroupItem value="system" id="theme-system" />
                <Label htmlFor="theme-system" className="font-normal">
                  System
                </Label>
              </div>
              <div className="flex items-center gap-2 rounded-md border p-3">
                <RadioGroupItem value="light" id="theme-light" />
                <Label htmlFor="theme-light" className="font-normal">
                  Light
                </Label>
              </div>
              <div className="flex items-center gap-2 rounded-md border p-3">
                <RadioGroupItem value="dark" id="theme-dark" />
                <Label htmlFor="theme-dark" className="font-normal">
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

/**
 * Shared AccessibilitySettings panel — router-agnostic, props-driven.
 *
 * All app-specific behaviour (fetching /api/preferences, reading context
 * providers) is lifted to callback props so the component has zero
 * react-router / server / app-specific hook dependencies.
 */
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Label } from "../ui/label";
import { RadioGroup, RadioGroupItem } from "../ui/radio-group";
import { Switch } from "../ui/switch";

// ── Types ──────────────────────────────────────────────────────────────────

export type UiDensity = "comfortable" | "compact";
export type UiTheme = "system" | "light" | "dark";

export interface AccessibilitySettingsProps {
  // Current values
  theme: UiTheme;
  density: UiDensity;
  motionReduced: boolean;
  /** Assistive mode is an optional feature — omit to hide the toggle. */
  assistive?: boolean;

  // Callbacks
  onThemeChange: (value: UiTheme) => void;
  onDensityChange: (value: UiDensity) => void;
  onMotionReducedChange: (value: boolean) => void;
  /** Required when `assistive` prop is provided. */
  onAssistiveChange?: (value: boolean) => void;

  /** Override the card description text. */
  description?: string;
}

// ── Styles ─────────────────────────────────────────────────────────────────

const settingsChoiceClass =
  "settings-choice cursor-pointer flex items-center gap-2 rounded-md border border-border p-3 transition-colors has-[[data-state=checked]]:bg-accent has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-accent dark:has-[[data-state=checked]]:bg-accent dark:has-[[data-state=checked]]:ring-accent";

const settingsSwitchClass =
  "data-[state=checked]:bg-accent dark:data-[state=unchecked]:border-border dark:data-[state=unchecked]:bg-muted cursor-pointer";

// ── Component ──────────────────────────────────────────────────────────────

export function AccessibilitySettings({
  theme,
  density,
  motionReduced,
  assistive,
  onThemeChange,
  onDensityChange,
  onMotionReducedChange,
  onAssistiveChange,
  description = "Personalize how EduAI looks and feels. These settings are optional for everyone.",
}: AccessibilitySettingsProps) {
  return (
    <div className="mt-6 space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Accessibility</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-8">
          {/* Assistive Mode — only rendered when the prop is supplied */}
          {assistive !== undefined && onAssistiveChange && (
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
                  onCheckedChange={(checked) => onAssistiveChange(Boolean(checked))}
                  aria-label="Assistive Mode"
                  className={settingsSwitchClass}
                />
                <Label
                  htmlFor="assistive-mode"
                  className="text-sm font-normal text-muted-foreground whitespace-nowrap cursor-pointer"
                >
                  {assistive ? "On" : "Off"}
                </Label>
              </div>
            </div>
          )}

          {/* Reduce Motion */}
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
                onCheckedChange={(checked) => onMotionReducedChange(Boolean(checked))}
                aria-label="Reduce motion"
                className={settingsSwitchClass}
              />
              <Label
                htmlFor="reduce-motion"
                className="text-sm font-normal text-muted-foreground whitespace-nowrap cursor-pointer"
              >
                {motionReduced ? "On" : "Off"}
              </Label>
            </div>
          </div>

          {/* Density */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-base">Density</Label>
              <p className="text-sm text-muted-foreground">
                Choose a more compact or comfortable layout spacing.
              </p>
            </div>
            <RadioGroup
              value={density}
              onValueChange={(value) => onDensityChange(value as UiDensity)}
              className="grid gap-2 sm:grid-cols-2"
            >
              <Label htmlFor="density-comfortable" className={settingsChoiceClass}>
                <RadioGroupItem value="comfortable" id="density-comfortable" />
                <span className="font-normal">Comfortable</span>
              </Label>
              <Label htmlFor="density-compact" className={settingsChoiceClass}>
                <RadioGroupItem value="compact" id="density-compact" />
                <span className="font-normal">Compact</span>
              </Label>
            </RadioGroup>
          </div>

          {/* Theme */}
          <div className="space-y-3">
            <div className="space-y-1">
              <Label className="text-base">Theme</Label>
              <p className="text-sm text-muted-foreground">
                Match your device or choose light or dark.
              </p>
            </div>
            <RadioGroup
              value={theme}
              onValueChange={(value) => onThemeChange(value as UiTheme)}
              className="grid gap-2 sm:grid-cols-3"
            >
              <Label htmlFor="theme-system" className={settingsChoiceClass}>
                <RadioGroupItem value="system" id="theme-system" />
                <span className="font-normal">System</span>
              </Label>
              <Label htmlFor="theme-light" className={settingsChoiceClass}>
                <RadioGroupItem value="light" id="theme-light" />
                <span className="font-normal">Light</span>
              </Label>
              <Label htmlFor="theme-dark" className={settingsChoiceClass}>
                <RadioGroupItem value="dark" id="theme-dark" />
                <span className="font-normal">Dark</span>
              </Label>
            </RadioGroup>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

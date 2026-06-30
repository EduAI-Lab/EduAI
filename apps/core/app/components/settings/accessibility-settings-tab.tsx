/**
 * Core wrapper around the shared AccessibilitySettings component.
 *
 * All Core-specific behaviour (context providers, /api/preferences fetch) stays
 * here; the shared component is pure props / callbacks with no app coupling.
 */
import { useAssistiveUi } from "~/components/assistive/assistive-ui-provider";
import { useUiPreferences } from "~/components/assistive/ui-preferences-provider";
import { AccessibilitySettings, useTheme } from "@eduai/ui";
import { DEFAULT_UI_PREFERENCES, type UiTheme } from "~/lib/ui-preferences";

export function AccessibilitySettingsTab() {
  const { assistive, setAssistive } = useAssistiveUi();
  const { motionReduced, density, setMotionReduced, setDensity } = useUiPreferences();
  const { theme: nextTheme, setTheme: setNextTheme } = useTheme();

  // Theme is owned by next-themes (shared `theme` localStorage key carries the
  // choice across Core/AI Tutor/Question Maker). We also mirror it to the
  // account so the preference survives across devices.
  const theme = (nextTheme as UiTheme | undefined) ?? DEFAULT_UI_PREFERENCES.theme;

  const handleThemeChange = (value: UiTheme) => {
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
    <AccessibilitySettings
      theme={theme}
      density={density}
      motionReduced={motionReduced}
      assistive={assistive}
      onThemeChange={handleThemeChange}
      onDensityChange={setDensity}
      onMotionReducedChange={setMotionReduced}
      onAssistiveChange={(value) => setAssistive(value)}
      description="Personalize how EduAI looks and feels. These settings sync to your account and are optional for everyone."
    />
  );
}

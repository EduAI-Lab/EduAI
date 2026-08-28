import { useState } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Switch,
} from "@eduai/ui";
import {
  BEDROCK_OVERFLOW_SETTING_DEFINITIONS,
  type BedrockOverflowSettings,
} from "~/lib/ai/routing/bedrock/bedrock-settings";

type BedrockOverflowSettingsCardProps = {
  initialSettings: BedrockOverflowSettings;
  tokenConfigured: boolean;
  onSave: (settings: BedrockOverflowSettings) => Promise<void>;
};

const LIMIT_FIELDS = [
  "dailyUserLimit",
  "monthlyUserLimit",
  "globalLimit",
  "resourceLimit",
] as const;

export function BedrockOverflowSettingsCard({
  initialSettings,
  tokenConfigured,
  onSave,
}: BedrockOverflowSettingsCardProps) {
  const [draft, setDraft] = useState<BedrockOverflowSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await onSave(draft);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save AWS settings");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>AWS Bedrock overflow</CardTitle>
        <CardDescription>
          Paid fallback only. Off by default. Administrators are the only role that can enable it or
          change the caps.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <Alert variant="destructive">
          <AlertTitle>This can incur AWS charges</AlertTitle>
          <AlertDescription>
            Bedrock is used only when local GPUs are saturated. Keep it off unless you intend to
            spend. A cap of 0 blocks that window. Overflow stays blocked while every cap is 0.
          </AlertDescription>
        </Alert>

        {!tokenConfigured ? (
          <Alert>
            <AlertTitle>AWS token is not configured</AlertTitle>
            <AlertDescription>
              Set AWS_BEARER_TOKEN_BEDROCK on this deployment before overflow can fire. Enabling the
              switch alone is not enough.
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <Label htmlFor="bedrock-overflow-enabled" className="text-base">
              {BEDROCK_OVERFLOW_SETTING_DEFINITIONS.enabled.label}
            </Label>
            <p className="text-muted-foreground text-sm">
              {BEDROCK_OVERFLOW_SETTING_DEFINITIONS.enabled.description}
            </p>
          </div>
          <Switch
            id="bedrock-overflow-enabled"
            aria-label="Enable AWS Bedrock overflow"
            checked={draft.enabled}
            onCheckedChange={(value) => setDraft((current) => ({ ...current, enabled: value }))}
          />
        </div>

        {LIMIT_FIELDS.map((field) => (
          <div key={field} className="space-y-2">
            <Label htmlFor={`bedrock-${field}`}>
              {BEDROCK_OVERFLOW_SETTING_DEFINITIONS[field].label}
            </Label>
            <p className="text-muted-foreground text-sm">
              {BEDROCK_OVERFLOW_SETTING_DEFINITIONS[field].description}
            </p>
            <Input
              id={`bedrock-${field}`}
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              value={draft[field]}
              onChange={(event) =>
                setDraft((current) => {
                  const next = Number(event.target.value);
                  return {
                    ...current,
                    [field]: Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0,
                  };
                })
              }
            />
          </div>
        ))}

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="text-muted-foreground text-sm" role="status">
            AWS overflow settings saved.
          </p>
        ) : null}

        <div>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save AWS limits"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

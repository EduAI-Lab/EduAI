import { useState } from "react";

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from "@eduai/ui";
import {
  CHAT_DAILY_LIMIT_DEFINITIONS,
  type ChatDailyLimitSettings,
} from "~/lib/chat-daily-limits";

type ChatDailyLimitSettingsCardProps = {
  initialSettings: ChatDailyLimitSettings;
  onSave: (settings: ChatDailyLimitSettings) => Promise<void>;
};

export function ChatDailyLimitSettingsCard({
  initialSettings,
  onSave,
}: ChatDailyLimitSettingsCardProps) {
  const [draft, setDraft] = useState<ChatDailyLimitSettings>(initialSettings);
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
      setError(
        err instanceof Error ? err.message : "Failed to save daily chat limits",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Local chatbot daily caps</CardTitle>
        <CardDescription>
          Per-user 24-hour limits for the local chatbot. Administrators can
          change these defaults. Cloud providers with a user-supplied key are
          not counted here.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="space-y-2">
          <Label htmlFor="chat-daily-studentLimit">
            {CHAT_DAILY_LIMIT_DEFINITIONS.studentLimit.label}
          </Label>
          <p className="text-muted-foreground text-sm">
            {CHAT_DAILY_LIMIT_DEFINITIONS.studentLimit.description}
          </p>
          <Input
            id="chat-daily-studentLimit"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={draft.studentLimit}
            onChange={(event) => {
              const next = Number(event.target.value);
              setDraft((current) => ({
                ...current,
                studentLimit: Number.isFinite(next) ? Math.max(0, Math.floor(next)) : 0,
              }));
            }}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="chat-daily-instructorLimit">
            {CHAT_DAILY_LIMIT_DEFINITIONS.instructorLimit.label}
          </Label>
          <p className="text-muted-foreground text-sm">
            {CHAT_DAILY_LIMIT_DEFINITIONS.instructorLimit.description}
          </p>
          <Input
            id="chat-daily-instructorLimit"
            type="number"
            min={0}
            step={1}
            inputMode="numeric"
            value={draft.instructorLimit}
            onChange={(event) => {
              const next = Number(event.target.value);
              setDraft((current) => ({
                ...current,
                instructorLimit: Number.isFinite(next)
                  ? Math.max(0, Math.floor(next))
                  : 0,
              }));
            }}
          />
        </div>

        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {error}
          </p>
        ) : null}
        {saved ? (
          <p className="text-muted-foreground text-sm" role="status">
            Daily chat limits saved.
          </p>
        ) : null}

        <div>
          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save daily caps"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

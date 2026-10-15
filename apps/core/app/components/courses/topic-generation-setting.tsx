import { useState } from "react";
import { Button, Label, Switch } from "@eduai/ui";

type TopicGenerationSettingProps = {
  /** Null until the course's status has loaded. */
  enabled: boolean | null;
  /** INSTRUCTOR and above; a TA sees the setting but cannot change it. */
  canChange: boolean;
  onChange: (enabled: boolean) => Promise<void>;
  /** The one-time run over the materials already in the course. */
  onGenerateFromExisting: () => Promise<void>;
};

/**
 * The per-course "Generate topics from course material" switch (#1966).
 *
 * Switching it on only affects future uploads, so the instructor is offered a
 * one-time run over the materials already in the course. It is an offer rather
 * than automatic: a course with many materials gets a batch of suggestions to
 * review, and the instructor may only want new uploads covered.
 */
export function TopicGenerationSetting({
  enabled,
  canChange,
  onChange,
  onGenerateFromExisting,
}: TopicGenerationSettingProps) {
  const [saving, setSaving] = useState(false);
  const [offerExisting, setOfferExisting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleChange = async (next: boolean) => {
    setSaving(true);
    setError(null);
    try {
      await onChange(next);
      setOfferExisting(next);
    } catch {
      setError("Couldn't save this setting. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      await onGenerateFromExisting();
      setOfferExisting(false);
    } catch {
      setError("Couldn't start topic generation. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="topic-generation">Generate topics from course material</Label>
          <p className="text-xs text-muted-foreground">
            When on, EduAI suggests topics from new uploads for you to review. When off, the course
            only has the topics you add.
          </p>
        </div>
        <Switch
          id="topic-generation"
          checked={enabled ?? false}
          disabled={!canChange || enabled === null || saving}
          onCheckedChange={(next) => void handleChange(next)}
          aria-label="Generate topics from course material"
        />
      </div>
      {offerExisting && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="flex-1">
            Also suggest topics from the materials already in this course?
          </span>
          <Button size="sm" onClick={() => void handleGenerate()} disabled={generating}>
            {generating ? "Starting…" : "Generate now"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setOfferExisting(false)}
            disabled={generating}
          >
            Not now
          </Button>
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

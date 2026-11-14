import { useState } from "react";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@eduai/ui";
import { Label } from "@eduai/ui";
import { Textarea } from "@eduai/ui";

interface CourseDescriptionSettingsProps {
  courseId: string;
  initialDescription: string;
  onSaved?: () => void;
}

export function CourseDescriptionSettings({
  courseId,
  initialDescription,
  onSaved,
}: CourseDescriptionSettingsProps) {
  const [value, setValue] = useState(initialDescription);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);

  const save = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch(`/api/courses/${courseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: value.trim() || null }),
      });
      if (res.ok) {
        // Show what was stored, not the untrimmed text the user typed.
        setValue(value.trim());
        setSaveMsg("Saved.");
        onSaved?.();
      } else {
        const err = await res.json().catch(() => ({}));
        setSaveMsg(err?.error ?? "Could not save the description.");
      }
    } catch {
      setSaveMsg("Network error.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card id="course-description">
      <CardHeader>
        <CardTitle>Course description</CardTitle>
        <CardDescription>Shown to students on the course page</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-2 max-w-xl">
          <Label htmlFor="course-description-input">Description</Label>
          <Textarea
            id="course-description-input"
            rows={4}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaveMsg(null);
            }}
          />
        </div>
        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save description"}
          </Button>
          <span role="status" className="text-sm text-muted-foreground">
            {saveMsg}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { GraduationCap, Loader2 } from "lucide-react";

import { linkCanvasRoster } from "~/lib/canvas/client";
import { Button } from "@eduai/ui";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@eduai/ui";
import { Input } from "@eduai/ui";
import { Label } from "@eduai/ui";

type StudentNumberSettingsProps = {
  initialStudentNumber: string | null;
};

export function StudentNumberSettings({
  initialStudentNumber,
}: StudentNumberSettingsProps) {
  const [studentNumber, setStudentNumber] = useState(initialStudentNumber ?? "");
  const [savedStudentNumber, setSavedStudentNumber] = useState(initialStudentNumber ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const trimmed = studentNumber.trim();
  const unchanged = trimmed === savedStudentNumber.trim();

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      const result = await linkCanvasRoster(trimmed);
      setSavedStudentNumber(result.studentId);
      setStudentNumber(result.studentId);
      setSuccess(
        result.enrollmentsLinked > 0
          ? `Student number saved. ${result.enrollmentsLinked} course enrollment(s) linked.`
          : "Student number saved. Course enrollments will appear after your instructor syncs Canvas.",
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save student number");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5" />
          Student number
        </CardTitle>
        <CardDescription>
          Link your UBC student number so we can match you to courses when your
          instructor syncs Canvas.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {success && (
          <p className="text-sm text-green-600 dark:text-green-500" role="status">
            {success}
          </p>
        )}

        <div className="space-y-2">
          <Label htmlFor="settings-studentNumber">Student number</Label>
          <Input
            id="settings-studentNumber"
            value={studentNumber}
            onChange={(e) => setStudentNumber(e.target.value)}
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 12345678"
            disabled={saving}
          />
          <p className="text-xs text-muted-foreground">
            Must match your student ID in Canvas. You can link before your instructor
            syncs; enrollments appear after they sync the course.
          </p>
        </div>

        <Button
          onClick={() => void handleSave()}
          disabled={saving || !trimmed || unchanged}
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Saving…
            </>
          ) : (
            "Save student number"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { Spinner } from "@eduai/ui";
import { IconLock, IconSchool } from "@tabler/icons-react";

import { linkCanvasRoster } from "~/lib/canvas/client";
import {
  isValidUbcStudentNumber,
  UBC_STUDENT_NUMBER_MESSAGE,
} from "~/lib/canvas/student-number";
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
  const formatValid = isValidUbcStudentNumber(trimmed);
  const unchanged = trimmed === savedStudentNumber.trim();
  // Once a student number is linked it cannot be self-edited (the backend
  // rejects reassignment with a 409). Show a locked, read-only view instead of
  // an editable field so the change is impossible up front rather than silently
  // reverting on refresh.
  const isLocked = savedStudentNumber.trim().length > 0;

  const handleSave = async () => {
    if (!formatValid) {
      setError(UBC_STUDENT_NUMBER_MESSAGE);
      return;
    }

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
    } catch {
      setError("Could not save your student number. Please check it and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconSchool className="h-5 w-5" />
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

        {isLocked ? (
          <div className="space-y-2">
            <Label htmlFor="settings-studentNumber">Student number</Label>
            <Input
              id="settings-studentNumber"
              value={savedStudentNumber}
              type="text"
              readOnly
              disabled
              aria-readonly="true"
            />
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <IconLock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Your student number is linked and can only be changed by an
                administrator. Contact your instructor or an admin if this is
                incorrect.
              </span>
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="settings-studentNumber">Student number</Label>
              <Input
                id="settings-studentNumber"
                value={studentNumber}
                onChange={(e) => {
                  setStudentNumber(e.target.value);
                  if (error === UBC_STUDENT_NUMBER_MESSAGE) setError(null);
                }}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                placeholder="e.g. 12345678"
                minLength={8}
                maxLength={8}
                pattern="\d{8}"
                title={UBC_STUDENT_NUMBER_MESSAGE}
                disabled={saving}
              />
              <p className="text-xs text-muted-foreground">
                Must be exactly 8 digits and match your student ID in Canvas. You
                can link before your instructor syncs; enrollments appear after
                they sync the course. Once saved, only an administrator can
                change it.
              </p>
            </div>

            <Button
              onClick={() => void handleSave()}
              disabled={saving || !trimmed || !formatValid || unchanged}
            >
              {saving ? (
                <>
                  <Spinner className="mr-2" />
                  Saving…
                </>
              ) : (
                "Save student number"
              )}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}


import { useState } from "react";
import { IconLoader, IconLock } from "@tabler/icons-react";

import { authClient } from "~/lib/auth/client";
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

export function ChangePasswordSettings() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mismatch = confirm.length > 0 && next !== confirm;
  const canSubmit = current.trim() && next.trim() && next === confirm && !saving;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const res = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: false,
      });
      if (res.error) {
        setError("Could not change your password. Check your current password and try again.");
        return;
      }
      setSuccess(true);
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch {
      setError("Could not change your password. Check your current password and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <IconLock className="h-5 w-5" />
          Change password
        </CardTitle>
        <CardDescription>
          Must be at least 8 characters with upper and lower case letters, numbers,
          and symbols — or a passphrase of at least 16 characters. Passwords expire
          annually and cannot be reused.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          {success && (
            <p className="text-sm text-green-600 dark:text-green-500" role="status">
              Password changed successfully.
            </p>
          )}

          <div className="space-y-2">
            <Label htmlFor="cp-current">Current password</Label>
            <Input
              id="cp-current"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cp-new">New password</Label>
            <Input
              id="cp-new"
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
              disabled={saving}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cp-confirm">Confirm new password</Label>
            <Input
              id="cp-confirm"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              disabled={saving}
              aria-invalid={mismatch}
            />
            {mismatch && (
              <p className="text-xs text-destructive">Passwords don't match</p>
            )}
          </div>

          <Button type="submit" disabled={!canSubmit}>
            {saving ? (
              <>
                <IconLoader className="h-4 w-4 mr-2 animate-spin" />
                Saving…
              </>
            ) : (
              "Change password"
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

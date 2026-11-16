/**
 * @file The report panel's "Reply to reporter" section: the admin's one status
 * note on a report ("working on it", later "fixed"). Saving replaces the last
 * note and emails it to the reporter from the server's address. It is not a
 * conversation: there is one note, and the reporter can't answer it.
 */

import { useState } from "react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { formatDateTime } from "./bug-reports-utils";
import type { AdminBugReportRow, ReporterNoteDelivery, ReporterNoteInput } from "./types";

export const DEFAULT_REPORTER_NOTE_SUBJECT = "Update on your EduAI bug report";

/** Matches the server's column limits. */
const SUBJECT_MAX = 200;
const BODY_MAX = 5000;

const DELIVERY_MESSAGES = {
  sent: "Saved and emailed to the reporter.",
  "no-recipient": "Saved. The reporter can't be emailed.",
  "not-sent": "Saved, but the email couldn't be sent. Check Admin → Logs.",
} satisfies Record<ReporterNoteDelivery, string>;

export type SaveReporterNote = (
  reportId: string,
  note: ReporterNoteInput,
) => Promise<{ delivery: ReporterNoteDelivery }>;

/** Render with `key={report.id}` so switching reports starts from that report's note. */
export function ReporterNoteSection({
  report,
  onSave,
}: {
  report: AdminBugReportRow;
  onSave: SaveReporterNote;
}) {
  const [subject, setSubject] = useState(
    report.reporterNoteSubject ?? DEFAULT_REPORTER_NOTE_SUBJECT,
  );
  const [body, setBody] = useState(report.reporterNote ?? "");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const reachable = report.reporterReachable !== false;
  const trimmedSubject = subject.trim();
  const trimmedBody = body.trim();
  const unchanged =
    trimmedSubject === (report.reporterNoteSubject ?? "") &&
    trimmedBody === (report.reporterNote ?? "");
  // The same note again only makes sense when it never reached the reporter.
  const canSave =
    trimmedSubject.length > 0 &&
    trimmedBody.length > 0 &&
    !saving &&
    !(unchanged && (report.reporterNoteEmailedAt || !reachable));

  async function save() {
    setSaving(true);
    setFeedback(null);
    try {
      const { delivery } = await onSave(report.id, { subject: trimmedSubject, body: trimmedBody });
      setFeedback({
        tone: delivery === "not-sent" ? "error" : "ok",
        text: DELIVERY_MESSAGES[delivery],
      });
    } catch {
      setFeedback({ tone: "error", text: "Could not save the note. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby={`reporter-note-${report.id}`} className="flex flex-col gap-3">
      <div>
        <h3 id={`reporter-note-${report.id}`} className="text-sm font-semibold">
          Reply to reporter
        </h3>
        <p className="text-xs text-muted-foreground">
          One status note per report. Saving replaces the last note and emails it to the reporter;
          they can't reply.
        </p>
      </div>

      {report.reporterNoteUpdatedAt && (
        <p className="text-xs text-muted-foreground">
          Last updated {formatDateTime(report.reporterNoteUpdatedAt)} ·{" "}
          {report.reporterNoteEmailedAt ? "emailed" : "not emailed"}
        </p>
      )}

      {!reachable && (
        <p className="rounded-md border border-border/70 bg-background/60 px-3 py-2 text-xs text-muted-foreground">
          This reporter can't be emailed: their account was deleted or has no address. The note is
          still saved with the report.
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`reporter-note-subject-${report.id}`}>Subject</Label>
        <Input
          id={`reporter-note-subject-${report.id}`}
          value={subject}
          maxLength={SUBJECT_MAX}
          onChange={(event) => {
            setSubject(event.target.value);
            setFeedback(null);
          }}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`reporter-note-body-${report.id}`}>Message</Label>
        <Textarea
          id={`reporter-note-body-${report.id}`}
          value={body}
          maxLength={BODY_MAX}
          rows={5}
          placeholder="e.g. Thanks for reporting this. We're working on a fix."
          onChange={(event) => {
            setBody(event.target.value);
            setFeedback(null);
          }}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" onClick={save} disabled={!canSave}>
          {saving ? "Saving…" : reachable ? "Save and email" : "Save"}
        </Button>
        {feedback && (
          <p
            role="status"
            className={
              feedback.tone === "error"
                ? "text-xs text-destructive"
                : "text-xs text-muted-foreground"
            }
          >
            {feedback.text}
          </p>
        )}
      </div>
    </section>
  );
}

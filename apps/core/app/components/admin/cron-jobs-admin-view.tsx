import { useCallback, useEffect, useRef, useState } from "react";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  PageHeading,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@eduai/ui";
import type { CronJobEntry, CronJobRunRow, CronJobStatusValue } from "~/lib/db.cron-jobs.server";

// ── Status badge ─────────────────────────────────────────────────────────────

function CronStatusBadge({ status, external, message }: { status: CronJobStatusValue | null; external?: boolean; message?: string | null }) {
  if (external) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
        style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
        <span className="w-[5px] h-[5px] rounded-full shrink-0"
          style={{ background: "var(--muted-foreground)" }} />
        External
      </span>
    );
  }
  if (!status) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
        style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
        <span className="w-[5px] h-[5px] rounded-full shrink-0"
          style={{ background: "var(--muted-foreground)" }} />
        Never run
      </span>
    );
  }
  if (status === "RUNNING") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
        style={{ background: "var(--color-warning-100)", color: "var(--color-warning-700)" }}>
        <span className="w-[5px] h-[5px] rounded-full flex-shrink-0 animate-pulse"
          style={{ background: "var(--color-warning-500)" }} />
        Running
      </span>
    );
  }
  if (status === "SUCCESS") {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
        style={{ background: "var(--color-success-100)", color: "var(--color-success-700)" }}>
        <span className="w-[5px] h-[5px] rounded-full flex-shrink-0"
          style={{ background: "var(--color-success-500)" }} />
        Success
      </span>
    );
  }

  const badge = (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: "var(--color-error-100)", color: "var(--destructive)" }}>
      <span className="w-[5px] h-[5px] rounded-full flex-shrink-0"
        style={{ background: "var(--destructive)" }} />
      Error
    </span>
  );

  if (!message) return badge;

  const preview = message.length > 300 ? message.slice(0, 300) + "…" : message;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent className="max-w-xs whitespace-pre-wrap font-mono text-[11px]">
        {preview}
      </TooltipContent>
    </Tooltip>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(startedAt: string, finishedAt: string | null) {
  if (!finishedAt) return "—";
  const ms = new Date(finishedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

// ── Run history dialog ────────────────────────────────────────────────────────

interface RunHistoryDialogProps {
  jobName: string;
  open: boolean;
  onClose: () => void;
}

function RunHistoryDialog({ jobName, open, onClose }: RunHistoryDialogProps) {
  const [runs, setRuns] = useState<CronJobRunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedMessage, setExpandedMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !jobName) return;
    setLoading(true);
    fetch(`/api/admin/cron-jobs?job=${encodeURIComponent(jobName)}`)
      .then((r) => r.json())
      .then((body: { runs: CronJobRunRow[] }) => setRuns(body.runs))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, [open, jobName]);

  return (
    <>
      <Dialog open={open} onOpenChange={(v: boolean) => { if (!v) onClose(); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Run history — {jobName}</DialogTitle>
          </DialogHeader>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-foreground" />
            </div>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No runs recorded yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Started</TableHead>
                  <TableHead>Triggered by</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className="text-sm">{formatDateTime(run.startedAt)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {run.triggerSource === "ADMIN_UI" ? "Admin panel" :
                        run.triggerSource === "ADMIN_CHAT" ? "Admin chatbot" :
                          run.triggerSource === "SCHEDULE" ? "Schedule" : "Unknown"}
                      {run.triggeredByUserId && (
                        <div className="font-mono text-[10px]">{run.triggeredByUserId}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDuration(run.startedAt, run.finishedAt)}
                    </TableCell>
                    <TableCell>
                      <CronStatusBadge status={run.status} message={run.message} />
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-xs">
                      {run.message ? (
                        <button
                          onClick={() => setExpandedMessage(run.message)}
                          className="text-left truncate max-w-xs block hover:underline underline-offset-2 cursor-pointer"
                          title="Click to view full output"
                        >
                          {run.message}
                        </button>
                      ) : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={expandedMessage !== null} onOpenChange={(v) => { if (!v) setExpandedMessage(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Run output — {jobName}</DialogTitle>
          </DialogHeader>
          <pre className="text-xs font-mono whitespace-pre-wrap overflow-y-auto max-h-[60vh] rounded-md p-4"
            style={{ background: "var(--muted)", color: "var(--muted-foreground)" }}>
            {expandedMessage}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Cron expression helpers ───────────────────────────────────────────────────

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function deriveCronLabel(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, month, dow] = parts;
  const allStar = (v: string) => v === "*";

  if (allStar(dom) && allStar(month) && allStar(dow)) {
    if (allStar(min) && allStar(hour)) return "Every minute";
    if (allStar(min)) return `Every hour`;
    if (allStar(hour)) return `Every day at minute ${min}`;
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    if (!isNaN(h) && !isNaN(m)) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      return `Daily at ${hh}:${mm} UTC`;
    }
  }

  if (allStar(dom) && allStar(month) && !allStar(dow)) {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    const d = parseInt(dow, 10);
    if (!isNaN(h) && !isNaN(m) && !isNaN(d) && d >= 0 && d <= 6) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      return `Weekly on ${DAYS[d]} at ${hh}:${mm} UTC`;
    }
  }

  if (!allStar(dom) && allStar(month) && allStar(dow)) {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    const d = parseInt(dom, 10);
    if (!isNaN(h) && !isNaN(m) && !isNaN(d)) {
      const hh = String(h).padStart(2, "0");
      const mm = String(m).padStart(2, "0");
      return `Monthly on day ${d} at ${hh}:${mm} UTC`;
    }
  }

  return expr;
}

const CRON_RE = /^[\d,\-*/]+ [\d,\-*/]+ [\d,\-*/]+ [\d,\-*/]+ [\d,\-*/]+$/;

// ── Edit schedule dialog ──────────────────────────────────────────────────────

interface EditScheduleDialogProps {
  job: CronJobEntry | null;
  open: boolean;
  onClose: () => void;
  onSaved: (jobs: CronJobEntry[]) => void;
  triggerEnabled: boolean;
}

function EditScheduleDialog({ job, open, onClose, onSaved, triggerEnabled }: EditScheduleDialogProps) {
  const [expr, setExpr] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (job) {
      setExpr(job.schedule);
      setLabel(job.scheduleLabel);
      setError(null);
    }
  }, [job]);

  useEffect(() => {
    if (CRON_RE.test(expr.trim())) {
      setLabel(deriveCronLabel(expr.trim()));
    }
  }, [expr]);

  async function save() {
    if (!job) return;
    if (!CRON_RE.test(expr.trim())) {
      setError("Invalid cron expression. Expected 5 space-separated fields.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/cron-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "update-schedule", jobName: job.name, schedule: expr.trim(), scheduleLabel: label.trim() || deriveCronLabel(expr.trim()) }),
      });
      const body = await res.json() as { jobs?: CronJobEntry[]; error?: string };
      if (!res.ok || body.error) {
        setError(body.error ?? "Failed to save");
        return;
      }
      if (body.jobs) onSaved(body.jobs);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  async function reset() {
    if (!job) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/cron-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "reset-schedule", jobName: job.name }),
      });
      const body = await res.json() as { jobs?: CronJobEntry[]; error?: string };
      if (!res.ok || body.error) {
        setError(body.error ?? "Failed to reset");
        return;
      }
      if (body.jobs) onSaved(body.jobs);
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v: boolean) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit schedule — {job?.name}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 py-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cron-expr">Cron expression</Label>
            <Input
              id="cron-expr"
              className="font-mono"
              placeholder="0 2 * * *"
              value={expr}
              onChange={(e) => { setExpr(e.target.value); setError(null); }}
            />
            <p className="text-xs text-muted-foreground">
              Format: <span className="font-mono">minute hour day-of-month month day-of-week</span>
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cron-label">Human-readable label</Label>
            <Input
              id="cron-label"
              placeholder="Daily at 02:00 UTC"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Auto-filled from common patterns. Edit freely.</p>
          </div>
          {!triggerEnabled && (
            <p className="text-xs text-muted-foreground rounded-md border px-3 py-2" style={{ borderColor: "var(--border)" }}>
              This job is managed by an extension server. The saved schedule is informational — the extension server must be reconfigured separately to change when it runs.
            </p>
          )}
          {error && (
            <p className="text-sm" style={{ color: "var(--destructive)" }}>{error}</p>
          )}
        </div>
        <DialogFooter className="flex items-center gap-2">
          {job?.scheduleOverridden && (
            <Button variant="ghost" size="sm" onClick={reset} disabled={saving} className="mr-auto">
              Reset to default
            </Button>
          )}
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────

export interface CronJobsAdminViewProps {
  jobs: CronJobEntry[];
}

export function CronJobsAdminView({ jobs: initialJobs }: CronJobsAdminViewProps) {
  const [jobs, setJobs] = useState<CronJobEntry[]>(initialJobs);
  const [triggering, setTriggering] = useState<Set<string>>(new Set());
  const [historyJob, setHistoryJob] = useState<string | null>(null);
  const [editScheduleJob, setEditScheduleJob] = useState<CronJobEntry | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isDocumentVisible, setIsDocumentVisible] = useState(
    () => typeof document === "undefined" || document.visibilityState === "visible",
  );

  const hasRunning = jobs.some((j) => j.lastRun?.status === "RUNNING");

  const fetchStatuses = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/cron-jobs");
      if (!res.ok) return;
      const body = (await res.json()) as { jobs: CronJobEntry[] };
      setJobs(body.jobs);
    } catch {
      // network blip — ignore
    }
  }, []);

  useEffect(() => {
    const onVisibilityChange = () => setIsDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  // Poll every 3 s while any job is RUNNING, stop otherwise.
  useEffect(() => {
    if (hasRunning && isDocumentVisible) {
      pollRef.current = setInterval(fetchStatuses, 3000);
    } else {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [hasRunning, isDocumentVisible, fetchStatuses]);

  async function triggerJob(jobName: string) {
    setTriggering((prev) => new Set(prev).add(jobName));
    try {
      const res = await fetch("/api/admin/cron-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intent: "trigger", jobName }),
      });
      if (res.ok) {
        await fetchStatuses();
      }
    } finally {
      setTriggering((prev) => {
        const next = new Set(prev);
        next.delete(jobName);
        return next;
      });
    }
  }

  const runningCount = jobs.filter((j) => j.lastRun?.status === "RUNNING").length;
  const errorCount = jobs.filter((j) => j.lastRun?.status === "ERROR").length;
  const successCount = jobs.filter((j) => j.lastRun?.status === "SUCCESS").length;

  return (
    <div className="flex flex-1 flex-col gap-6 p-6">
      <PageHeading
        heading="Cron Jobs"
        subheading="Registered server cron jobs and their current status"
      />

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total jobs</CardDescription>
            <CardTitle className="text-2xl">{jobs.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Last run success</CardDescription>
            <CardTitle className="text-2xl">{successCount}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              {runningCount > 0 ? "Currently running" : "Errors"}
            </CardDescription>
            <CardTitle className="text-2xl">
              {runningCount > 0 ? (
                <span className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full animate-pulse"
                    style={{ background: "var(--color-warning-500)" }} />
                  {runningCount}
                </span>
              ) : errorCount > 0 ? (
                <span style={{ color: "var(--destructive)" }}>{errorCount}</span>
              ) : (
                0
              )}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Registered jobs</CardTitle>
          <CardDescription>
            All registered cron jobs (infra shell scripts and extension-managed in-process jobs)
            {hasRunning && (
              <span className="ml-2 text-xs" style={{ color: "var(--color-warning-700)" }}>
                · auto-refreshing
              </span>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Job</TableHead>
                <TableHead>Schedule</TableHead>
                <TableHead>Script</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => {
                const isRunning = job.lastRun?.status === "RUNNING";
                const isTriggeringThis = triggering.has(job.name);
                return (
                  <TableRow key={job.name}>
                    <TableCell>
                      <div className="font-medium text-sm">{job.name}</div>
                      <div className="text-xs text-muted-foreground">{job.description}</div>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="font-mono text-xs">
                          {job.schedule}
                        </Badge>
                        {job.scheduleOverridden && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                            style={{ background: "var(--color-warning-100)", color: "var(--color-warning-700)" }}>
                            custom
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-muted-foreground">{job.scheduleLabel}</span>
                        {job.triggerEnabled !== false && (
                          <button
                            onClick={() => setEditScheduleJob(job)}
                            className="text-[11px] text-primary-text underline-offset-2 hover:underline cursor-pointer"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {job.script}
                    </TableCell>
                    <TableCell className="text-sm">
                      {formatDateTime(job.lastRun?.startedAt ?? null)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {job.lastRun
                        ? isRunning
                          ? "running…"
                          : formatDuration(job.lastRun.startedAt, job.lastRun.finishedAt)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <CronStatusBadge status={job.lastRun?.status ?? null} external={job.triggerEnabled === false} message={job.lastRun?.message} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setHistoryJob(job.name)}
                          className="text-xs text-primary-text underline-offset-2 hover:underline cursor-pointer"
                        >
                          History
                        </button>
                        {job.triggerEnabled !== false && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isRunning || isTriggeringThis}
                            onClick={() => triggerJob(job.name)}
                          >
                            {isRunning || isTriggeringThis ? "Running…" : "Run now"}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <RunHistoryDialog
        jobName={historyJob ?? ""}
        open={historyJob !== null}
        onClose={() => setHistoryJob(null)}
      />

      <EditScheduleDialog
        job={editScheduleJob}
        open={editScheduleJob !== null}
        onClose={() => setEditScheduleJob(null)}
        onSaved={(updated) => { setJobs(updated); setEditScheduleJob(null); }}
        triggerEnabled={editScheduleJob?.triggerEnabled !== false}
      />
    </div>
  );
}

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
  DialogHeader,
  DialogTitle,
  PageHeading,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@eduai/ui";
import type { CronJobEntry, CronJobRunRow, CronJobStatusValue } from "~/lib/db.cron-jobs.server";

// ── Status badge ─────────────────────────────────────────────────────────────

function CronStatusBadge({ status, external }: { status: CronJobStatusValue | null; external?: boolean }) {
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
        style={{ background: "var(--color-warning-100, oklch(0.96 0.05 85))", color: "var(--color-warning-700, oklch(0.55 0.12 85))" }}>
        <span className="w-[5px] h-[5px] rounded-full flex-shrink-0 animate-pulse"
          style={{ background: "var(--color-warning-500, oklch(0.75 0.15 85))" }} />
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
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-full"
      style={{ background: "var(--color-error-100)", color: "var(--destructive)" }}>
      <span className="w-[5px] h-[5px] rounded-full flex-shrink-0"
        style={{ background: "var(--destructive)" }} />
      Error
    </span>
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
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Message</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id}>
                  <TableCell className="text-sm">{formatDateTime(run.startedAt)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDuration(run.startedAt, run.finishedAt)}
                  </TableCell>
                  <TableCell>
                    <CronStatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                    {run.message ?? "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Poll every 3 s while any job is RUNNING, stop otherwise.
  useEffect(() => {
    if (hasRunning) {
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
  }, [hasRunning, fetchStatuses]);

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
                    style={{ background: "var(--color-warning-500, oklch(0.75 0.15 85))" }} />
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
              <span className="ml-2 text-xs" style={{ color: "var(--color-warning-700, oklch(0.55 0.12 85))" }}>
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
                      <Badge variant="outline" className="font-mono text-xs">
                        {job.schedule}
                      </Badge>
                      <div className="text-xs text-muted-foreground mt-1">{job.scheduleLabel}</div>
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
                      <CronStatusBadge status={job.lastRun?.status ?? null} external={job.triggerEnabled === false} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setHistoryJob(job.name)}
                          className="text-xs text-primary-text underline-offset-2 hover:underline"
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
    </div>
  );
}

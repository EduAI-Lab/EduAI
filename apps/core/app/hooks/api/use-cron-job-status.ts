import { useEffect, useSyncExternalStore } from "react"
import { apiFetch } from "~/hooks/api/config"
import type { CronJobEntry } from "~/lib/db.cron-jobs.server"

export type CronStatusColor = "green" | "orange" | "red"

type Snapshot = { jobs: CronJobEntry[]; color: CronStatusColor | null }
const empty: Snapshot = { jobs: [], color: null }
let snapshot = empty
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<void> | null = null
let nextDelayMs = 30_000
const listeners = new Set<() => void>()

function colorFor(jobs: CronJobEntry[]): CronStatusColor | null {
  let anyRun = false
  let running = false
  let error = false
  for (const job of jobs) {
    if (!job.lastRun) continue
    anyRun = true
    running ||= job.lastRun.status === "RUNNING"
    error ||= job.lastRun.status === "ERROR"
  }
  if (!anyRun) return null
  return error ? "red" : running ? "orange" : "green"
}

function publish(jobs: CronJobEntry[]) {
  snapshot = { jobs, color: colorFor(jobs) }
  listeners.forEach((listener) => listener())
}

function clearTimer() {
  if (timer) clearTimeout(timer)
  timer = null
}

function schedule() {
  clearTimer()
  if (listeners.size && document.visibilityState === "visible") {
    timer = setTimeout(() => void refresh(), nextDelayMs)
  }
}

async function refresh() {
  if (!listeners.size || document.visibilityState !== "visible" || inFlight) return inFlight ?? undefined
  inFlight = apiFetch<{ jobs: CronJobEntry[] }>("/api/admin/cron-jobs")
    .then((result) => {
      publish(result.jobs)
      nextDelayMs = snapshot.color === "orange" ? 15_000 : 30_000
    })
    .catch(() => {
      nextDelayMs = 60_000
    })
    .finally(() => {
      inFlight = null
      schedule()
    })
  return inFlight
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) {
    document.addEventListener("visibilitychange", onVisibilityChange)
    void refresh()
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      clearTimer()
      document.removeEventListener("visibilitychange", onVisibilityChange)
      snapshot = empty
    }
  }
}

function onVisibilityChange() {
  clearTimer()
  if (document.visibilityState === "visible") void refresh()
}

export function useCronJobStatuses(enabled: boolean, initialJobs?: CronJobEntry[]) {
  useEffect(() => {
    if (initialJobs?.length && !snapshot.jobs.length) publish(initialJobs)
  }, [initialJobs])
  const value = useSyncExternalStore(
    enabled ? subscribe : () => () => undefined,
    () => snapshot,
    () => snapshot,
  )
  return {
    jobs: enabled ? value.jobs : initialJobs ?? [],
    color: enabled ? value.color : null,
    refresh,
    setJobs: enabled ? publish : () => undefined,
  }
}

export function useCronJobStatus(enabled: boolean): CronStatusColor | null {
  return useCronJobStatuses(enabled).color
}

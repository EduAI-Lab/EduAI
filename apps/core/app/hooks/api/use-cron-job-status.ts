import { useEffect, useRef, useState } from "react"
import { apiFetch } from "~/hooks/api/config"
import type { CronJobEntry } from "~/lib/db.cron-jobs.server"

export type CronStatusColor = "green" | "orange" | "red"

function computeColor(jobs: CronJobEntry[]): CronStatusColor | null {
  let anyRun = false
  let anyRunning = false
  let anyError = false
  for (const job of jobs) {
    if (job.lastRun) {
      anyRun = true
      if (job.lastRun.status === "ERROR") anyError = true
      if (job.lastRun.status === "RUNNING") anyRunning = true
    }
  }
  if (!anyRun) return null
  if (anyError) return "red"
  if (anyRunning) return "orange"
  return "green"
}

/**
 * Polls /api/admin/cron-jobs to derive an aggregate status color for the
 * sidebar badge. Only active when `enabled` is true (i.e. the user is ADMIN).
 * Polls every 5 s while a job is RUNNING, 30 s otherwise.
 */
export function useCronJobStatus(enabled: boolean): CronStatusColor | null {
  const [color, setColor] = useState<CronStatusColor | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (!enabled) return

    cancelledRef.current = false

    async function poll() {
      if (cancelledRef.current) return
      let nextDelay = 30_000
      try {
        const resp = await apiFetch<{ jobs: CronJobEntry[] }>("/api/admin/cron-jobs")
        if (!cancelledRef.current) {
          const c = computeColor(resp.jobs)
          setColor(c)
          nextDelay = c === "orange" ? 5_000 : 30_000
        }
      } catch {
        nextDelay = 60_000
      }
      if (!cancelledRef.current) {
        timerRef.current = setTimeout(() => void poll(), nextDelay)
      }
    }

    void poll()

    return () => {
      cancelledRef.current = true
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [enabled])

  return enabled ? color : null
}

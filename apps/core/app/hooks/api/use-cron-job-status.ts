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

/** Polls the sidebar badge only while visible; the cron admin page owns refreshes when open. */
export function useCronJobStatus(enabled: boolean): CronStatusColor | null {
  const [color, setColor] = useState<CronStatusColor | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    if (!enabled) return
    cancelledRef.current = false

    function clearTimer() {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = null
    }

    function scheduleNext(delay: number) {
      clearTimer()
      if (!cancelledRef.current && document.visibilityState === "visible") {
        timerRef.current = setTimeout(() => void poll(), delay)
      }
    }

    async function poll() {
      if (cancelledRef.current || document.visibilityState !== "visible") return
      let nextDelay = 30_000
      try {
        const resp = await apiFetch<{ jobs: CronJobEntry[] }>("/api/admin/cron-jobs")
        if (!cancelledRef.current) {
          const nextColor = computeColor(resp.jobs)
          setColor(nextColor)
          nextDelay = nextColor === "orange" ? 15_000 : 30_000
        }
      } catch {
        nextDelay = 60_000
      }
      scheduleNext(nextDelay)
    }

    function onVisibilityChange() {
      clearTimer()
      if (document.visibilityState === "visible") void poll()
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    if (document.visibilityState === "visible") void poll()
    return () => {
      cancelledRef.current = true
      clearTimer()
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [enabled])

  return enabled ? color : null
}

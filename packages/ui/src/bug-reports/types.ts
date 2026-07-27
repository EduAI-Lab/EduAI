/**
 * Bug-report row shape, shared by all three admin surfaces.
 *
 * All three apps read the same `bug_reports` table through the same Core
 * endpoint — the Question Maker and AI Tutor backends are pure HTTP proxies to
 * it and differ only by a `source` query param — so there is exactly one
 * payload shape here rather than the three near-identical declarations
 * (`AdminBugReportRow` / `BugReport` / `BugReportRow`) that existed before.
 */

export type BugReportStatus = "unhandled" | "in progress" | "resolved"

/**
 * Re-exported from the capture-side dialog, which already declares this exact
 * union — the triage view and the report form must agree on the categories.
 */
export type { BugReportType } from "../bug-report-dialog"
import type { BugReportType } from "../bug-report-dialog"

/** Free-form per-app context blob (`context` is a `Json?` column). */
export type BugReportContext = Record<string, unknown> & {
  courseOfferingId?: number | null
  moduleId?: number | null
  lessonId?: number | null
  activityId?: number | null
}

export type AdminBugReportRow = {
  id: string
  description: string
  bugType?: BugReportType | null
  status: BugReportStatus
  /** Present in the API payload; Core's admin view previously dropped these. */
  consoleLogs?: string | null
  networkLogs?: string | null
  screenshot?: string | null
  /**
   * List rows omit the diagnostic blobs (#979) and carry only these flags —
   * the bodies arrive from `GET /api/admin/bug-reports/:id` on demand. Read
   * them through `hasAttachmentContent` so a row that *does* carry a body
   * (Core's detail payload, older list responses) still enables the viewer.
   */
  hasConsoleLogs?: boolean
  hasNetworkLogs?: boolean
  hasScreenshot?: boolean
  pageUrl?: string | null
  userAgent?: string | null
  isAnonymous: boolean
  userId: string
  reporterName?: string | null
  reporterEmail?: string | null
  reporterRole?: string | null
  user?: {
    id: string
    name: string | null
    email: string | null
    role: string | null
  } | null
  userName?: string | null
  userEmail?: string | null
  role?: string | null
  /** Which app the report came from. Only the platform-wide view shows it. */
  source?: string | null
  createdAt: string
  updatedAt?: string
  courseOfferingId?: number | null
  moduleId?: number | null
  lessonId?: number | null
  activityId?: number | null
  context?: BugReportContext | null
  courseTitle?: string | null
  moduleTitle?: string | null
  lessonTitle?: string | null
  activityTitle?: string | null
}

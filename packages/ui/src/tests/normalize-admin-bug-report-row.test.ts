/**
 * `normalizeAdminBugReportRow` is the single mapping from Core's admin payload
 * to the row shape the shared triage view reads. Both the Core client and the
 * Question Maker client go through it, so the guarantees asserted here are what
 * stops the two from drifting again: reporter identity is renamed off Core's
 * `userName`/`userEmail`, the `context` JSON blob is flattened onto the row, and
 * the status enum is lower-cased.
 */
import { describe, expect, it } from "vitest"

import {
  buildBugReportCopyText,
  getContextLabel,
  getReporterLabel,
  normalizeAdminBugReportRow,
} from "../bug-reports/bug-reports-utils"

/** A list-shaped payload: blobs omitted, `has*` flags present (#979). */
function corePayload(over: Record<string, unknown> = {}) {
  return {
    id: "br-1",
    source: "QUESTION_MAKER",
    status: "IN_PROGRESS",
    description: "Export button does nothing",
    bugType: "FEATURE_NOT_WORKING",
    isAnonymous: false,
    userId: "user-42",
    userName: "Alex Patel",
    userEmail: "alex@eduai.test",
    pageUrl: "https://qm.eduai.test/courses/7/assessments?tab=export",
    userAgent: "Mozilla/5.0",
    consoleLogs: null,
    networkLogs: null,
    screenshot: null,
    hasConsoleLogs: true,
    hasNetworkLogs: false,
    hasScreenshot: true,
    context: { courseOfferingId: 7, moduleId: 3 },
    createdAt: "2026-05-01T10:00:00.000Z",
    updatedAt: "2026-05-02T11:30:00.000Z",
    ...over,
  }
}

describe("normalizeAdminBugReportRow", () => {
  it("carries the fields the shared view needs and the raw payload does not name", () => {
    const row = normalizeAdminBugReportRow(corePayload())

    expect(row.userId).toBe("user-42")
    expect(row.updatedAt).toBe("2026-05-02T11:30:00.000Z")
    expect(row.reporterName).toBe("Alex Patel")
    expect(row.reporterEmail).toBe("alex@eduai.test")
    expect(row.user).toEqual({
      id: "user-42",
      name: "Alex Patel",
      email: "alex@eduai.test",
      role: null,
    })
  })

  it("lower-cases Core's status enum", () => {
    expect(normalizeAdminBugReportRow(corePayload()).status).toBe("in progress")
    expect(normalizeAdminBugReportRow(corePayload({ status: "UNHANDLED" })).status).toBe("unhandled")
  })

  it("flattens the context blob so getContextLabel can read it", () => {
    const row = normalizeAdminBugReportRow(corePayload())

    expect(row.courseOfferingId).toBe(7)
    expect(row.moduleId).toBe(3)
    expect(row.lessonId).toBeNull()
    expect(row.activityId).toBeNull()
    // The blob itself is preserved for anything reading per-app extras.
    expect(row.context).toEqual({ courseOfferingId: 7, moduleId: 3 })
    expect(getContextLabel(row)).toBe("Course #7 / Module #3")
  })

  it("prefers context titles over ids when the reporting app supplied them", () => {
    const row = normalizeAdminBugReportRow(
      corePayload({ context: { courseOfferingId: 7, courseTitle: "CPSC 210" } }),
    )

    expect(row.courseTitle).toBe("CPSC 210")
    expect(getContextLabel(row)).toBe("CPSC 210")
  })

  it("renders no context when the blob is absent or not an object", () => {
    for (const context of [null, undefined, "nope", [1, 2]]) {
      const row = normalizeAdminBugReportRow(corePayload({ context }))
      expect(row.courseOfferingId).toBeNull()
      expect(getContextLabel(row)).toBe("-")
    }
  })

  it("never copies an undefined internal user id into the clipboard dossier", () => {
    const named = buildBugReportCopyText(normalizeAdminBugReportRow(corePayload()))
    expect(named).toContain("user-42")
    expect(named).not.toContain("undefined")

    // A payload with no reporter at all must still not print `undefined`.
    const orphaned = buildBugReportCopyText(
      normalizeAdminBugReportRow(
        corePayload({ userId: null, userName: null, userEmail: null }),
      ),
    )
    expect(orphaned).not.toContain("undefined")
  })

  it("masks the reporter on anonymous reports even if the proxy did not", () => {
    const row = normalizeAdminBugReportRow(
      corePayload({ isAnonymous: true, userName: "Alex Patel", userEmail: "alex@eduai.test" }),
    )

    expect(row.reporterEmail).toBeNull()
    expect(row.userName).toBeNull()
    expect(row.user?.email).toBeNull()
    expect(getReporterLabel(row)).toBe("Anonymous")
    expect(buildBugReportCopyText(row)).not.toContain("alex@eduai.test")
  })

  it("derives attachment flags from the blobs when the payload omits them", () => {
    // Detail payloads carry bodies; older list payloads carried neither flag nor body.
    const detail = normalizeAdminBugReportRow(
      corePayload({
        consoleLogs: "[]",
        screenshot: "",
        hasConsoleLogs: undefined,
        hasScreenshot: undefined,
        hasNetworkLogs: undefined,
      }),
    )

    expect(detail.hasConsoleLogs).toBe(true)
    // Empty string is not an attachment — the viewer must not open on it.
    expect(detail.hasScreenshot).toBe(false)
    expect(detail.hasNetworkLogs).toBe(false)
  })

  it("keeps the list payload's flags when the bodies are omitted", () => {
    const row = normalizeAdminBugReportRow(corePayload())

    expect(row.consoleLogs).toBeNull()
    expect(row.hasConsoleLogs).toBe(true)
    expect(row.hasScreenshot).toBe(true)
    expect(row.hasNetworkLogs).toBe(false)
  })
})

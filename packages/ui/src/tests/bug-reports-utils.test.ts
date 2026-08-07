import { describe, expect, it } from "vitest"

import {
  BUG_TYPE_LABELS,
  CORE_STATUS_TO_UI,
  UI_STATUS_TO_CORE,
  buildBugReportCopyText,
  getPathLabel,
  getReporterLabel,
  safeJsonParse,
  sortReports,
  toUiStatus,
} from "../bug-reports/bug-reports-utils"
import type { AdminBugReportRow } from "../bug-reports/types"

function row(over: Partial<AdminBugReportRow> = {}): AdminBugReportRow {
  return {
    id: "r1",
    description: "Something broke",
    bugType: "OTHER",
    status: "unhandled",
    isAnonymous: false,
    userId: "u1",
    reporterName: "Alex Patel",
    reporterEmail: "alex@eduai.test",
    createdAt: "2026-05-01T10:00:00.000Z",
    ...over,
  }
}

describe("bug-report status casing", () => {
  it("round-trips Core's enum through the UI form", () => {
    for (const [core, ui] of Object.entries(CORE_STATUS_TO_UI)) {
      expect(toUiStatus(core)).toBe(ui)
      expect(UI_STATUS_TO_CORE[ui]).toBe(core)
    }
  })

  it("keeps the space in the in-progress UI form", () => {
    // The extensions' forked maps both used 'in progress', not 'in_progress'.
    expect(CORE_STATUS_TO_UI.IN_PROGRESS).toBe("in progress")
    expect(UI_STATUS_TO_CORE["in progress"]).toBe("IN_PROGRESS")
  })

  it("passes through a value that is already in UI form", () => {
    expect(toUiStatus("resolved")).toBe("resolved")
  })
})

describe("reporter labelling", () => {
  it("prefers name and email when present", () => {
    expect(getReporterLabel(row())).toContain("Alex Patel")
  })

  it("falls back to the user id rather than exposing nothing", () => {
    const label = getReporterLabel(
      row({ reporterName: null, reporterEmail: null, userName: null, userEmail: null }),
    )
    expect(label).toBeTruthy()
  })
})

describe("sortReports", () => {
  const older = row({ id: "a", createdAt: "2026-05-01T00:00:00.000Z", description: "aaa" })
  const newer = row({ id: "b", createdAt: "2026-06-01T00:00:00.000Z", description: "bbb" })

  it("sorts dates chronologically, not lexically", () => {
    const asc = sortReports([newer, older], "createdAt", "asc").map((r) => r.id)
    expect(asc).toEqual(["a", "b"])
    const desc = sortReports([older, newer], "createdAt", "desc").map((r) => r.id)
    expect(desc).toEqual(["b", "a"])
  })

  it("sorts other columns as strings", () => {
    expect(sortReports([newer, older], "description", "asc").map((r) => r.id)).toEqual(["a", "b"])
  })

  it("sorts by bug type", () => {
    const ui = row({ id: "x", bugType: "UI_DISPLAY" })
    const perf = row({ id: "y", bugType: "PERFORMANCE" })
    expect(sortReports([ui, perf], "bugType", "asc").map((r) => r.id)).toEqual(["y", "x"])
  })

  it("does not mutate its input", () => {
    const input = [newer, older]
    sortReports(input, "createdAt", "asc")
    expect(input.map((r) => r.id)).toEqual(["b", "a"])
  })
})

describe("misc helpers", () => {
  it("safeJsonParse returns the fallback on bad input", () => {
    expect(safeJsonParse("not json", [])).toEqual([])
    expect(safeJsonParse(null, "fb")).toBe("fb")
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 })
  })

  it("getPathLabel reduces a URL to its path", () => {
    expect(getPathLabel("https://eduai.test/admin/bug-reports?x=1")).toContain("/admin/bug-reports")
    expect(getPathLabel(null)).toBeTruthy()
  })

  it("labels every bug type", () => {
    for (const label of Object.values(BUG_TYPE_LABELS)) expect(label).toBeTruthy()
  })
})

describe("buildBugReportCopyText", () => {
  it("includes the description and type label", () => {
    const text = buildBugReportCopyText(row())
    expect(text).toContain("Something broke")
    expect(text).toContain(BUG_TYPE_LABELS.OTHER)
  })

  it("omits identifying fields for anonymous reports", () => {
    const text = buildBugReportCopyText(
      row({ isAnonymous: true, reporterName: "Alex Patel", reporterEmail: "alex@eduai.test" }),
    )
    expect(text).not.toContain("alex@eduai.test")
  })
})

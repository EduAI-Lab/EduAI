import { describe, expect, it } from "vitest"

import { QUESTION_MAKER_ROLES, visibleAppsForRole } from "../app-launcher"
import { getLauncherApps, type LauncherAppUrls } from "../launcher-registry"

const URLS: LauncherAppUrls = {
  core: "https://core.example.edu",
  aiTutor: "https://tutor.example.edu",
  questionMaker: "https://qm.example.edu",
}

describe("getLauncherApps", () => {
  it("returns the canonical 3-app list with the injected URLs", () => {
    const apps = getLauncherApps({ currentAppId: "core", urls: URLS })
    expect(apps.map((a) => a.id)).toEqual(["core", "ai-tutor", "question-maker"])
    expect(apps.map((a) => a.url)).toEqual([URLS.core, URLS.aiTutor, URLS.questionMaker])
    expect(apps.map((a) => a.name)).toEqual(["EduAI Core", "AI Tutor", "Question Maker"])
  })

  it("gates Question Maker behind QUESTION_MAKER_ROLES, leaving Core/AI Tutor open", () => {
    const apps = getLauncherApps({ currentAppId: "core", urls: URLS })
    const byId = Object.fromEntries(apps.map((a) => [a.id, a]))
    expect(byId["question-maker"].roles).toEqual(QUESTION_MAKER_ROLES)
    expect(byId.core.roles).toBeUndefined()
    expect(byId["ai-tutor"].roles).toBeUndefined()
  })

  it("returns the same list regardless of which app is 'current'", () => {
    // BrandSwitcher marks the current entry itself from its own prop — the
    // list this helper returns doesn't filter or reorder based on it.
    const asCore = getLauncherApps({ currentAppId: "core", urls: URLS }).map((a) => a.id)
    const asAiTutor = getLauncherApps({ currentAppId: "ai-tutor", urls: URLS }).map((a) => a.id)
    const asQm = getLauncherApps({ currentAppId: "question-maker", urls: URLS }).map((a) => a.id)
    expect(asAiTutor).toEqual(asCore)
    expect(asQm).toEqual(asCore)
  })
})

// ── RBAC gate, composed with the existing visibleAppsForRole ──────────────────
describe("getLauncherApps + visibleAppsForRole — RBAC gate", () => {
  const apps = getLauncherApps({ currentAppId: "core", urls: URLS })

  it("hides Question Maker from students", () => {
    const ids = visibleAppsForRole(apps, "STUDENT").map((a) => a.id)
    expect(ids).toEqual(["core", "ai-tutor"])
    expect(ids).not.toContain("question-maker")
  })

  it.each(["INSTRUCTOR", "ADMIN", "UNIT_ADMIN"])("shows Question Maker to %s", (role) => {
    const ids = visibleAppsForRole(apps, role).map((a) => a.id)
    expect(ids).toContain("question-maker")
  })

  it("hides role-gated apps when the role is null/undefined", () => {
    expect(visibleAppsForRole(apps, null).map((a) => a.id)).not.toContain("question-maker")
    expect(visibleAppsForRole(apps, undefined).map((a) => a.id)).not.toContain("question-maker")
  })
})

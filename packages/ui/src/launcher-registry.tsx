/**
 * Canonical cross-app launcher registry (issue #764). `lib/apps.tsx` in Core,
 * AI Tutor, and Question Maker each hard-code the same three `LauncherApp`
 * entries (id/name/icon/description/color/roles) and differ only in which env
 * vars they resolve for the URLs and which app is "current". This helper is
 * the single source of truth for the shared part; each app's `lib/apps.tsx`
 * shrinks to: resolve its 3 URLs from env, then call `getLauncherApps`.
 */
import { IconBooks, IconMessageChatbot, IconSchool } from "@tabler/icons-react"

import { QUESTION_MAKER_ROLES, type LauncherApp } from "./app-launcher"

/** Stable ids for the three EduAI apps/extensions (mirrors each app's own `CURRENT_APP_ID`). */
export type LauncherAppId = "core" | "ai-tutor" | "question-maker"

/** Absolute URLs for each app, resolved by the caller from its own env. */
export interface LauncherAppUrls {
  core: string
  aiTutor: string
  questionMaker: string
}

export interface GetLauncherAppsOptions {
  /**
   * The app that will render the switcher. The returned list always contains
   * all three apps — including "self" — same as today's three copies;
   * `BrandSwitcher` (not this helper) marks the current entry from its own
   * `currentAppId` prop. Typing it here keeps the call site symmetric with
   * `BrandSwitcherProps.currentAppId` and catches a typo'd id at compile time.
   */
  currentAppId: LauncherAppId
  /** Absolute URLs for each app, resolved by the caller (env-specific per app/deployment). */
  urls: LauncherAppUrls
}

/**
 * The canonical 3-app list (Core, AI Tutor, Question Maker) with shared
 * names/icons/colors/roles. Question Maker is gated to `QUESTION_MAKER_ROLES`
 * (reused from `app-launcher`, the RBAC source of truth); Core and AI Tutor
 * are open to every role. URLs come from `options.urls` so this stays
 * environment-agnostic — each app resolves its own env vars and injects them.
 */
export function getLauncherApps({ urls }: GetLauncherAppsOptions): LauncherApp[] {
  return [
    {
      id: "core",
      name: "EduAI Core",
      url: urls.core,
      icon: <IconSchool className="size-4" />,
      description: "Courses, materials & class hub",
      color: "oklch(0.580 0.150 250)",
    },
    {
      id: "ai-tutor",
      name: "AI Tutor",
      url: urls.aiTutor,
      icon: <IconMessageChatbot className="size-4" />,
      description: "Chat-based study assistant",
      color: "oklch(0.560 0.130 165)",
    },
    {
      id: "question-maker",
      name: "Question Maker",
      url: urls.questionMaker,
      icon: <IconBooks className="size-4" />,
      description: "Build & manage assessments",
      color: "oklch(0.660 0.145 65)",
      roles: QUESTION_MAKER_ROLES,
    },
  ]
}

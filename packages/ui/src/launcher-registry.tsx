/**
 * Canonical cross-app launcher registry (issue #764). `lib/apps.tsx` in Core,
 * AI Tutor, and Question Maker each hard-code the same three `LauncherApp`
 * entries (id/name/icon/description/color/roles) and differ only in which env
 * vars they resolve for the URLs and which app is "current". This helper is
 * the single source of truth for the shared part; each app's `lib/apps.tsx`
 * shrinks to: resolve its 3 URLs from env, then call `getLauncherApps`.
 */
import { IconBooks, IconMessageChatbot, IconMessages, IconSchool } from "@tabler/icons-react";

import { QUESTION_MAKER_ROLES, type LauncherApp } from "./app-launcher";

/**
 * Stable ids for the EduAI apps (mirrors each app's own `CURRENT_APP_ID`).
 * `course-chat` is Core's chat, presented as an app of its own.
 */
export type LauncherAppId = "core" | "course-chat" | "ai-tutor" | "question-maker";

/** Absolute URLs for each app, resolved by the caller from its own env. */
export interface LauncherAppUrls {
  core: string;
  aiTutor: string;
  questionMaker: string;
}

export interface GetLauncherAppsOptions {
  /**
   * The app that will render the switcher. The returned list always contains
   * every app — including "self";
   * `BrandSwitcher` (not this helper) marks the current entry from its own
   * `currentAppId` prop. Typing it here keeps the call site symmetric with
   * `BrandSwitcherProps.currentAppId` and catches a typo'd id at compile time.
   */
  currentAppId: LauncherAppId;
  /** Absolute URLs for each app, resolved by the caller (env-specific per app/deployment). */
  urls: LauncherAppUrls;
  /** Canonical Core course id to preserve while switching apps. */
  coreCourseId?: string | null;
}

function courseUrl(base: string, appId: LauncherAppId, coreCourseId?: string | null): string {
  const id = coreCourseId?.trim();
  if (!id || !base) return base;
  const url = new URL(base);
  if (appId === "core") url.pathname = `/courses/${encodeURIComponent(id)}`;
  else if (appId === "course-chat") url.searchParams.set("courseId", id);
  else url.searchParams.set("coreCourseId", id);
  return url.toString();
}

/**
 * The canonical app list (Core, Course Chat, AI Tutor, Question Maker) with shared
 * names/icons/colors/roles. Question Maker is gated to `QUESTION_MAKER_ROLES`
 * (reused from `app-launcher`, the RBAC source of truth); the other apps
 * are open to every role. URLs come from `options.urls` so this stays
 * environment-agnostic — each app resolves its own env vars and injects them.
 */
export function getLauncherApps({ urls, coreCourseId }: GetLauncherAppsOptions): LauncherApp[] {
  return [
    {
      id: "core",
      name: "EduAI Core",
      shortName: "Core",
      url: courseUrl(urls.core, "core", coreCourseId),
      icon: <IconSchool className="size-4" />,
      description: "Courses, materials & class hub",
      color: "oklch(0.580 0.150 250)",
    },
    {
      // Part of Core (its `/chat` routes), but presented as an app of its own
      // so students find it in the switcher beside AI Tutor (#1996).
      id: "course-chat",
      name: "Course Chat",
      url: courseUrl(
        urls.core && `${urls.core.replace(/\/$/, "")}/chat`,
        "course-chat",
        coreCourseId,
      ),
      icon: <IconMessages className="size-4" />,
      description: "Ask questions about your course materials",
      color: "oklch(0.570 0.170 340)",
    },
    {
      id: "ai-tutor",
      name: "AI Tutor",
      url: courseUrl(urls.aiTutor, "ai-tutor", coreCourseId),
      icon: <IconMessageChatbot className="size-4" />,
      description: "Guided lessons with an AI tutor",
      color: "oklch(0.560 0.130 165)",
    },
    {
      id: "question-maker",
      name: "Question Maker",
      url: courseUrl(urls.questionMaker, "question-maker", coreCourseId),
      icon: <IconBooks className="size-4" />,
      description: "Build & manage assessments",
      color: "oklch(0.660 0.145 65)",
      roles: QUESTION_MAKER_ROLES,
    },
  ];
}

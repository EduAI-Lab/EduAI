import { getLauncherApps as getSharedLauncherApps, type LauncherApp } from '@eduai/ui'
import { getEduAiAppUrl, getAiTutorAppUrl } from '~/lib/extension-urls'
import { getQuestionMakerUrl } from '~/lib/extensions/question-maker'

/** Stable id for the app rendering this sidebar — passed to AppLauncher. */
export const CURRENT_APP_ID = 'core'

/**
 * Every EduAI app/extension, for the sidebar app switcher. Names/icons/colors/
 * role-gating now live in the shared `@eduai/ui` registry (issue #764) so
 * Core, AI Tutor, and Question Maker agree on one canonical list; this app
 * only resolves its own per-env URLs and injects them.
 */
export function getLauncherApps(): LauncherApp[] {
  return getSharedLauncherApps({
    currentAppId: CURRENT_APP_ID,
    urls: {
      core: getEduAiAppUrl(),
      aiTutor: getAiTutorAppUrl(),
      questionMaker: getQuestionMakerUrl(),
    },
  })
}

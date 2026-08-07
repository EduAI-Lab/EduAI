import { getLauncherApps as getSharedLauncherApps, type LauncherApp } from '@eduai/ui';
import { getCoreUrl, getAiTutorUrl } from './coreUrl';

/** Stable id for the app rendering this sidebar — passed to AppLauncher. */
export const CURRENT_APP_ID = 'question-maker';

function getQuestionMakerUrl(): string {
  return import.meta.env.VITE_QUESTION_MAKER_URL?.trim() || 'http://localhost:5173';
}

/**
 * Every EduAI app/extension, for the bottom-left launcher. Names/icons/colors/
 * role-gating now live in the shared `@eduai/ui` registry (issue #764) so
 * Core, AI Tutor, and Question Maker agree on one canonical list; this app
 * only resolves its own per-env URLs and injects them.
 */
export function getLauncherApps(): LauncherApp[] {
  return getSharedLauncherApps({
    currentAppId: CURRENT_APP_ID,
    urls: {
      core: getCoreUrl(),
      aiTutor: getAiTutorUrl(),
      questionMaker: getQuestionMakerUrl(),
    },
  });
}

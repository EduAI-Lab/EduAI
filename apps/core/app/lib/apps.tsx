import { IconBooks, IconMessageChatbot, IconSchool } from '@tabler/icons-react'
import { QUESTION_MAKER_ROLES, type LauncherApp } from '@eduai/ui'
import { getEduAiAppUrl, getAiTutorAppUrl } from '~/lib/extension-urls'
import { getQuestionMakerUrl } from '~/lib/extensions/question-maker'

/** Stable id for the app rendering this sidebar — passed to AppLauncher. */
export const CURRENT_APP_ID = 'core'

/**
 * Every EduAI app/extension, for the sidebar app switcher. Role gating is
 * applied by AppLauncher from each entry's `roles`; Core and AI Tutor are open
 * to all roles, Question Maker only to instructors/admins (rbac-matrix §4).
 */
export function getLauncherApps(): LauncherApp[] {
  return [
    {
      id: 'core',
      name: 'EduAI Core',
      url: getEduAiAppUrl(),
      icon: <IconSchool className="size-4" />,
    },
    {
      id: 'ai-tutor',
      name: 'AI Tutor',
      url: getAiTutorAppUrl(),
      icon: <IconMessageChatbot className="size-4" />,
    },
    {
      id: 'question-maker',
      name: 'Question Maker',
      url: getQuestionMakerUrl(),
      icon: <IconBooks className="size-4" />,
      roles: QUESTION_MAKER_ROLES,
    },
  ]
}

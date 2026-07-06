import { IconBooks, IconMessageChatbot, IconSchool } from '@tabler/icons-react';
import { QUESTION_MAKER_ROLES, type LauncherApp } from '@eduai/ui';
import { getEduAiAppUrl, getAiTutorAppUrl, getQuestionMakerUrl } from './extension-urls';

/** Stable id for the app rendering this sidebar — passed to AppLauncher. */
export const CURRENT_APP_ID = 'ai-tutor';

/**
 * Every EduAI app/extension, for the bottom-left launcher. Role gating is
 * applied by AppLauncher from each entry's `roles`; Core and AI Tutor are open
 * to all roles, Question Maker only to instructors/admins.
 */
export function getLauncherApps(): LauncherApp[] {
  return [
    {
      id: 'core',
      name: 'EduAI Core',
      url: getEduAiAppUrl(),
      icon: <IconSchool className="size-4" />,
      description: 'Courses, materials & class hub',
      color: 'oklch(0.580 0.150 250)',
    },
    {
      id: 'ai-tutor',
      name: 'AI Tutor',
      url: getAiTutorAppUrl(),
      icon: <IconMessageChatbot className="size-4" />,
      description: 'Chat-based study assistant',
      color: 'oklch(0.560 0.130 165)',
    },
    {
      id: 'question-maker',
      name: 'Question Maker',
      url: getQuestionMakerUrl(),
      icon: <IconBooks className="size-4" />,
      description: 'Build & manage assessments',
      color: 'oklch(0.660 0.145 65)',
      roles: QUESTION_MAKER_ROLES,
    },
  ];
}

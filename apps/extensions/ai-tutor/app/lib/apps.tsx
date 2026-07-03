import { IconBooks, IconMessageChatbot, IconSchool } from '@tabler/icons-react';
import type { LauncherApp } from '@eduai/ui';
import { getEduAiAppUrl, getAiTutorAppUrl, getQuestionMakerUrl } from './extension-urls';

/** Stable id for the app rendering this sidebar — passed to AppLauncher. */
export const CURRENT_APP_ID = 'ai-tutor';

/** Every EduAI app/extension, for the bottom-left launcher. */
export function getLauncherApps(): LauncherApp[] {
  return [
    {
      id: 'core',
      name: 'EduAI Core',
      description: 'Courses & administration',
      url: getEduAiAppUrl(),
      icon: <IconSchool className="size-4" />,
    },
    {
      id: 'ai-tutor',
      name: 'AI Tutor',
      description: 'Chat-based student tutoring',
      url: getAiTutorAppUrl(),
      icon: <IconMessageChatbot className="size-4" />,
    },
    {
      id: 'question-maker',
      name: 'Question Maker',
      description: 'Author & manage questions',
      url: getQuestionMakerUrl(),
      icon: <IconBooks className="size-4" />,
    },
  ];
}

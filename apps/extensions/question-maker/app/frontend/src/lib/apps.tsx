import { IconBooks, IconMessageChatbot, IconSchool } from '@tabler/icons-react';
import type { LauncherApp } from '@eduai/ui';
import { getCoreUrl, getAiTutorUrl } from './coreUrl';

/** Stable id for the app rendering this sidebar — passed to AppLauncher. */
export const CURRENT_APP_ID = 'question-maker';

function getQuestionMakerUrl(): string {
  return import.meta.env.VITE_QUESTION_MAKER_URL?.trim() || 'http://localhost:5173';
}

/** Every EduAI app/extension, for the bottom-left launcher. */
export function getLauncherApps(): LauncherApp[] {
  return [
    {
      id: 'core',
      name: 'EduAI Core',
      description: 'Courses & administration',
      url: getCoreUrl(),
      icon: <IconSchool className="size-4" />,
    },
    {
      id: 'ai-tutor',
      name: 'AI Tutor',
      description: 'Chat-based student tutoring',
      url: getAiTutorUrl(),
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

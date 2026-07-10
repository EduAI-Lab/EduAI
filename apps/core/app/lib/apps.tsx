import { IconBooks, IconMessageChatbot, IconPuzzle, IconSchool } from '@tabler/icons-react'
import { QUESTION_MAKER_ROLES, type LauncherApp } from '@eduai/ui'
import { getEduAiAppUrl, getAiTutorAppUrl } from '~/lib/extension-urls'
import { getQuestionMakerUrl } from '~/lib/extensions/question-maker'

/** Stable id for the app rendering this sidebar — passed to AppLauncher. */
export const CURRENT_APP_ID = 'core'

/**
 * Parse additional extensions from the VITE_EXTRA_EXTENSIONS env var.
 *
 * The value must be a JSON array of objects with at minimum `id`, `name`, and
 * `url`. Optional fields: `description`, `color` (CSS color string).
 *
 * Example .env entry (single-quoted to avoid shell escaping issues):
 *   VITE_EXTRA_EXTENSIONS='[{"id":"example","name":"Example","url":"http://localhost:9000","description":"Demo extension"}]'
 *
 * Malformed JSON is silently ignored so a bad value never breaks the sidebar.
 */
export function parseExtraExtensions(): LauncherApp[] {
  const raw = import.meta.env.VITE_EXTRA_EXTENSIONS?.trim()
  if (!raw) return []
  try {
    const entries: unknown = JSON.parse(raw)
    if (!Array.isArray(entries)) return []
    return entries
      .filter(
        (e): e is Record<string, string> =>
          typeof e === 'object' &&
          e !== null &&
          typeof (e as Record<string, unknown>).id === 'string' &&
          typeof (e as Record<string, unknown>).name === 'string' &&
          typeof (e as Record<string, unknown>).url === 'string',
      )
      .map((e) => ({
        id: e.id,
        name: e.name,
        url: e.url,
        icon: <IconPuzzle className="size-4" />,
        description: e.description,
        color: e.color ?? 'oklch(0.580 0.150 300)',
      }))
  } catch {
    return []
  }
}

/**
 * Every EduAI app/extension, for the sidebar app switcher. Role gating is
 * applied by AppLauncher from each entry's `roles`; Core and AI Tutor are open
 * to all roles, Question Maker only to instructors/admins (rbac-matrix §4).
 *
 * Visibility is controlled by env vars: an extension only appears when its
 * corresponding VITE_*_URL variable is set. Omit the var in an environment
 * where the extension isn't deployed and it won't show in the sidebar.
 * Additional extensions can also be injected via VITE_EXTRA_EXTENSIONS.
 */
export function getLauncherApps(): LauncherApp[] {
  const aiTutorUrl = getAiTutorAppUrl()
  const questionMakerUrl = getQuestionMakerUrl()

  return [
    {
      id: 'core',
      name: 'EduAI Core',
      url: getEduAiAppUrl(),
      icon: <IconSchool className="size-4" />,
      description: 'Courses, materials & class hub',
      color: 'oklch(0.580 0.150 250)',
    },
    ...(aiTutorUrl ? [{
      id: 'ai-tutor',
      name: 'AI Tutor',
      url: aiTutorUrl,
      icon: <IconMessageChatbot className="size-4" />,
      description: 'Chat-based study assistant',
      color: 'oklch(0.560 0.130 165)',
    }] : []),
    ...(questionMakerUrl ? [{
      id: 'question-maker',
      name: 'Question Maker',
      url: questionMakerUrl,
      icon: <IconBooks className="size-4" />,
      description: 'Build & manage assessments',
      color: 'oklch(0.660 0.145 65)',
      roles: QUESTION_MAKER_ROLES,
    }] : []),
    ...parseExtraExtensions(),
  ]
}

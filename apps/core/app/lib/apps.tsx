import { asJsonArray, parseJsonText } from "~/lib/json-value";
import { z } from "zod";
import { IconPuzzle } from "@tabler/icons-react";
import { getLauncherApps as getSharedLauncherApps, type LauncherApp } from "@eduai/ui";
import { getEduAiAppUrl, getAiTutorAppUrl } from "~/lib/extension-urls";
import { getQuestionMakerUrl } from "~/lib/extensions/question-maker";

/** Stable id for the app rendering this sidebar — passed to AppLauncher. */
export const CURRENT_APP_ID = "core";

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
/** Sidebar tint for an extension that did not choose one. */
const DEFAULT_EXTENSION_COLOR = "oklch(0.580 0.150 300)";

/**
 * One entry of `VITE_EXTRA_EXTENSIONS`. `id`, `name` and `url` are the minimum
 * an entry needs to be launchable; an entry missing any of them is dropped
 * rather than rendered half-formed. A `color` that is present but empty falls
 * back to the default, which is why it is `.min(1)`.
 */
const extraExtensionSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  description: z.string().optional().catch(undefined),
  color: z.string().min(1).optional().catch(undefined),
});

export function parseExtraExtensions(): LauncherApp[] {
  const raw = import.meta.env.VITE_EXTRA_EXTENSIONS?.trim();
  if (!raw) return [];
  const entries = asJsonArray(parseJsonText(raw));
  if (!entries) return [];
  return entries.flatMap((entry) => {
    const decoded = extraExtensionSchema.safeParse(entry);
    if (!decoded.success) return [];
    return [
      {
        id: decoded.data.id,
        name: decoded.data.name,
        url: decoded.data.url,
        icon: <IconPuzzle className="size-4" />,
        description: decoded.data.description,
        color: decoded.data.color ?? DEFAULT_EXTENSION_COLOR,
      },
    ];
  });
}

/**
 * Every EduAI app/extension, for the sidebar app switcher. Names/icons/colors/
 * role-gating for the three built-in apps live in the shared `@eduai/ui`
 * registry (issue #764) so Core, AI Tutor, and Question Maker agree on one
 * canonical list; this app resolves its own per-env URLs and injects them.
 *
 * Visibility is controlled by env vars: an extension only appears when its
 * corresponding VITE_*_URL variable is set. Omit the var in an environment
 * where the extension isn't deployed and it won't show in the sidebar.
 * Additional extensions can also be injected via VITE_EXTRA_EXTENSIONS.
 */
export function getLauncherApps(): LauncherApp[] {
  const aiTutorUrl = getAiTutorAppUrl();
  const questionMakerUrl = getQuestionMakerUrl();

  const apps = getSharedLauncherApps({
    currentAppId: CURRENT_APP_ID,
    urls: {
      core: getEduAiAppUrl(),
      aiTutor: aiTutorUrl ?? "",
      questionMaker: questionMakerUrl ?? "",
    },
  });

  return [...apps.filter((app) => app.id === CURRENT_APP_ID || app.url), ...parseExtraExtensions()];
}

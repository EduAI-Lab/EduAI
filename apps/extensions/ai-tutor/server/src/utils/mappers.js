/**
 * @file Server -> client DTO mappers.
 *
 * Responsibility: Translate raw Prisma rows into the JSON shapes the React
 *   client expects. This is the single chokepoint where DB column names,
 *   nested config blobs, and relation rows are flattened into the contract
 *   that `app/lib/api.ts` and `app/lib/types.ts` consume.
 *
 * !! SILENT-BREAKAGE WARNING !!
 *   Any field rename, removal, or shape change in this file is a SILENT
 *   breaking change for the frontend. The compiler will not catch it because
 *   the wire format is JSON. Every edit here MUST be paired with a matching
 *   update (or at least a verification) in:
 *     - `app/lib/api.ts`        (request/response signatures)
 *     - `app/lib/types.ts`      (TypeScript types describing the same DTOs)
 *   Run a manual smoke test of the affected screens after touching mappers.
 *
 * Callers: every route module under `server/src/routes/*.js` that returns a
 *   resource to the client.
 * Gotchas:
 *   - `mapActivity` aggressively normalizes the freeform `Activity.config`
 *     JSON blob into stable top-level fields. The shape it emits is the de
 *     facto Activity DTO; the raw `config` is intentionally not exposed.
 *   - Legacy data shapes are accepted on read (e.g. `options` as a bare
 *     array vs `{choices: []}`) but always emitted in the new shape.
 * Related: `app/lib/api.ts`, `app/lib/types.ts`, `server/prisma/schema.prisma`.
 */

/**
 * Strip the password hash before returning a User row to anyone.
 *
 * Why: Defense-in-depth — even though the hash is rarely loaded, this
 * guarantees no accidental leak through helper routes or debug output.
 */
export function toPublicUser(user) {
  if (!user) return null;
  const { password, ...rest } = user;
  return rest;
}

/**
 * Project a User row to the minimal shape used by the admin user list.
 *
 * Why: The admin UI does not need (or want) auth-provider relations, image
 * URLs, or audit fields. Keeping this list narrow also keeps PII surface
 * small in admin exports/logs.
 */
export function mapAdminUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt,
  };
}

/**
 * Map a CourseOffering row to its public DTO.
 *
 * Why: The `external*` fields are nullable for native courses but populated
 * for EduAI-imported courses. They are coerced to explicit `null` (rather
 * than left as `undefined`) so the client can detect "imported" vs "native"
 * with a simple truthy check on `externalId`.
 */
export function mapCourseOffering(offering) {
  return {
    id: offering.id,
    title: offering.title,
    description: offering.description,
    isPublished: offering.isPublished,
    startDate: offering.startDate,
    endDate: offering.endDate,
    externalId: offering.externalId ?? null,
    externalSource: offering.externalSource ?? null,
    externalMetadata: offering.externalMetadata ?? null,
  };
}

export function mapModule(module) {
  return {
    id: module.id,
    title: module.title,
    description: module.description,
    position: module.position,
    isPublished: module.isPublished,
    courseOfferingId: module.courseOfferingId,
  };
}

/**
 * Map a Lesson row to its public DTO.
 *
 * Why: `courseOfferingId` is not stored on Lesson directly — it comes via
 * the parent Module. The fallback chain accepts either a row that includes
 * `module: { courseOfferingId }` (the common eager-load shape) or a
 * pre-flattened row, so callers don't have to standardize their queries.
 */
export function mapLesson(lesson) {
  return {
    id: lesson.id,
    title: lesson.title,
    contentMd: lesson.contentMd,
    position: lesson.position,
    isPublished: lesson.isPublished,
    courseOfferingId: lesson.module?.courseOfferingId ?? lesson.courseOfferingId ?? undefined,
    moduleId: lesson.moduleId ?? lesson.module?.id ?? undefined,
  };
}

/**
 * Map an Activity row (with optional eager-loaded relations) to the
 * Activity DTO consumed by the student/instructor activity views.
 *
 * Output fields (all derived):
 *   - `question`          — `config.question`, falling back to legacy
 *                            `config.prompt`, then `instructionsMd`. Multiple
 *                            generations of Activity records exist in prod;
 *                            this fallback keeps old activities renderable.
 *   - `type`              — `config.questionType`, defaulting to `'MCQ'` for
 *                            legacy rows that pre-date the type field.
 *   - `options`           — Normalized to `{ choices: string[] } | null`.
 *                            Accepts legacy bare-array form on read but
 *                            always emits the object form so the client can
 *                            assume one shape.
 *   - `answer`            — Correct answer (string for MCQ index, free text
 *                            for short-answer, etc.). `null` if unset.
 *   - `hints`             — Always an array; non-array values become `[]` so
 *                            the client can `.map` without a guard.
 *   - `secondaryTopics`   — Flattened from the M:N join rows
 *                            (`ActivitySecondaryTopic`) into `{id, name}[]`.
 *   - `enableTeachMode` / `enableGuideMode` / `enableCustomMode` — Mode
 *                            toggles; defaults match the schema defaults so
 *                            partial selects don't accidentally disable modes.
 *   - `customPrompt` / `customPromptTitle` — Only present when custom mode
 *                            is configured; coerced to `null` otherwise so
 *                            the client never sees `undefined`.
 *   - `completionStatus`  — Per-user status injected by the route handler
 *                            (mapper does not compute it); left `undefined`
 *                            when not applicable (e.g. instructor view).
 *
 * Why the heavy normalization: `Activity.config` is `Json` for flexibility,
 * but the client cannot safely consume freeform JSON. This mapper is the
 * contract that turns the blob into a stable, typed DTO.
 */
export function mapActivity(activity) {
  const config = activity.config ?? {};
  return {
    id: activity.id,
    title: activity.title,
    instructionsMd: activity.instructionsMd,
    position: activity.position,
    promptTemplateId: activity.promptTemplateId,
    promptTemplate: activity.promptTemplate
      ? { id: activity.promptTemplate.id, name: activity.promptTemplate.name }
      : null,
    // Fallback chain spans three generations of activity authoring.
    question: config.question ?? config.prompt ?? activity.instructionsMd,
    type: config.questionType ?? 'MCQ',
    // Always emit `{ choices: string[] }` so the client has one shape to
    // render. Legacy array-form options remain valid on read.
    options: (() => {
      if (!('options' in config) || config.options == null) return null;
      if (Array.isArray(config.options)) {
        return { choices: config.options };
      }
      if (config.options && Array.isArray(config.options.choices)) {
        return { choices: config.options.choices };
      }
      return null;
    })(),
    answer: config.answer ?? null,
    // Coerce non-array hints to `[]` so the client can iterate safely.
    hints: Array.isArray(config.hints) ? config.hints : [],
    mainTopic: activity.mainTopic
      ? { id: activity.mainTopic.id, name: activity.mainTopic.name }
      : null,
    // Flatten the join rows down to `{id,name}[]`; the client never needs
    // the join row itself.
    secondaryTopics: Array.isArray(activity.secondaryTopics)
      ? activity.secondaryTopics
          .map((relation) =>
            relation?.topic ? { id: relation.topic.id, name: relation.topic.name } : null,
          )
          .filter(Boolean)
      : [],
    // Mode defaults mirror the Prisma schema defaults so partial selects
    // (which would leave these `undefined`) don't accidentally disable modes
    // in the UI.
    enableTeachMode: activity.enableTeachMode ?? true,
    enableGuideMode: activity.enableGuideMode ?? true,
    enableCustomMode: activity.enableCustomMode ?? false,
    customPrompt: typeof activity.customPrompt === 'string' ? activity.customPrompt : null,
    customPromptTitle:
      typeof activity.customPromptTitle === 'string' ? activity.customPromptTitle : null,
    completionStatus: activity.completionStatus ?? undefined,
  };
}

/**
 * Normalize a progress aggregate to the `{completed,total,percentage}` shape.
 *
 * Why: Several queries return progress with optional fields (or no row at
 * all when a user has no submissions yet). Returning a zeroed object keeps
 * the client's progress bars/percent labels safe without null guards.
 */
export function mapProgressData(progressResult) {
  if (!progressResult) {
    return { completed: 0, total: 0, percentage: 0 };
  }
  return {
    completed: progressResult.completed ?? 0,
    total: progressResult.total ?? 0,
    percentage: progressResult.percentage ?? 0,
  };
}

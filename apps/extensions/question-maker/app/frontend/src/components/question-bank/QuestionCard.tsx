/**
 * Renders a single question/variant on the course Questions tab using the shared
 * @eduai/ui QuestionCard (the canonical question display). Actions (view / create
 * variant) live in the kebab menu; permissions gate the variant action.
 */
import {
  QuestionCard as QuestionPreviewCard,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  questionStatus,
  variantLabel,
} from '@eduai/ui';
import type { QuestionCardChoice, QuestionDifficulty as UiDifficulty } from '@eduai/ui';

import { IconCopy, IconDots } from '@tabler/icons-react';
import { useQmPermissionsForCourse } from '@/hooks/useQmPermissions';
import { formatCourseAccessLevel } from '@/lib/rbac/course-labels';
import type { QuestionVariantEntry, QuestionType } from '../../types/question';

interface QuestionCardProps {
  entry: QuestionVariantEntry;
  questionNumber: number;
  onView: (entry: QuestionVariantEntry) => void;
  onCreateVariant: (entry: QuestionVariantEntry) => void;
  /**
   * 1-based ordinal of this variant among its question's variants (the primary/base
   * variant is excluded). Resolved by the caller, which sees the full variant list.
   * Omitted for the base question.
   */
  variantNumber?: number;
  /** Dense single-column variant for the cross-course Question Bank page. */
  compact?: boolean;
}

const TYPE_LABELS: Record<QuestionType, string> = {
  MCQ: 'Multiple Choice',
  SA: 'Short Answer',
  LA: 'Long Answer',
};

const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

const formatUpdated = (iso?: string | null) => {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return undefined;
  return `Updated ${date.toLocaleDateString()}`;
};

export const QuestionCard = ({
  entry,
  questionNumber,
  onView,
  onCreateVariant,
  variantNumber,
  compact = false,
}: QuestionCardProps) => {
  const { canCreateQuestion, access, accessLoading, hasCourseAccess } = useQmPermissionsForCourse(
    entry.courseId ?? null,
  );
  const canWriteInCourse = hasCourseAccess && !accessLoading;
  const { variant } = entry;

  const difficulty = variant.difficulty ?? 'medium';
  const primaryTopicLabel = entry.primaryTopicName ?? `Topic ${entry.primaryTopicId}`;
  const isVariant = variant.referenceId != null;
  // A variant always belongs to the same question as its base (shared questionId), so
  // showing both the variant's id and the parent's would be redundant. Instead the top
  // identity reads "Variant N of #Q" (or "Question #Q" for the base) — one id, no repeat.
  const identity = isVariant
    ? variantLabel({ referenceId: entry.questionId, variantNumber })
    : `Question #${entry.questionId}`;
  const topics = [primaryTopicLabel, ...(entry.secondaryTopicNames ?? [])];
  if (access === 'ta') topics.push(`${formatCourseAccessLevel('ta')} · own edits only`);

  const isAi = Boolean(entry.isAiGenerated || variant.isAiGenerated);

  const choices: QuestionCardChoice[] | undefined =
    entry.questionType === 'MCQ' && variant.choices
      ? variant.choices.map((choice) => ({
          letter: choice.letter,
          text: choice.text,
          correct:
            variant.answer != null &&
            (choice.letter.trim().toLowerCase() === variant.answer.trim().toLowerCase() ||
              choice.text.trim().toLowerCase() === variant.answer.trim().toLowerCase()),
        }))
      : undefined;

  const canCreateVariant = canCreateQuestion && canWriteInCourse;
  const menu = canCreateVariant ? (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Question actions"
        className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <IconDots className="size-[18px]" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onCreateVariant(entry)}>
          <IconCopy className="size-4" /> Create variant
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : undefined;

  return (
    <QuestionPreviewCard
      onClick={() => onView(entry)}
      size={compact ? 'compact' : 'default'}
      className={compact ? 'h-full' : undefined}
      type={TYPE_LABELS[entry.questionType]}
      difficulty={capitalize(difficulty)}
      difficultyLevel={difficulty as UiDifficulty}
      ai={isAi}
      identity={identity}
      status={questionStatus(!!entry.isDraft)}
      question={variant.questionText}
      choices={choices}
      answer={choices ? undefined : variant.answer ?? undefined}
      topics={topics}
      updatedLabel={formatUpdated(variant.updatedAt ?? variant.createdAt)}
      menu={menu}
    />
  );
};

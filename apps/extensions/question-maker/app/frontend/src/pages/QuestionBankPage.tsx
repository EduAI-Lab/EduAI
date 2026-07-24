/**
 * Question Library — the cross-course view. Search, filter, sort and preview any
 * question across every course you can access. Presented as a dense, scannable index
 * (a row list) rather than a card wall, since this is a discovery/reuse surface;
 * authoring always happens inside a course. Clicking a row opens a read-only preview.
 */
import { useMemo, useState } from 'react';
import { PageHeading, Badge, QuestionStatusBadge, EmptyState, Button } from '@eduai/ui';
import {
  IconStack2,
  IconAlertTriangle,
  IconFilterX,
  IconSparkles,
  IconListCheck,
  IconAbc,
  IconFileText,
  IconChevronRight,
} from '@tabler/icons-react';
import { useAllQuestions } from '@/hooks/useAllQuestions';
import type { Question } from '@/types/question';
import { questionTypeLabels } from '@/types/question';
import { ListSkeleton } from '@/components/shared/Skeletons';
import {
  QuestionFilterToolbar,
  EMPTY_QUESTION_FILTERS,
  type QuestionFilters,
  type QuestionSort,
} from '@/components/question-bank/QuestionFilterToolbar';
import { QuestionPreviewSheet } from '@/components/question-bank/QuestionPreviewSheet';

const COURSE_ALL = '__all__';
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const DIFFICULTY_RANK: Record<string, number> = { easy: 0, medium: 1, hard: 2 };
const TYPE_ICON: Record<string, typeof IconListCheck> = {
  MCQ: IconListCheck,
  SA: IconAbc,
  LA: IconFileText,
};
const difficultyBadge: Record<string, 'success' | 'warning' | 'destructive'> = {
  easy: 'success',
  medium: 'warning',
  hard: 'destructive',
};

const repVariant = (q: Question) => q.variants?.[0];
const topicLabel = (q: Question) => q.primaryTopic?.name ?? '';
const questionTextOf = (q: Question) => repVariant(q)?.questionText ?? q.description ?? '';
const difficultyOf = (q: Question) => repVariant(q)?.difficulty;
const courseLabel = (q: Question) => q.course?.code ?? q.course?.name ?? `Course ${q.courseId}`;
const timeOf = (q: Question) => {
  const v = repVariant(q);
  return new Date(v?.createdAt || v?.updatedAt || q.createdAt || 0).getTime();
};

export default function QuestionBankPage() {
  const { questions, isLoading, error } = useAllQuestions();

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<QuestionFilters>(EMPTY_QUESTION_FILTERS);
  const [courseFilter, setCourseFilter] = useState<string>(COURSE_ALL);
  const [sortBy, setSortBy] = useState<QuestionSort>('newest');
  const [preview, setPreview] = useState<Question | null>(null);

  const courseOptions = useMemo(() => {
    const map = new Map<number, string>();
    for (const q of questions) map.set(q.courseId, courseLabel(q));
    return Array.from(map, ([id, label]) => ({ value: String(id), label })).sort((a, b) =>
      a.label.localeCompare(b.label),
    );
  }, [questions]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    const result = questions.filter((q) => {
      const v = repVariant(q);
      if (filters.questionTypes.length > 0 && !filters.questionTypes.includes(q.type)) return false;
      if (courseFilter !== COURSE_ALL && String(q.courseId) !== courseFilter) return false;
      if (filters.difficulties.length > 0 && !(v && filters.difficulties.includes(v.difficulty)))
        return false;
      if (
        filters.reasoningLevels.length > 0 &&
        !(v?.reasoningLevel && filters.reasoningLevels.includes(v.reasoningLevel))
      )
        return false;
      if (filters.aiGenerated !== 'all') {
        const wantAi = filters.aiGenerated === 'ai';
        if ((v?.isAiGenerated === true) !== wantAi) return false;
      }
      if (filters.draftStatus !== 'all') {
        const wantDraft = filters.draftStatus === 'draft';
        if ((v?.isDraft === true) !== wantDraft) return false;
      }
      if (
        term &&
        !questionTextOf(q).toLowerCase().includes(term) &&
        !topicLabel(q).toLowerCase().includes(term)
      )
        return false;
      return true;
    });

    switch (sortBy) {
      case 'newest':
        result.sort((a, b) => timeOf(b) - timeOf(a));
        break;
      case 'oldest':
        result.sort((a, b) => timeOf(a) - timeOf(b));
        break;
      case 'type':
        result.sort((a, b) => a.type.localeCompare(b.type));
        break;
      case 'difficulty':
        result.sort(
          (a, b) =>
            (DIFFICULTY_RANK[difficultyOf(a) ?? 'medium'] ?? 1) -
            (DIFFICULTY_RANK[difficultyOf(b) ?? 'medium'] ?? 1),
        );
        break;
    }
    return result;
  }, [questions, search, filters, courseFilter, sortBy]);

  const hasFilters =
    search.trim() !== '' ||
    courseFilter !== COURSE_ALL ||
    filters.questionTypes.length > 0 ||
    filters.difficulties.length > 0 ||
    filters.reasoningLevels.length > 0 ||
    filters.aiGenerated !== 'all' ||
    filters.draftStatus !== 'all';

  const clearFilters = () => {
    setSearch('');
    setFilters(EMPTY_QUESTION_FILTERS);
    setCourseFilter(COURSE_ALL);
  };

  const courseCount = useMemo(() => new Set(filtered.map((q) => q.courseId)).size, [filtered]);
  const aiCount = useMemo(() => filtered.filter((q) => repVariant(q)?.isAiGenerated).length, [filtered]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-4 md:py-6 lg:px-6">
      <PageHeading
        heading="Question Library"
        subheading="Search, filter and preview questions across every course you can access."
      />

      <QuestionFilterToolbar
        searchTerm={search}
        onSearchChange={setSearch}
        filters={filters}
        onFiltersChange={setFilters}
        sortBy={sortBy}
        onSortChange={setSortBy}
        courseOptions={courseOptions}
        courseValue={courseFilter}
        onCourseChange={setCourseFilter}
      />

      {!isLoading && !error && questions.length > 0 && (
        <div className="-mt-2 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium text-foreground">
              {filtered.length} question{filtered.length === 1 ? '' : 's'}
            </span>
            {courseCount > 0 && <span>across {courseCount} course{courseCount === 1 ? '' : 's'}</span>}
            {aiCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <IconSparkles className="size-3.5" /> {aiCount} AI-generated
              </span>
            )}
          </span>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="flex items-center gap-1 font-medium text-primary-text hover:underline"
            >
              <IconFilterX className="size-3.5" /> Clear filters
            </button>
          )}
        </div>
      )}

      {isLoading ? (
        <ListSkeleton count={8} />
      ) : error ? (
        <EmptyState
          icon={<IconAlertTriangle className="size-6" />}
          title="Couldn't load questions"
          description={error}
          bare={false}
        />
      ) : questions.length === 0 ? (
        <EmptyState
          icon={<IconStack2 className="size-6" />}
          title="Your library is empty"
          description="Questions you create in any course show up here. Open a course to add your first one."
          bare={false}
          action={
            <Button asChild>
              <a href="/courses">Browse courses</a>
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<IconFilterX className="size-6" />}
          title="No questions match your filters"
          description="Try a different search term or clear the filters."
          bare={false}
          action={
            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-[var(--radius-xl)] border border-border bg-card shadow-[var(--shadow-2xs)]">
          {filtered.map((q) => {
            const variant = repVariant(q);
            const difficulty = difficultyOf(q);
            const TypeIcon = TYPE_ICON[q.type] ?? IconListCheck;
            return (
              <li key={q.id}>
                <button
                  type="button"
                  onClick={() => setPreview(q)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                    <TypeIcon className="size-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {questionTextOf(q) || 'Untitled question'}
                    </p>
                    <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                      <span className="font-medium text-foreground/80">{courseLabel(q)}</span>
                      <span aria-hidden className="text-muted-foreground/40">
                        ·
                      </span>
                      <span className="shrink-0 font-mono text-[0.6875rem] text-muted-foreground/70">
                        #{q.id}
                      </span>
                      {topicLabel(q) && (
                        <>
                          <span aria-hidden className="text-muted-foreground/40">
                            ·
                          </span>
                          <span className="truncate">{topicLabel(q)}</span>
                        </>
                      )}
                      <span aria-hidden className="text-muted-foreground/40">
                        ·
                      </span>
                      <span className="shrink-0">{questionTypeLabels[q.type]}</span>
                    </p>
                  </div>
                  <div className="hidden shrink-0 items-center gap-2 sm:flex">
                    {variant?.isAiGenerated && (
                      <Badge variant="secondary" className="gap-1">
                        <IconSparkles className="size-3" /> AI
                      </Badge>
                    )}
                    {difficulty && (
                      <Badge variant={difficultyBadge[difficulty] ?? 'warning'}>{capitalize(difficulty)}</Badge>
                    )}
                    <QuestionStatusBadge isDraft={!!variant?.isDraft} />
                  </div>
                  <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <QuestionPreviewSheet question={preview} open={preview != null} onOpenChange={(o) => !o && setPreview(null)} />
    </div>
  );
}

/**
 * Review dialog shown right after AI variant generation.
 *
 * Generated variants land as DRAFTS (isDraft:true) — they are NOT auto-approved.
 * The instructor reviews each one here and explicitly approves the keepers
 * (PUT isDraft:false) or discards the rest (DELETE), without leaving the page.
 * Only approved variants count toward assembly readiness.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  IconCircleCheck, IconCircleCheckFilled, IconLoader2, IconSparkles, IconTrash, IconCircleX,
} from '@tabler/icons-react';
import {
  Button, Badge, Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, cn,
} from '@eduai/ui';
import { questionService } from '../../services/questionService';
import { useToast } from '@/components/ui/use-toast';
import {
  DIFFICULTY_META,
  difficultyChipClass,
  difficultySolidClass,
  normalizeDifficulty,
} from '../../lib/difficulty';
import type { QuestionDifficulty } from '../../types/question';
import type { GenerateBankVariantsResult, GeneratedVariantPreview } from '../../services/assessmentVariantService';

type VariantStatus = 'pending' | 'approving' | 'approved' | 'discarding' | 'discarded';

interface ReviewGroup {
  questionMetadataId: number;
  description: string | null;
  type: string | null;
  variants: GeneratedVariantPreview[];
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The generation result whose `createdVariants` get reviewed. */
  result: GenerateBankVariantsResult | null;
  /** Fired after any approve/discard so the parent can refresh readiness. */
  onReviewed?: () => void;
}

/** Vivid difficulty pill driven by the shared --diff-* tokens (matches the view modal + composer). */
const DifficultyPill = ({ level }: { level: QuestionDifficulty }) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold capitalize',
      difficultyChipClass[level],
    )}
  >
    <span className={cn('size-1.5 rounded-full', difficultySolidClass[level])} />
    {DIFFICULTY_META[level].label}
  </span>
);

/** Tiny uppercase section heading — echoes the view modal's `Question` / `Answer` labels. */
const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{children}</p>
);

export function GeneratedVariantsReviewDialog({ open, onOpenChange, result, onReviewed }: Props) {
  const { toast } = useToast();
  const [statuses, setStatuses] = useState<Record<number, VariantStatus>>({});
  const [hydrating, setHydrating] = useState(false);

  const groups = useMemo<ReviewGroup[]>(() => {
    if (!result) return [];
    return result.results
      .filter((r) => r.createdVariants.length > 0)
      .map((r) => ({
        questionMetadataId: r.questionId,
        description: r.questionDescription,
        type: r.questionType,
        variants: r.createdVariants,
      }));
  }, [result]);

  // Hydrate each variant's review state from the BACKEND every time the dialog opens.
  //
  // The parent reopens this dialog with a cached generation `result` whose variants
  // are frozen at generation time (all isDraft:true). Without re-reading the live
  // state, already-approved variants would resurface as pending and a re-approve would
  // hit the server-side lock (409 VARIANT_LOCKED). So we refetch the source questions
  // and derive real status: absent → discarded (deleted), isDraft:false → approved,
  // isDraft:true → pending. A failed fetch leaves that question's variants pending.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    // Optimistic: show everything pending until the live state lands.
    const optimistic: Record<number, VariantStatus> = {};
    for (const g of groups) for (const v of g.variants) optimistic[v.id] = 'pending';
    setStatuses(optimistic);

    const questionIds = Array.from(new Set(groups.map((g) => g.questionMetadataId)));
    if (questionIds.length === 0) return;

    setHydrating(true);
    void (async () => {
      try {
        const fetched = await Promise.all(
          questionIds.map((id) => questionService.getQuestion(id).catch(() => null)),
        );
        if (cancelled) return;
        const byQuestion = new Map(questionIds.map((id, i) => [id, fetched[i]]));
        const next: Record<number, VariantStatus> = {};
        for (const g of groups) {
          const q = byQuestion.get(g.questionMetadataId);
          for (const v of g.variants) {
            if (q == null) { next[v.id] = 'pending'; continue; } // fetch failed — can't tell
            const live = (q.variants ?? []).find((x) => x.id === v.id);
            if (!live) next[v.id] = 'discarded';            // deleted from the bank
            else if (live.isDraft === false) next[v.id] = 'approved'; // already reviewed
            else next[v.id] = 'pending';
          }
        }
        setStatuses(next);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, groups]);

  const allVariants = useMemo(() => groups.flatMap((g) => g.variants), [groups]);
  const pendingVariants = allVariants.filter((v) => (statuses[v.id] ?? 'pending') === 'pending');
  const approvedCount = allVariants.filter((v) => statuses[v.id] === 'approved').length;
  const discardedCount = allVariants.filter((v) => statuses[v.id] === 'discarded').length;
  const busy = allVariants.some((v) => statuses[v.id] === 'approving' || statuses[v.id] === 'discarding');

  const setStatus = (id: number, status: VariantStatus) =>
    setStatuses((prev) => ({ ...prev, [id]: status }));

  const approve = async (id: number) => {
    setStatus(id, 'approving');
    try {
      await questionService.updateVariant(id, { isDraft: false });
      setStatus(id, 'approved');
      onReviewed?.();
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: { error?: string } } };
      // Already reviewed (server lock) → treat approve as a no-op success, not an error.
      // Keeps the action idempotent if the live state drifted under a stale dialog.
      if (err?.response?.status === 409 || err?.response?.data?.error === 'VARIANT_LOCKED') {
        setStatus(id, 'approved');
        onReviewed?.();
        return;
      }
      setStatus(id, 'pending');
      toast({
        variant: 'destructive',
        title: 'Could not approve variant',
        description: err?.response?.data?.error ?? 'Only instructors can approve. Try again.',
      });
    }
  };

  const discard = async (id: number) => {
    setStatus(id, 'discarding');
    try {
      await questionService.deleteVariant(id);
      setStatus(id, 'discarded');
      onReviewed?.();
    } catch (e: unknown) {
      setStatus(id, 'pending');
      toast({
        variant: 'destructive',
        title: 'Could not discard variant',
        description:
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'Try again.',
      });
    }
  };

  const approveAll = async () => {
    for (const v of pendingVariants) {
      // Sequential so a mid-batch failure leaves the remaining variants pending
      // (not silently skipped) and the toast points at the first real error.
      // eslint-disable-next-line no-await-in-loop
      await approve(v.id);
    }
  };

  /** MCQ option grid — mirrors the view modal's choice cards (letter chip + correct highlight). */
  const renderChoices = (v: GeneratedVariantPreview) => {
    if (!Array.isArray(v.choices) || v.choices.length === 0) return null;
    return (
      <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
        {v.choices.map((c, i) => {
          const letter = c.letter ?? String.fromCharCode(65 + i);
          const isAnswer =
            v.answer != null &&
            (String(v.answer).trim() === letter || String(v.answer).trim() === c.text?.trim());
          return (
            <div
              key={`${letter}-${i}`}
              className={cn(
                'flex items-center gap-2.5 rounded-[var(--radius-lg)] border px-3 py-2.5 transition-colors',
                isAnswer
                  ? 'border-[var(--color-success-500)] bg-[var(--color-success-100)]'
                  : 'border-border bg-muted/40',
              )}
            >
              <span
                className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  isAnswer ? 'bg-[var(--color-success-500)] text-white' : 'bg-muted text-muted-foreground',
                )}
              >
                {letter}
              </span>
              <span className="flex-1 text-sm text-foreground">{c.text}</span>
              {isAnswer && <IconCircleCheckFilled className="size-5 shrink-0 text-[var(--color-success-500)]" />}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-5xl">
        {/* ── Header: identity + intent (mirrors the view modal) ── */}
        <DialogHeader className="space-y-2 border-b border-border px-6 py-5 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-lg font-semibold leading-snug">
            <IconSparkles className="size-5 text-primary" />
            Review generated variants
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            {allVariants.length} draft variant(s) were generated. Approve the ones you want — only approved
            variants count toward readiness. Discard the rest. Nothing is marked reviewed automatically.
          </DialogDescription>
        </DialogHeader>

        {/* ── Body: one section per source question, card per variant ── */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">No variants were generated.</p>
          ) : (
            <div className="flex flex-col gap-7 px-6 py-6">
              {groups.map((g) => (
                <section key={g.questionMetadataId} className="space-y-3">
                  {/* Source-question header — type chip + description title, like the view modal meta row */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="muted" className="shrink-0 gap-1">
                      {g.type ?? 'Question'} #{g.questionMetadataId}
                    </Badge>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
                      {g.description?.trim() || `Metadata #${g.questionMetadataId}`}
                    </span>
                  </div>

                  <div className="space-y-3">
                    {g.variants.map((v) => {
                      const status = statuses[v.id] ?? 'pending';
                      const diff = normalizeDifficulty(v.difficulty);
                      const isApproved = status === 'approved';
                      const isDiscarded = status === 'discarded';
                      const inFlight = status === 'approving' || status === 'discarding';
                      const hasChoices = Array.isArray(v.choices) && v.choices.length > 0;
                      return (
                        <div
                          key={v.id}
                          className={cn(
                            'rounded-[var(--radius-lg)] border p-4 transition-colors',
                            isApproved && 'border-[var(--color-success-500)] bg-[var(--color-success-100)]/40',
                            isDiscarded && 'border-border bg-muted/40 opacity-60',
                            !isApproved && !isDiscarded && 'border-border bg-card',
                          )}
                        >
                          {/* Card header: difficulty/reasoning chips (left) + lifecycle actions (right) */}
                          <div className="mb-3 flex items-start justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <DifficultyPill level={diff} />
                              {v.reasoningLevel && (
                                <Badge variant="muted" className="capitalize">
                                  {v.reasoningLevel}
                                </Badge>
                              )}
                            </div>

                            {isApproved ? (
                              <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-success-700">
                                <IconCircleCheckFilled className="size-4" /> Approved
                              </span>
                            ) : isDiscarded ? (
                              <span className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-muted-foreground">
                                <IconCircleX className="size-4" /> Discarded
                              </span>
                            ) : (
                              <div className="flex shrink-0 items-center gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  disabled={inFlight || hydrating}
                                  onClick={() => void approve(v.id)}
                                >
                                  {status === 'approving' ? (
                                    <IconLoader2 className="size-4 animate-spin" />
                                  ) : (
                                    <IconCircleCheck className="size-4" />
                                  )}
                                  Approve
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="text-destructive hover:text-destructive"
                                  disabled={inFlight || hydrating}
                                  onClick={() => void discard(v.id)}
                                >
                                  {status === 'discarding' ? (
                                    <IconLoader2 className="size-4 animate-spin" />
                                  ) : (
                                    <IconTrash className="size-4" />
                                  )}
                                  Discard
                                </Button>
                              </div>
                            )}
                          </div>

                          {/* Question — signature left accent rail, echoes the view modal body */}
                          <SectionLabel>Question</SectionLabel>
                          <div className="border-l-2 border-accent pl-4">
                            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
                              {v.questionText}
                            </p>
                          </div>

                          {/* MCQ choices — option grid with correct-answer highlight */}
                          {renderChoices(v)}

                          {/* Answer — green left-rail summary for SA/LA */}
                          {v.answer != null && !hasChoices && (
                            <div className="mt-4">
                              <SectionLabel>Answer</SectionLabel>
                              <div className="rounded-[var(--radius-lg)] border border-l-4 border-[var(--color-success-500)] border-l-[var(--color-success-500)] bg-[var(--color-success-100)] px-4 py-3">
                                <p className="whitespace-pre-line text-sm font-medium leading-relaxed text-foreground">
                                  {String(v.answer)}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer: running tally (left) + batch actions (right) ── */}
        <DialogFooter className="flex-row items-center justify-between gap-2 border-t border-border px-6 py-4 sm:justify-between">
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
            {hydrating ? (
              <><IconLoader2 className="size-4 animate-spin" /> Checking current status…</>
            ) : (
              <>
                <span className="font-medium text-success-700">{approvedCount}</span> approved
                {discardedCount > 0 && <> · {discardedCount} discarded</>}
                {' · '}{pendingVariants.length} pending
              </>
            )}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Done
            </Button>
            <Button type="button" disabled={busy || hydrating || pendingVariants.length === 0} onClick={() => void approveAll()}>
              {busy ? <IconLoader2 className="mr-2 size-4 animate-spin" /> : <IconCircleCheck className="mr-2 size-4" />}
              Approve all ({pendingVariants.length})
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default GeneratedVariantsReviewDialog;

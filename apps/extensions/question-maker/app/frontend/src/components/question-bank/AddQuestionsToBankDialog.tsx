/**
 * Multi-select dialog to add existing course questions to a Core question bank.
 * Questions already in the bank are shown but not selectable.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Input,
  Badge,
} from '@eduai/ui';
import { useToast } from '@/components/ui/use-toast';
import { questionService } from '../../services/questionService';
import { questionBankService } from '../../services/questionBankService';
import type { Question } from '../../types/question';
import { questionTypeLabels } from '../../types/question';

interface AddQuestionsToBankDialogProps {
  open: boolean;
  onClose: () => void;
  courseId: number | null;
  bankId: string | null;
  bankName?: string;
  onAdded?: (addedCount: number) => void;
}

function questionLabel(q: Question): string {
  const text = q.variants?.[0]?.questionText?.trim();
  if (text) return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  if (q.description?.trim()) return q.description.trim();
  return `Question #${q.id}`;
}

export function AddQuestionsToBankDialog({
  open,
  onClose,
  courseId,
  bankId,
  bankName,
  onAdded,
}: AddQuestionsToBankDialogProps) {
  const { toast } = useToast();
  const [questions, setQuestions] = useState<Question[]>([]);
  const [memberIds, setMemberIds] = useState<Set<number>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !courseId || !bankId) return;
    let cancelled = false;
    setSelectedIds(new Set());
    setSearch('');
    setLoadError(null);
    setIsLoading(true);
    void (async () => {
      try {
        const [allPage, inBankPage] = await Promise.all([
          questionService.getQuestionsPage({
            courseId,
            limit: 200,
            offset: 0,
          }),
          questionService.getQuestionsPage({
            courseId,
            questionBankId: bankId,
            limit: 200,
            offset: 0,
          }),
        ]);
        if (cancelled) return;
        setQuestions(allPage.items);
        setMemberIds(new Set(inBankPage.items.map((q) => q.id)));
      } catch (error: any) {
        if (!cancelled) {
          setQuestions([]);
          setMemberIds(new Set());
          setLoadError(
            error?.response?.data?.error ||
              error?.message ||
              'Failed to load questions',
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, courseId, bankId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return questions;
    return questions.filter((item) => {
      const hay = `${item.id} ${item.description ?? ''} ${item.variants?.[0]?.questionText ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [questions, search]);

  const toggle = (id: number) => {
    if (memberIds.has(id)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (!courseId || !bankId || selectedIds.size === 0 || isSaving) return;
    setIsSaving(true);
    let added = 0;
    let failed = 0;
    try {
      for (const questionId of selectedIds) {
        if (memberIds.has(questionId)) continue;
        try {
          await questionBankService.addQuestionToBank(courseId, bankId, questionId);
          added += 1;
        } catch {
          failed += 1;
        }
      }
      if (added > 0) {
        toast({
          title: 'Questions added',
          description: `${added} question${added === 1 ? '' : 's'} added to ${bankName || 'bank'}${
            failed ? ` (${failed} failed)` : ''
          }.`,
        });
        onAdded?.(added);
        onClose();
      } else {
        toast({
          title: 'Could not add questions',
          description: 'No questions were added. Check Core linkage and try again.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add questions to bank</DialogTitle>
          <DialogDescription>
            Select existing questions from this course to add to{' '}
            <span className="font-medium text-foreground">{bankName || 'this bank'}</span>.
            Questions already in the bank cannot be selected again.
          </DialogDescription>
        </DialogHeader>

        <Input
          aria-label="Search questions"
          placeholder="Search by text or id…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          disabled={isLoading}
        />

        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          {isLoading ? (
            <p className="p-4 text-sm text-muted-foreground">Loading questions…</p>
          ) : loadError ? (
            <p className="p-4 text-sm text-destructive" role="alert">
              {loadError}
            </p>
          ) : filtered.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">No questions found.</p>
          ) : (
            <ul className="divide-y divide-border" data-testid="add-to-bank-question-list">
              {filtered.map((q) => {
                const alreadyInBank = memberIds.has(q.id);
                const checked = selectedIds.has(q.id);
                return (
                  <li key={q.id}>
                    <label
                      className={`flex items-start gap-3 px-3 py-2.5 ${
                        alreadyInBank
                          ? 'cursor-not-allowed opacity-60'
                          : 'cursor-pointer hover:bg-muted/50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={alreadyInBank || checked}
                        disabled={alreadyInBank}
                        onChange={() => toggle(q.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2 text-sm font-medium leading-snug">
                          #{q.id} · {questionTypeLabels[q.type] ?? q.type}
                          {alreadyInBank && <Badge variant="secondary">In Bank</Badge>}
                        </span>
                        <span className="mt-0.5 block text-sm text-muted-foreground line-clamp-2">
                          {questionLabel(q)}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={() => void handleAdd()}
            disabled={isSaving || selectedIds.size === 0 || !courseId || !bankId}
            data-testid="add-to-bank-confirm"
          >
            {isSaving
              ? 'Adding…'
              : `Add ${selectedIds.size || ''} question${selectedIds.size === 1 ? '' : 's'}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Read-only question preview drawer for the cross-course Question Library. Lets you
 * inspect a question — its text, choices, answer, topics and provenance — without
 * leaving the library, then jump into the owning course to edit or spin up a variant.
 */
import { useNavigate } from 'react-router';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
  Button,
  Badge,
  QuestionStatusBadge,
  Separator,
} from '@eduai/ui';
import { IconArrowRight, IconGitBranch, IconSparkles, IconBook2 } from '@tabler/icons-react';
import type { Question } from '@/types/question';
import { questionTypeLabels } from '@/types/question';
import { markCorrectChoices } from '@/lib/mcq';

interface QuestionPreviewSheetProps {
  question: Question | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const difficultyVariant: Record<string, 'success' | 'warning' | 'destructive'> = {
  easy: 'success',
  medium: 'warning',
  hard: 'destructive',
};


export function QuestionPreviewSheet({ question, open, onOpenChange }: QuestionPreviewSheetProps) {
  const navigate = useNavigate();
  if (!question) return null;

  const variant = question.variants?.[0];
  const variantCount = question.variants?.length ?? 0;
  const difficulty = variant?.difficulty;
  const courseLabel = question.course?.code ?? question.course?.name ?? `Course ${question.courseId}`;
  const topic = question.primaryTopic?.name ?? question.primaryTopicId;
  const choices = question.type === 'MCQ' ? variant?.choices ?? [] : [];

  const goToCourse = () => {
    onOpenChange(false);
    navigate(`/courses/${question.courseId}?tab=questions`);
  };
  const createVariant = () => {
    onOpenChange(false);
    if (variant) {
      navigate(`/courses/${question.courseId}/questions/new?variantOf=${question.id}`);
    } else {
      navigate(`/courses/${question.courseId}/questions/new`);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="space-y-3 border-b border-border p-6">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{questionTypeLabels[question.type]}</Badge>
            {difficulty && <Badge variant={difficultyVariant[difficulty] ?? 'warning'}>{cap(difficulty)}</Badge>
            }
            {variant?.isAiGenerated && (
              <Badge variant="secondary" className="gap-1">
                <IconSparkles className="size-3" /> AI
              </Badge>
            )}
            <QuestionStatusBadge isDraft={!!variant?.isDraft} />
          </div>
          <SheetTitle className="text-left text-base font-semibold leading-snug">
            {question.description || 'Untitled question'}
          </SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-2 gap-y-1 text-left">
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <IconBook2 className="size-3.5" /> {courseLabel}
            </span>
            <span aria-hidden>·</span>
            <span>{topic}</span>
            {variantCount > 1 && (
              <>
                <span aria-hidden>·</span>
                <span>
                  {variantCount} variant{variantCount === 1 ? '' : 's'}
                </span>
              </>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <section className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Prompt</p>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
              {variant?.questionText || 'No prompt text for this question yet.'}
            </p>
          </section>

          {choices.length > 0 && (
            <section className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Choices</p>
              <ul className="space-y-1.5">
                {markCorrectChoices(variant?.answer ?? null, choices).map((correct, ci) => {
                  const choice = choices[ci];
                  return (
                    <li
                      key={choice.letter}
                      className={`flex gap-2.5 rounded-lg border px-3 py-2 text-sm ${
                        correct
                          ? 'border-success-500/40 bg-success-100/60 text-success-800'
                          : 'border-border bg-card text-foreground'
                      }`}
                    >
                      <span className="font-semibold">{choice.letter}.</span>
                      <span className="flex-1">{choice.text}</span>
                      {correct && <span className="text-xs font-semibold uppercase">Correct</span>}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {choices.length === 0 && variant?.answer && (
            <section className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Model answer
              </p>
              <p className="whitespace-pre-wrap rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm leading-relaxed text-foreground">
                {variant.answer}
              </p>
            </section>
          )}
        </div>

        <SheetFooter className="flex-row gap-2 border-t border-border p-4">
          <Button variant="outline" className="flex-1 gap-1.5" onClick={createVariant}>
            <IconGitBranch className="size-4" /> Create variant
          </Button>
          <Button className="flex-1 gap-1.5" onClick={goToCourse}>
            Open in course <IconArrowRight className="size-4" />
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

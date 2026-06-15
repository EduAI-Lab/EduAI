import { Input, Button } from '@eduai/ui';
import { Tooltip } from '@/components/ui/tooltip';
import React, { useState, useEffect } from 'react';
import { Trash2, X, Plus, AlertTriangle } from 'lucide-react';
import type { AssessmentSection, SectionVariantLink, QuestionVariantEntry } from '../../types/question';

interface AssessmentSectionCardProps {
    section: AssessmentSection;
    sectionIndex: number;
    questionLinks: SectionVariantLink[];
    questionBank: QuestionVariantEntry[];
    onUpdateTitle: (name: string) => void;
    onRemoveQuestion: (variantId: number) => void;
    onDeleteSection: () => void;
    onAddQuestions: () => void;
    onViewQuestion?: (entry: QuestionVariantEntry) => void;
    onToggleDraft?: (entry: QuestionVariantEntry, nextDraft: boolean) => void;
    onCreateVariant?: (entry: QuestionVariantEntry) => void;
    readOnly?: boolean;
}

export function AssessmentSectionCard({
    section,
    sectionIndex,
    questionLinks,
    questionBank,
    onUpdateTitle,
    onRemoveQuestion,
    onDeleteSection,
    onAddQuestions,
    onViewQuestion,
    onToggleDraft,
    onCreateVariant,
    readOnly = false,
}: AssessmentSectionCardProps) {
    const [localName, setLocalName] = useState(section.name);

    useEffect(() => {
        setLocalName(section.name);
    }, [section.name]);

    const handleTitleChange = (value: string) => {
        setLocalName(value);
    };

    const handleTitleBlur = () => {
        const trimmed = localName.trim() || section.name;
        if (trimmed !== section.name) {
            onUpdateTitle(trimmed);
        }
    };

    const questions = React.useMemo(
        () =>
            questionLinks
                .map((link) => {
                    const entry = questionBank.find((q) => q.variant.id === link.variantId);
                    if (!entry) return null;
                    return {
                        link,
                        entry
                    };
                })
                .filter(Boolean) as Array<{ link: SectionVariantLink; entry: QuestionVariantEntry }>,
        [questionLinks, questionBank]
    );

    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
            {/* Section header: */}
            <div className="flex items-center gap-2 rounded-t-lg bg-primary px-3 py-2">
                <Input
                    value={localName}
                    onChange={(event) => handleTitleChange(event.target.value)}
                    onBlur={handleTitleBlur}
                    placeholder={`Section ${sectionIndex + 1}`}
                    readOnly={readOnly}
                    className="h-8 flex-1 min-w-0 border-0 bg-card text-foreground font-medium placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary-foreground"
                />
                {!readOnly && (
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onDeleteSection}
                    className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:bg-primary/90 hover:text-primary-foreground"
                    aria-label="Delete section"
                >
                    <Trash2 className="h-4 w-4" />
                </Button>
                )}
            </div>

            <div className="space-y-2 border-t border-border bg-muted/50 p-3">
                {questions.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 rounded border border-dashed border-border bg-card p-6">
                        <p className="text-sm text-muted-foreground">No questions added yet</p>
                        {!readOnly && (
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={onAddQuestions}
                            className="gap-1.5 border-border bg-card text-foreground hover:bg-muted"
                        >
                            Add questions
                        </Button>
                        )}
                    </div>
                ) : (
                    <>
                        <div className="space-y-2">
                            {questions.map(({ link, entry }, idx) => {
                                const isDraft = entry.isDraft ?? entry.variant.isDraft ?? false;
                                return (
                                    <div
                                        key={link.id}
                                        className="flex items-start gap-3 rounded border border-border bg-card p-3 shadow-sm group"
                                    >
                                        <span className="mt-0.5 w-5 shrink-0 text-right text-xs font-mono text-muted-foreground">
                                            {idx + 1}.
                                        </span>
                                        <div className="min-w-0 flex-1 space-y-1.5">
                                            <p className="text-sm leading-relaxed text-foreground">
                                                {entry.variant.questionText}
                                            </p>
                                            {(entry.variant.choices?.length ?? 0) > 0 && (
                                                <ul className="list-none space-y-0.5 pl-0 text-xs text-muted-foreground">
                                                    {entry.variant.choices?.map((c) => (
                                                        <li key={c.letter} className="flex gap-1.5">
                                                            <span className="font-mono font-medium text-muted-foreground">{c.letter}.</span>
                                                            <span>{c.text}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                            {entry.variant.answer != null && String(entry.variant.answer).trim() !== '' && (
                                                <p className="text-xs text-muted-foreground">
                                                    <span className="font-medium text-muted-foreground">Answer: </span>
                                                    <span className="whitespace-pre-wrap">{entry.variant.answer}</span>
                                                </p>
                                            )}
                                            <div className="flex flex-wrap items-center gap-1.5">
                                                <span className="rounded border border-border bg-muted px-1.5 py-0 text-[10px] font-medium capitalize text-foreground">
                                                    {entry.questionType}
                                                </span>
                                                <span className="rounded border border-border bg-muted px-1.5 py-0 text-[10px] font-medium capitalize text-foreground">
                                                    {entry.variant.difficulty}
                                                </span>
                                                {entry.primaryTopicName && (
                                                    <span className="truncate rounded border border-border bg-muted px-1.5 py-0 text-[10px] font-medium text-foreground">
                                                        {entry.primaryTopicName}
                                                    </span>
                                                )}
                                                <span
                                                    className={`rounded border px-1.5 py-0 text-[10px] font-medium capitalize ${
                                                        isDraft
                                                            ? 'border-warning-500/30 bg-warning-100 text-warning-700'
                                                            : 'border-success-500/30 bg-success-100 text-success-700'
                                                    }`}
                                                >
                                                    {isDraft ? 'Draft' : 'Reviewed'}
                                                </span>
                                                {isDraft && (
                                                    <Tooltip
                                                        content="Need to mark as reviewed before exporting"
                                                        side="top"
                                                    >
                                                        <button
                                                            type="button"
                                                            className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-amber-300 bg-amber-50 text-amber-700"
                                                        >
                                                            <AlertTriangle className="h-3 w-3" />
                                                        </button>
                                                    </Tooltip>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap items-center gap-2 pt-1">
                                                {onViewQuestion && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7 border-border bg-card px-2 text-[11px] font-medium text-foreground hover:bg-muted hover:text-foreground"
                                                        onClick={() => onViewQuestion(entry)}
                                                    >
                                                        View
                                                    </Button>
                                                )}
                                                {onToggleDraft && !readOnly && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7 border-border bg-card px-2 text-[11px] font-medium text-foreground hover:bg-muted hover:text-foreground"
                                                        onClick={() => onToggleDraft(entry, !isDraft)}
                                                    >
                                                        {isDraft ? 'Mark reviewed' : 'Mark draft'}
                                                    </Button>
                                                )}
                                                {onCreateVariant && !readOnly && (
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-7 border-border bg-card px-2 text-[11px] font-medium text-foreground hover:bg-muted hover:text-foreground"
                                                        onClick={() => onCreateVariant(entry)}
                                                    >
                                                        New variant
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                        {!readOnly && (
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => onRemoveQuestion(link.variantId)}
                                            className="h-6 w-6 shrink-0 p-0 text-muted-foreground opacity-0 transition-opacity hover:text-red-600 group-hover:opacity-100"
                                            aria-label="Remove question"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </Button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        {!readOnly && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={onAddQuestions}
                            className="mt-1 gap-1.5 self-start text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                            <Plus className="h-3.5 w-3.5" />
                            Add more questions
                        </Button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}


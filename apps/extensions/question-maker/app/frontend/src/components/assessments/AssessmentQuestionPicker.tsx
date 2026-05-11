import React, { useMemo, useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { ScrollArea } from '../ui/scroll-area';
import { Separator } from '../ui/separator';
import { MultiSelectDropdown } from '../../pages/assessments/MultiSelectDropdown';
import { QuestionDifficulty, QuestionType, QuestionVariantEntry, Topic } from '../../types/question';

interface AssessmentQuestionPickerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    questionBank: QuestionVariantEntry[];
    excludeVariantIds: number[];
    topics: Topic[];
    onConfirm: (variantIds: number[]) => void;
}

type PickerFilter = {
    types: QuestionType[];
    difficulties: QuestionDifficulty[];
    primaryTopicId: string;
    secondaryTopicIds: number[];
    search: string;
};

const QUESTION_TYPES: QuestionType[] = ['MCQ', 'SA', 'LA'];
const DIFFICULTIES: QuestionDifficulty[] = ['easy', 'medium', 'hard'];

export function AssessmentQuestionPicker({
    open,
    onOpenChange,
    questionBank,
    excludeVariantIds,
    topics,
    onConfirm
}: AssessmentQuestionPickerProps) {
    const [filter, setFilter] = useState<PickerFilter>({
        types: [],
        difficulties: [],
        primaryTopicId: '',
        secondaryTopicIds: [],
        search: ''
    });
    const [selected, setSelected] = useState<Set<number>>(new Set());

    const availableQuestions = useMemo(
        () => questionBank.filter((q) => !excludeVariantIds.includes(q.variant.id)),
        [questionBank, excludeVariantIds]
    );

    const filteredQuestions = useMemo(() => {
        return availableQuestions.filter((entry) => {
            if (filter.types.length > 0 && !filter.types.includes(entry.questionType)) {
                return false;
            }
            if (filter.difficulties.length > 0 && !filter.difficulties.includes(entry.variant.difficulty)) {
                return false;
            }
            if (filter.primaryTopicId && entry.primaryTopicId.toString() !== filter.primaryTopicId) {
                return false;
            }
            if (filter.secondaryTopicIds.length > 0) {
                const variantSecondary = entry.variant.secondaryTopicsId ?? [];
                const hasMatchingSecondary = filter.secondaryTopicIds.some((id) => variantSecondary.includes(id));
                if (!hasMatchingSecondary) return false;
            }
            if (filter.search.trim()) {
                const needle = filter.search.toLowerCase();
                const haystack = `${entry.variant.questionText} ${entry.questionDescription ?? ''}`.toLowerCase();
                if (!haystack.includes(needle)) {
                    return false;
                }
            }
            return true;
        });
    }, [availableQuestions, filter]);

    const hasActiveFilters =
        filter.types.length > 0 ||
        filter.difficulties.length > 0 ||
        !!filter.primaryTopicId ||
        filter.secondaryTopicIds.length > 0 ||
        filter.search.trim().length > 0;

    const handleToggleQuestion = (variantId: number) => {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(variantId)) {
                next.delete(variantId);
            } else {
                next.add(variantId);
            }
            return next;
        });
    };

    const handleSelectAll = () => {
        if (selected.size === filteredQuestions.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(filteredQuestions.map((q) => q.variant.id)));
        }
    };

    const handleClearFilters = () => {
        setFilter({
            types: [],
            difficulties: [],
            primaryTopicId: '',
            secondaryTopicIds: [],
            search: ''
        });
    };

    const handleClose = (openState: boolean) => {
        if (!openState) {
            setSelected(new Set());
            handleClearFilters();
        }
        onOpenChange(openState);
    };

    const handleConfirm = () => {
        onConfirm(Array.from(selected));
        setSelected(new Set());
        handleClearFilters();
    };

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-4xl h-[80vh] flex flex-col p-0 gap-0 bg-card">
                <DialogHeader className="px-6 pt-5 pb-4 border-b border-border shrink-0">
                    <DialogTitle className="text-base font-semibold text-foreground">
                        Select questions
                    </DialogTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        {availableQuestions.length} available question
                        {availableQuestions.length === 1 ? '' : 's'} for this course
                    </p>
                </DialogHeader>

                <div className="flex flex-1 min-h-0">
                    {/* Left: Filters */}
                    <div className="w-[280px] border-r border-border shrink-0 flex flex-col">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                Filters
                            </span>
                            {hasActiveFilters && (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    onClick={handleClearFilters}
                                    className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground gap-1"
                                >
                                    Clear
                                </Button>
                            )}
                        </div>

                        <ScrollArea className="flex-1">
                            <div className="flex flex-col gap-5 p-4">
                                {/* Question type */}
                                <div className="flex flex-col gap-2">
                                    <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Question type
                                    </Label>
                                    <div className="flex flex-col gap-1.5">
                                        {QUESTION_TYPES.map((type) => (
                                            <label
                                                key={type}
                                                className="flex items-center gap-2 cursor-pointer"
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="h-3.5 w-3.5 rounded border-border"
                                                    checked={filter.types.includes(type)}
                                                    onChange={() =>
                                                        setFilter((prev) => ({
                                                            ...prev,
                                                            types: prev.types.includes(type)
                                                                ? prev.types.filter((t) => t !== type)
                                                                : [...prev.types, type]
                                                        }))
                                                    }
                                                />
                                                <span className="text-xs text-foreground">{type}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <Separator className="bg-border" />

                                {/* Difficulty */}
                                <div className="flex flex-col gap-2">
                                    <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Difficulty
                                    </Label>
                                    <div className="flex flex-col gap-1.5">
                                        {DIFFICULTIES.map((diff) => (
                                            <label
                                                key={diff}
                                                className="flex items-center gap-2 cursor-pointer"
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="h-3.5 w-3.5 rounded border-border"
                                                    checked={filter.difficulties.includes(diff)}
                                                    onChange={() =>
                                                        setFilter((prev) => ({
                                                            ...prev,
                                                            difficulties: prev.difficulties.includes(diff)
                                                                ? prev.difficulties.filter((d) => d !== diff)
                                                                : [...prev.difficulties, diff]
                                                        }))
                                                    }
                                                />
                                                <span className="text-xs text-foreground capitalize">{diff}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>

                                <Separator className="bg-border" />

                                {/* Primary topic */}
                                <div className="flex flex-col gap-1.5">
                                    <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Primary topic
                                    </Label>
                                    <select
                                        className="h-8 rounded-md border border-border bg-secondary px-2 text-xs"
                                        value={filter.primaryTopicId}
                                        onChange={(event) =>
                                            setFilter((prev) => ({
                                                ...prev,
                                                primaryTopicId: event.target.value
                                            }))
                                        }
                                    >
                                        <option value="">All topics</option>
                                        {topics.map((topic) => (
                                            <option key={topic.id} value={topic.id.toString()}>
                                                {topic.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <Separator className="bg-border" />

                                {/* Secondary topics */}
                                <div className="flex flex-col gap-1.5">
                                    <MultiSelectDropdown
                                        label="Secondary topics"
                                        options={topics}
                                        selectedIds={filter.secondaryTopicIds}
                                        onChange={(ids) =>
                                            setFilter((prev) => ({
                                                ...prev,
                                                secondaryTopicIds: ids
                                            }))
                                        }
                                        labelClassName="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                                        triggerClassName="flex h-8 w-full items-center justify-between rounded-md border border-border bg-secondary px-2 text-left text-xs text-foreground"
                                        listClassName="z-20 mt-1 max-h-56 w-full rounded-md border border-border bg-card shadow-md"
                                    />
                                </div>

                                <Separator className="bg-border" />

                                {/* Search */}
                                <div className="flex flex-col gap-1.5">
                                    <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                        Search
                                    </Label>
                                    <Input
                                        value={filter.search}
                                        onChange={(event) =>
                                            setFilter((prev) => ({
                                                ...prev,
                                                search: event.target.value
                                            }))
                                        }
                                        placeholder="Search question text"
                                        className="h-8 bg-secondary border-border text-xs"
                                    />
                                </div>
                            </div>
                        </ScrollArea>
                    </div>

                    {/* Right: Question list */}
                    <div className="flex-1 flex flex-col min-h-0">
                        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                            <span className="text-xs text-muted-foreground">
                                {filteredQuestions.length} matching question
                                {filteredQuestions.length === 1 ? '' : 's'}
                            </span>
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={handleSelectAll}
                                className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground"
                                disabled={filteredQuestions.length === 0}
                            >
                                {selected.size === filteredQuestions.length ? 'Clear selection' : 'Select all'}
                            </Button>
                        </div>
                        <ScrollArea className="flex-1">
                            <div className="flex flex-col divide-y divide-border">
                                {filteredQuestions.map((entry) => {
                                    const checked = selected.has(entry.variant.id);
                                    const topicName =
                                        entry.primaryTopicName ||
                                        topics.find((t) => t.id === entry.primaryTopicId)?.name;
                                    return (
                                            <label
                                                key={entry.variant.id}
                                                className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-secondary/40"
                                            >
                                                <input
                                                    type="checkbox"
                                                    className="h-3.5 w-3.5 mt-1 rounded border-border"
                                                    checked={checked}
                                                    onChange={() => handleToggleQuestion(entry.variant.id)}
                                                />
                                            <div className="flex-1 min-w-0 space-y-1">
                                                <p className="text-sm text-foreground line-clamp-2 leading-relaxed">
                                                    {entry.variant.questionText}
                                                </p>
                                                <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                                                    <span className="px-1.5 py-0.5 rounded-full border border-border bg-background capitalize">
                                                        {entry.questionType}
                                                    </span>
                                                    <span className="px-1.5 py-0.5 rounded-full border border-border bg-background capitalize">
                                                        {entry.variant.difficulty}
                                                    </span>
                                                    {topicName && <span className="truncate">{topicName}</span>}
                                                </div>
                                            </div>
                                        </label>
                                    );
                                })}

                                {filteredQuestions.length === 0 && (
                                    <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                                        No questions match the current filters.
                                    </div>
                                )}
                            </div>
                        </ScrollArea>
                    </div>
                </div>

                <DialogFooter className="px-6 py-4 border-t border-border mt-0 gap-2 justify-between">
                    <span className="text-xs text-muted-foreground">
                        {selected.size} question{selected.size === 1 ? '' : 's'} selected
                    </span>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleClose(false)}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            size="sm"
                            onClick={handleConfirm}
                            disabled={selected.size === 0}
                        >
                            Add questions
                        </Button>
                    </div>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}


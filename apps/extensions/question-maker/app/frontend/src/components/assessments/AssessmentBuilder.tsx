import { Button } from '@eduai/ui';
import React, { useMemo, useRef, useState } from 'react';
import { IconPlus, IconLayoutList } from '@tabler/icons-react';
import { Assessment, AssessmentSection, QuestionVariantEntry, Topic } from '../../types/question';
import { AssessmentSectionCard } from './AssessmentSectionCard';
import { AssessmentQuestionPicker } from './AssessmentQuestionPicker';

interface AssessmentBuilderProps {
    assessment: Assessment;
    questionBank: QuestionVariantEntry[];
    topics: Topic[];
    onAddSection: () => void;
    onUpdateSectionName: (sectionId: number, name: string) => void;
    onDeleteSection: (sectionId: number) => void;
    onAddQuestionsToSection: (sectionId: number, variantIds: number[]) => void;
    onRemoveQuestionFromSection: (sectionId: number, variantId: number) => void;
    onViewQuestion?: (entry: QuestionVariantEntry) => void;
    onToggleDraft?: (entry: QuestionVariantEntry, nextDraft: boolean) => void;
    onCreateVariant?: (entry: QuestionVariantEntry) => void;
    onReorderSections?: (sectionIds: number[]) => void | Promise<void>;
    readOnly?: boolean;
}

export function AssessmentBuilder({
    assessment,
    questionBank,
    topics,
    onAddSection,
    onUpdateSectionName,
    onDeleteSection,
    onAddQuestionsToSection,
    onRemoveQuestionFromSection,
    onViewQuestion,
    onToggleDraft,
    onCreateVariant,
    onReorderSections,
    readOnly = false,
}: AssessmentBuilderProps) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerSectionId, setPickerSectionId] = useState<number | null>(null);
    const [isReordering, setIsReordering] = useState(false);
    // Sync guard — state alone still allows a second click in the same tick before re-render.
    const reorderingRef = useRef(false);

    const sections = useMemo<AssessmentSection[]>(() => {
        const list = [...(assessment.sections ?? [])];
        return list.sort((a, b) => a.position - b.position);
    }, [assessment.sections]);

    const currentSectionVariantIds = useMemo(() => {
        if (!pickerSectionId) return [];
        const section = sections.find((s) => s.id === pickerSectionId);
        if (!section || !section.sectionVariants) return [];
        return section.sectionVariants.map((link) => link.variantId);
    }, [pickerSectionId, sections]);

    const move = async (fromIndex: number, toIndex: number) => {
        if (!onReorderSections || reorderingRef.current) return;
        if (toIndex < 0 || toIndex >= sections.length) return;
        const ids = sections.map((s) => s.id);
        const tmp = ids[fromIndex];
        ids[fromIndex] = ids[toIndex];
        ids[toIndex] = tmp;
        reorderingRef.current = true;
        setIsReordering(true);
        try {
            await onReorderSections(ids);
        } finally {
            reorderingRef.current = false;
            setIsReordering(false);
        }
    };

    return (
        <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <IconLayoutList className="h-4 w-4 text-muted-foreground" />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        Sections ({sections.length})
                    </span>
                </div>
                {!readOnly && (
                    <Button
                        type="button"
                        size="sm"
                        className="gap-1.5"
                        onClick={onAddSection}
                    >
                        <IconPlus className="h-3.5 w-3.5" />
                        Add section
                    </Button>
                )}
            </div>

            <div>
                {sections.length === 0 ? (
                    <div className="flex flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-muted/30 p-12 text-center">
                        <IconLayoutList className="h-10 w-10 text-muted-foreground/40" />
                        <div className="space-y-1">
                            <p className="text-sm font-medium text-foreground">No sections yet</p>
                            <p className="text-xs text-muted-foreground">
                                Add a section to start organizing your assessment questions.
                            </p>
                        </div>
                        {!readOnly && (
                            <Button
                                type="button"
                                size="sm"
                                className="mt-1 gap-1.5"
                                onClick={onAddSection}
                            >
                                <IconPlus className="h-3.5 w-3.5" />
                                Add first section
                            </Button>
                        )}
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        {sections.map((section, index) => (
                            <AssessmentSectionCard
                                key={section.id}
                                section={section}
                                sectionIndex={index}
                                questionLinks={section.sectionVariants ?? []}
                                questionBank={questionBank}
                                onUpdateTitle={(name) => onUpdateSectionName(section.id, name)}
                                onRemoveQuestion={(variantId) =>
                                    onRemoveQuestionFromSection(section.id, variantId)
                                }
                                onDeleteSection={() => onDeleteSection(section.id)}
                                onViewQuestion={onViewQuestion}
                                onToggleDraft={onToggleDraft}
                                onCreateVariant={onCreateVariant}
                                onAddQuestions={() => {
                                    setPickerSectionId(section.id);
                                    setPickerOpen(true);
                                }}
                                canMoveUp={!isReordering && index > 0}
                                canMoveDown={!isReordering && index < sections.length - 1}
                                onMoveUp={onReorderSections ? () => { void move(index, index - 1); } : undefined}
                                onMoveDown={onReorderSections ? () => { void move(index, index + 1); } : undefined}
                                readOnly={readOnly}
                            />
                        ))}
                    </div>
                )}
            </div>

            <AssessmentQuestionPicker
                open={pickerOpen}
                onOpenChange={(open) => {
                    setPickerOpen(open);
                    if (!open) setPickerSectionId(null);
                }}
                questionBank={questionBank}
                excludeVariantIds={currentSectionVariantIds}
                topics={topics}
                onConfirm={(variantIds) => {
                    if (!pickerSectionId) return;
                    onAddQuestionsToSection(pickerSectionId, variantIds);
                    setPickerOpen(false);
                    setPickerSectionId(null);
                }}
            />
        </div>
    );
}

import React, { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
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
    onCreateVariant
}: AssessmentBuilderProps) {
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerSectionId, setPickerSectionId] = useState<number | null>(null);

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

    return (
        <div className="flex flex-col gap-4 h-full">
            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)] h-full">
                <ScrollArea className="h-full pr-2">
                    <div className="flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-500">
                                Sections
                            </h3>
                        </div>

                        {sections.length === 0 ? (
                            <div className="rounded border border-dashed border-gray-200 bg-gray-50 p-8 text-center text-sm text-gray-500">
                                No sections yet. Click &quot;Add section&quot; to get started.
                            </div>
                        ) : (
                            <div className="flex flex-col gap-3">
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
                                    />
                                ))}
                            </div>
                        )}
                        <div className="pt-3">
                            <Button
                                type="button"
                                size="sm"
                                className="gap-1.5 bg-slate-800 text-white hover:bg-slate-700"
                                onClick={onAddSection}
                            >
                                <Plus className="h-3.5 w-3.5" />
                                Add section
                            </Button>
                        </div>
                    </div>
                </ScrollArea>
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


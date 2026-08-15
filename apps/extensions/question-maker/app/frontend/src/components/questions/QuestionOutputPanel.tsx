/**
 * Output panel for question text, MCQ choices, and answer.
 * Matches prototype layout: clear labels, optional copy/clear, single card for content.
 */
import { Label, Textarea, Button } from '@eduai/ui';

import { useState } from 'react';
import { IconCopy, IconCheck, IconRotate } from '@tabler/icons-react';
import { MCQChoicesField } from './MCQChoicesField';
import type { QuestionType, MCQChoice } from '../../types/question';

interface QuestionOutputPanelProps {
    questionType: QuestionType;
    variantText: string;
    variantChoices: MCQChoice[];
    variantAnswer: string;
    onVariantTextChange: (value: string) => void;
    onVariantChoicesChange: (choices: MCQChoice[]) => void;
    onVariantAnswerChange: (value: string) => void;
    selectAllThatApply?: boolean;
    correctAnswers?: string[];
    onSelectAllThatApplyChange?: (value: boolean) => void;
    onCorrectAnswersChange?: (letters: string[]) => void;
    disabled?: boolean;
    isStreaming?: boolean;
    /** Optional: clear question text, choices, answer to defaults */
    onClear?: () => void;
    idPrefix?: string;
    /** Whether the SA/LA answer is required (composer create) vs optional (variant). */
    answerRequired?: boolean;
}

const defaultChoices: MCQChoice[] = [
    { letter: 'A', text: '' },
    { letter: 'B', text: '' },
    { letter: 'C', text: '' },
    { letter: 'D', text: '' }
];

export function QuestionOutputPanel({
    questionType,
    variantText,
    variantChoices,
    variantAnswer,
    onVariantTextChange,
    onVariantChoicesChange,
    onVariantAnswerChange,
    selectAllThatApply = false,
    correctAnswers = [],
    onSelectAllThatApplyChange,
    onCorrectAnswersChange,
    disabled = false,
    isStreaming = false,
    onClear,
    idPrefix = 'aq',
    answerRequired = false
}: QuestionOutputPanelProps) {
    const [copiedField, setCopiedField] = useState<string | null>(null);

    const handleCopy = (text: string, field: string) => {
        if (!text.trim()) return;
        navigator.clipboard.writeText(text);
        setCopiedField(field);
        setTimeout(() => setCopiedField(null), 2000);
    };

    const hasContent = variantText.trim().length > 0 || variantAnswer.trim().length > 0;

    return (
        <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Question content</h3>
                {onClear && hasContent && !disabled && (
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={onClear}
                        className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                    >
                        <IconRotate className="h-3 w-3" />
                        Clear
                    </Button>
                )}
            </div>

            <div className="flex flex-col gap-1.5" data-field-id="field-variant-text">
                <div className="flex min-h-6 items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Question text <span className="text-destructive">*</span>
                    </Label>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCopy(variantText, 'question')}
                        className={`h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground ${variantText.trim() ? '' : 'pointer-events-none opacity-0'}`}
                        tabIndex={variantText.trim() ? 0 : -1}
                        aria-hidden={!variantText.trim()}
                    >
                        {copiedField === 'question' ? (
                            <IconCheck className="h-3 w-3" />
                        ) : (
                            <IconCopy className="h-3 w-3" />
                        )}
                        {copiedField === 'question' ? 'Copied' : 'Copy'}
                    </Button>
                </div>
                <Textarea
                    id={`${idPrefix}-variant-text`}
                    value={variantText}
                    onChange={(e) => onVariantTextChange(e.target.value)}
                    placeholder={
                        isStreaming
                            ? 'Generating…'
                            : questionType === 'MCQ'
                              ? 'e.g. Which of the following best describes the time complexity of binary search? (do not include the A/B/C/D choices here)'
                              : 'e.g. Explain how a hash table resolves collisions, with one worked example.'
                    }
                    disabled={disabled}
                    className="min-h-24 resize-none"
                    rows={5}
                />
            </div>

            {questionType === 'MCQ' && (
                <div data-field-id="field-mcq-choices">
                    <MCQChoicesField
                        choices={variantChoices}
                        answer={variantAnswer}
                        onChoicesChange={onVariantChoicesChange}
                        onAnswerChange={onVariantAnswerChange}
                        selectAllThatApply={selectAllThatApply}
                        correctAnswers={correctAnswers}
                        onSelectAllThatApplyChange={onSelectAllThatApplyChange}
                        onCorrectAnswersChange={onCorrectAnswersChange}
                        idPrefix={idPrefix}
                        disabled={disabled}
                    />
                </div>
            )}

            {questionType !== 'MCQ' && (
                <div className="flex flex-col gap-1.5">
                    <div className="flex min-h-6 items-center justify-between">
                        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Model answer{' '}
                            {answerRequired ? (
                                <span className="text-destructive normal-case">*</span>
                            ) : (
                                <span className="text-muted-foreground/60 normal-case">(optional)</span>
                            )}
                        </Label>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(variantAnswer, 'answer')}
                            className={`h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground ${variantAnswer.trim() ? '' : 'pointer-events-none opacity-0'}`}
                            tabIndex={variantAnswer.trim() ? 0 : -1}
                            aria-hidden={!variantAnswer.trim()}
                        >
                            {copiedField === 'answer' ? (
                                <IconCheck className="h-3 w-3" />
                            ) : (
                                <IconCopy className="h-3 w-3" />
                            )}
                            {copiedField === 'answer' ? 'Copied' : 'Copy'}
                        </Button>
                    </div>
                    <Textarea
                        id={`${idPrefix}-variant-answer`}
                        value={variantAnswer}
                        onChange={(e) => onVariantAnswerChange(e.target.value)}
                        placeholder={
                            isStreaming
                                ? 'Generating answer…'
                                : questionType === 'SA'
                                  ? 'e.g. O(log n) — the search space halves each comparison.'
                                  : 'e.g. A full reference solution graders can mark against. Leave blank for open-ended prompts.'
                        }
                        disabled={disabled}
                        className="min-h-20 resize-none"
                        rows={3}
                    />
                </div>
            )}
        </div>
    );
}

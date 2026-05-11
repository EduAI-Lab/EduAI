/**
 * Output panel for question text, MCQ choices, and answer.
 * Matches prototype layout: clear labels, optional copy/clear, single card for content.
 */
import { useState } from 'react';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Button } from '../ui/button';
import { Copy, Check, RotateCcw } from 'lucide-react';
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
    disabled?: boolean;
    isStreaming?: boolean;
    /** Optional: clear question text, choices, answer to defaults */
    onClear?: () => void;
    idPrefix?: string;
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
    disabled = false,
    isStreaming = false,
    onClear,
    idPrefix = 'aq'
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
                        <RotateCcw className="h-3 w-3" />
                        Clear
                    </Button>
                )}
            </div>

            <div className="flex flex-col gap-1.5" data-field-id="field-variant-text">
                <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Question text <span className="text-destructive">*</span>
                    </Label>
                    {variantText.trim() && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCopy(variantText, 'question')}
                            className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                        >
                            {copiedField === 'question' ? (
                                <Check className="h-3 w-3" />
                            ) : (
                                <Copy className="h-3 w-3" />
                            )}
                            {copiedField === 'question' ? 'Copied' : 'Copy'}
                        </Button>
                    )}
                </div>
                <Textarea
                    id={`${idPrefix}-variant-text`}
                    value={variantText}
                    onChange={(e) => onVariantTextChange(e.target.value)}
                    placeholder={
                        isStreaming
                            ? 'Generating...'
                            : questionType === 'MCQ'
                              ? 'Enter the question text (without choices)'
                              : 'Enter the full question text'
                    }
                    disabled={disabled}
                    className="bg-secondary border-border min-h-24 resize-none"
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
                        idPrefix={idPrefix}
                    />
                </div>
            )}

            {questionType !== 'MCQ' && (
                <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            Answer <span className="text-muted-foreground/60 normal-case">(optional)</span>
                        </Label>
                        {variantAnswer.trim() && (
                            <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleCopy(variantAnswer, 'answer')}
                                className="h-6 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
                            >
                                {copiedField === 'answer' ? (
                                    <Check className="h-3 w-3" />
                                ) : (
                                    <Copy className="h-3 w-3" />
                                )}
                                {copiedField === 'answer' ? 'Copied' : 'Copy'}
                            </Button>
                        )}
                    </div>
                    <Textarea
                        id={`${idPrefix}-variant-answer`}
                        value={variantAnswer}
                        onChange={(e) => onVariantAnswerChange(e.target.value)}
                        placeholder={isStreaming ? 'Generating answer...' : 'Provide an answer or leave blank'}
                        disabled={disabled}
                        className="bg-secondary border-border min-h-20 resize-none"
                        rows={3}
                    />
                </div>
            )}
        </div>
    );
}

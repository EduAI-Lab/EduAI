/**
 * Question parameters panel: type, primary topic, secondary topics, difficulty, reasoning,
 * description, and assessment. Uses a compact multi-column grid to minimise vertical space.
 */
import { Label, Textarea, MultiSelect } from '@eduai/ui';

import {
    Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@eduai/ui';
import {
    QuestionType,
    QuestionDifficulty,
    ReasoningLevel,
    questionTypeLabels
} from '../../types/question';
import { Topic } from '../../types/topic';
import { Assessment } from '../../types/question';

export interface QuestionMetadataPanelValue {
    questionType: QuestionType;
    primaryTopicId: string;
    questionDescription: string;
    variantDifficulty: QuestionDifficulty;
    variantReasoningLevel: ReasoningLevel;
    variantSecondaryTopics: string[];
    /** Assessment linkage (formerly "Advanced options") */
    variantAssessmentId: string;
}

interface QuestionMetadataPanelProps {
    value: QuestionMetadataPanelValue;
    onChange: (field: keyof QuestionMetadataPanelValue, value: QuestionMetadataPanelValue[keyof QuestionMetadataPanelValue]) => void;
    topics: Topic[];
    assessments: Assessment[];
    isAuxLoading?: boolean;
    disabled?: boolean;
    /** In variant mode, primary topic is read-only from preset; still need to show it */
    mode: 'new' | 'variant';
    primaryTopicName?: string;
    onToggleSecondaryTopic: (topicId: string, checked: boolean) => void;
}

const difficultyOptions: QuestionDifficulty[] = ['easy', 'medium', 'hard'];
const reasoningLevelOptions: ReasoningLevel[] = ['factual', 'analytical', 'application'];
const reasoningLevelLabels: Record<ReasoningLevel, string> = {
    factual: 'Factual',
    analytical: 'Analytical',
    application: 'Application'
};
const questionTypes: QuestionType[] = ['MCQ', 'SA', 'LA'];

export function QuestionMetadataPanel({
    value,
    onChange,
    topics,
    assessments,
    isAuxLoading = false,
    disabled = false,
    mode,
    primaryTopicName,
    onToggleSecondaryTopic
}: QuestionMetadataPanelProps) {
    return (
        <div className="flex flex-col gap-3">
            {/* Row 1: Type + Primary Topic + Difficulty + Reasoning — 4 cols on lg, 2 on sm */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="flex flex-col gap-1.5">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Type
                    </Label>
                    {mode === 'variant' ? (
                        <p className="text-sm text-muted-foreground py-2">{questionTypeLabels[value.questionType]}</p>
                    ) : (
                        <Select
                            value={value.questionType}
                            onValueChange={(v) => onChange('questionType', v as QuestionType)}
                            disabled={disabled}
                        >
                            <SelectTrigger className="h-9">
                                <SelectValue placeholder="Select type" />
                            </SelectTrigger>
                            <SelectContent>
                                {questionTypes.map((t) => (
                                    <SelectItem key={t} value={t}>
                                        {questionTypeLabels[t]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    )}
                </div>

                <div className="flex flex-col gap-1.5">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Primary Topic <span className="text-destructive">*</span>
                    </Label>
                    {mode === 'variant' && primaryTopicName ? (
                        <p className="text-sm text-muted-foreground py-2">{primaryTopicName}</p>
                    ) : (
                        <>
                            {topics.length === 0 && !isAuxLoading && (
                                <p className="text-xs text-muted-foreground">
                                    No topics yet. Add in Core then re-sync.
                                </p>
                            )}
                            <Select
                                value={value.primaryTopicId}
                                onValueChange={(v) => onChange('primaryTopicId', v)}
                                disabled={disabled || topics.length === 0}
                            >
                                <SelectTrigger className="h-9">
                                    <SelectValue
                                        placeholder={
                                            topics.length === 0
                                                ? isAuxLoading
                                                    ? 'Loading...'
                                                    : 'No topics'
                                                : 'Select topic'
                                        }
                                    />
                                </SelectTrigger>
                                <SelectContent>
                                    {topics.length === 0 ? (
                                        <SelectItem value="__no_topics" disabled>
                                            {isAuxLoading ? 'Loading...' : 'No topics available'}
                                        </SelectItem>
                                    ) : (
                                        topics.map((topic) => (
                                            <SelectItem key={topic.id} value={topic.id.toString()}>
                                                {topic.name}
                                            </SelectItem>
                                        ))
                                    )}
                                </SelectContent>
                            </Select>
                        </>
                    )}
                </div>

                <div className="flex flex-col gap-1.5">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Difficulty
                    </Label>
                    <Select
                        value={value.variantDifficulty}
                        onValueChange={(v) => onChange('variantDifficulty', v as QuestionDifficulty)}
                        disabled={disabled}
                    >
                        <SelectTrigger className="h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {difficultyOptions.map((opt) => (
                                <SelectItem key={opt} value={opt} className="capitalize">
                                    {opt}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                <div className="flex flex-col gap-1.5">
                    <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Reasoning
                    </Label>
                    <Select
                        value={value.variantReasoningLevel}
                        onValueChange={(v) => onChange('variantReasoningLevel', v as ReasoningLevel)}
                        disabled={disabled}
                    >
                        <SelectTrigger className="h-9">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {reasoningLevelOptions.map((opt) => (
                                <SelectItem key={opt} value={opt}>
                                    {reasoningLevelLabels[opt]}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Row 2: Secondary Topics (full width) */}
            <div className="flex flex-col gap-1.5">
                <Label className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Secondary Topics <span className="text-muted-foreground font-normal">(optional)</span>
                </Label>
                <MultiSelect
                    options={topics
                        .filter((topic) => topic.id.toString() !== value.primaryTopicId)
                        .map((topic) => ({ value: topic.id.toString(), label: topic.name }))}
                    value={value.variantSecondaryTopics}
                    onValueChange={(next) => {
                        const current = value.variantSecondaryTopics;
                        for (const id of next) {
                            if (!current.includes(id)) onToggleSecondaryTopic(id, true);
                        }
                        for (const id of current) {
                            if (!next.includes(id)) onToggleSecondaryTopic(id, false);
                        }
                    }}
                    placeholder="Select secondary topics"
                    searchPlaceholder="Search topics…"
                    emptyText="No topics"
                    disabled={disabled}
                />
            </div>

            {/* Row 3: Description + Assessment side-by-side (formerly "Advanced options") */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="question-description" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Description <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Textarea
                        id="question-description"
                        placeholder="Short label for this question"
                        value={value.questionDescription}
                        onChange={(e) => onChange('questionDescription', e.target.value)}
                        disabled={disabled}
                        className="min-h-[4.5rem] resize-none text-sm"
                        rows={2}
                    />
                </div>

                <div className="flex flex-col gap-1.5">
                    <Label htmlFor="variant-assessment" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        Assessment <span className="text-muted-foreground font-normal">(optional)</span>
                    </Label>
                    <Select
                        value={value.variantAssessmentId}
                        onValueChange={(v) => onChange('variantAssessmentId', v)}
                        disabled={disabled}
                    >
                        <SelectTrigger id="variant-assessment" className="h-9">
                            <SelectValue placeholder="Select assessment" />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="none">No assessment</SelectItem>
                            {assessments.length === 0 ? (
                                <SelectItem value="__no_assessments" disabled>
                                    {isAuxLoading ? 'Loading...' : 'No assessments available'}
                                </SelectItem>
                            ) : (
                                assessments.map((assessment) => (
                                    <SelectItem key={assessment.id} value={assessment.id.toString()}>
                                        {assessment.name} ({assessment.type})
                                    </SelectItem>
                                ))
                            )}
                        </SelectContent>
                    </Select>
                </div>
            </div>
        </div>
    );
}
